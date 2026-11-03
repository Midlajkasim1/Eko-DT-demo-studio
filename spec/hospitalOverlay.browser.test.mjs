import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// The real viewer and dashboard overlay with a real .frag model: select an equipment linked as AHU or FCU, in a project that
// has the Hospital HVAC graphics on and in projects that do not, and read the point labels the overlay puts on screen
// (one DOM label per anchor of the schematic it drew). Also switches Eko Hospital -> Marsa -> Eko Hospital in one session.
// Skipped when the local .frag fixture is not on this machine. The FIN readings are made-up inputs, not Hospital data.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = 'C:/Users/user/Documents/NBU_OfficeBuilding_ifc/NBU_OfficeBuilding/example/models/model-mup3l8hk-7si3tvx.frag'
const skip = !fs.existsSync(fixture) && 'local .frag fixture not found'
const PORT = 5187

let vite, browser, page, guid

const waitForServer = async () => {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('vite did not start')
}

before(async () => {
  if (skip) return
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, shell: true, stdio: 'ignore' })
  await waitForServer()
  browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`http://127.0.0.1:${PORT}/`)
  for (let i = 0; i < 60; i++) {
    await page.evaluate(async () => { (await import('/src/store/useAppStore.ts')).useAppStore.getState().setStep('idle') }).catch(() => {})
    if (await page.$('input[type=file]')) break
    await page.waitForTimeout(500)
  }
  await page.setInputFiles('input[type=file]', [{ name: 'Architecture.frag', mimeType: 'application/octet-stream', buffer: fs.readFileSync(fixture) }])
  await page.waitForFunction(async () => {
    const s = (await import('/src/store/useModelStore.ts')).useModelStore.getState()
    return s.models.length >= 1 && s.models.every(m => s.modelsLoadedInEngine[m.modelId])
  }, null, { timeout: 120000 })
  await page.waitForSelector('.viewer-overlay', { state: 'detached', timeout: 60000 }).catch(() => {})
  await page.locator('button[title="Show Dashboard"]').evaluate(el => el.click())
  await page.waitForFunction(() => window.EKO && window.EKO_HOST_ENGINE?.highlightAsset, null, { timeout: 60000 })

  // one real element of the model to link the test equipment to: it has a GlobalId and a box
  guid = await page.evaluate(async () => {
    const model = window.__twin.engine.fragments.models.list.values().next().value
    const ids = await model.getItemsIdsWithGeometry()
    for (const id of ids.slice(0, 400)) {
      const [g] = await model.getGuidsByLocalIds([id])
      if (typeof g !== 'string' || !/^[0-9A-Za-z_$]{22}$/.test(g)) continue
      const box = await model.getMergedBox([id])
      if (box && !box.isEmpty()) return g
    }
    return null
  })
})

after(async () => {
  await browser?.close()
  if (vite) spawn('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { stdio: 'ignore' })
})

// The projects: only Eko Hospital sets the flag. Marsa's own FIN project is named as in its backend config.
const project = (projectId, name, finProjectName, apiSettings, links) => ({
  version: 1, projectId, name, createdAt: 1, updatedAt: 1, models: [], geolocation: null, isFinProject: true,
  apiSettings: { finProjectName, ...apiSettings }, assetLinks: links,
})
const links = () => [
  { equip: 'HOSPITAL_AHU_01', guid, type: 'AHU' },
]
const fcuLinks = () => [
  { equip: 'FCU-GF-01', guid, type: 'FCU' },
]
const EKO = (l = links) => project('p-eko', 'Eko Hospital', 'ekoHospital', { hospitalHvacGraphics: true }, l())
const MARSA = (l = links) => project('p-marsa', 'Marsa Al Arab', 'marsaAlArab', { dashboardDemo: true }, l())
const OTHER = (l = links) => project('p-other', 'ANC09 Tower', 'anc09', {}, l())
const OLD = (l = links) => ({ ...project('p-old', 'Saved before the setting', 'old', {}, l()), apiSettings: undefined })

/** Open this project the way the app does (the open project is what the overlay reads), once its dashboard has reloaded.
 *  The Studio hides the dashboard when another project opens, so it is shown again, as the user would. */
async function open(meta) {
  await page.evaluate(async meta => {
    ;(await import('/src/store/useProjectStore.ts')).useProjectStore.setState({ currentProject: meta })
  }, meta)
  await page.waitForTimeout(500)
  if (!(await page.$('.dashboard-overlay-container'))) await page.locator('button[title="Show Dashboard"]').evaluate(el => el.click())
  await page.waitForFunction(id => window.INJECTED_PROJECT_CONFIG?.projectId === id, meta.projectId, { timeout: 60000 })
  await page.waitForFunction(() => !!window.EKO_HOST_ENGINE?.highlightAsset, null, { timeout: 60000 })
}
const select = name => page.evaluate(async n => window.EKO_HOST_ENGINE.highlightAsset(n), name)
const clear = () => page.evaluate(async () => window.EKO_HOST_ENGINE.clearHighlight())
const labels = () => page.evaluate(() => [...document.querySelectorAll('.eko-hvac-labels .eko-hvac-label')].map(e => e.getAttribute('data-key')))
const AHU_BASE = ['faDamperPos', 'preFilter', 'bagFilter', 'coolingValveCmd', 'sfFanStatus']
const AHU_SENSORS = ['raHum', 'raCo2', 'raTemp', 'saHum', 'saPressure', 'saTemp']
const FCU_BASE = ['zoneTemp', 'valvePos', 'valveCmd', 'fanSpeed', 'fanRun']

test('the fixture has an element to link to', { skip }, () => {
  assert.ok(guid, 'a GlobalId was read from the model, so the selections below are real')
})

test('Eko Hospital: the AHU shows its five parts and six sensors as labels', { skip }, async () => {
  await open(EKO())
  assert.equal(await select('HOSPITAL_AHU_01'), true)
  assert.deepEqual(await labels(), [...AHU_BASE, ...AHU_SENSORS])
  await clear()
  assert.deepEqual(await labels(), [], 'nothing left once the selection is cleared')
})

test('Eko Hospital: the FCU shows its five parts and the filter and humidity labels', { skip }, async () => {
  await open(EKO(fcuLinks))
  assert.equal(await select('FCU-GF-01'), true)
  assert.deepEqual(await labels(), [...FCU_BASE, 'filter', 'zoneHum'])
  await clear()
})

test('Marsa, another project and a project with no settings: the AHU has no live labels', { skip }, async () => {
  for (const make of [MARSA, OTHER, OLD]) {
    await open(make())
    assert.equal(await select('HOSPITAL_AHU_01'), true, 'it is still selected and highlighted as before')
    assert.deepEqual(await labels(), [], make().name)
    await clear()
  }
})

test('Marsa, another project and a project with no settings: the FCU is the five-label FCU it was, with no filter or humidity', { skip }, async () => {
  for (const make of [MARSA, OTHER, OLD]) {
    await open(make(fcuLinks))
    assert.equal(await select('FCU-GF-01'), true)
    assert.deepEqual(await labels(), FCU_BASE, make().name)
    await clear()
  }
})

test('switching Eko Hospital -> Marsa -> Eko Hospital: the selection is dropped each time and the next shows that project\'s graphics', { skip }, async () => {
  await open(EKO())
  await select('HOSPITAL_AHU_01')
  assert.equal((await labels()).length, 11, 'Eko Hospital AHU')

  await open(MARSA())
  assert.deepEqual(await labels(), [], 'Marsa: no label of the Hospital AHU is left on screen')
  await select('HOSPITAL_AHU_01')
  assert.deepEqual(await labels(), [], 'Marsa: its AHU has no live labels')
  await clear()

  await open(EKO())
  assert.deepEqual(await labels(), [], 'back in Eko Hospital: nothing carried over from Marsa')
  await select('HOSPITAL_AHU_01')
  assert.equal((await labels()).length, 11, 'back in Eko Hospital: the graphics work again')
  await clear()

  await open(EKO(fcuLinks))
  await select('FCU-GF-01')
  assert.equal((await labels()).length, 7, 'Eko Hospital FCU')
  await open(MARSA(fcuLinks))
  assert.deepEqual(await labels(), [], 'Marsa: the Hospital FCU labels are gone')
  await select('FCU-GF-01')
  assert.deepEqual(await labels(), FCU_BASE, 'Marsa FCU: no filter or humidity')
  await clear()
})

test('a feed of another FIN project is not read: Marsa\'s FCU labels never show the Hospital\'s readings', { skip }, async () => {
  const feed = project => page.evaluate(p => {
    window.DashboardData = { config: { project: p }, equipment: [{ name: 'FCU-GF-01', points: [{ navName: 'FANRUNSTATUS', currentValue: 'On' }] }], stop() {} }
  }, project)
  const fanRun = () => page.evaluate(() => document.querySelector('.eko-hvac-label[data-key="fanRun"] .eko-hvac-label__val')?.textContent)

  await open(MARSA(fcuLinks))
  await feed('ekoHospital')
  await select('FCU-GF-01')
  assert.equal(await fanRun(), '—', 'the Hospital\'s feed is ignored in a project of another FIN project')
  await clear()

  await feed('marsaAlArab')
  await select('FCU-GF-01')
  assert.equal(await fanRun(), 'On', 'the same feed from its own FIN project is read, so the check above can fail')
  await clear()
})

// ── FIN graphics entry (Hospital roof HVAC): the real overlay + the real FIN store, the connected server read when it is opened ──
// The store is set the way fetchStatus/login leave it. The server addresses are TEST INPUTS; no real FIN is contacted.
const setFin = server => page.evaluate(async server => {
  const { useFinStore } = await import('/src/store/useFinStore.ts')
  useFinStore.setState(server
    ? { isConnected: true, status: { connected: true, project_name: 'ekoHospital', server_url: server, display_name: '' } }
    : { isConnected: false, status: null })
}, server)
const graphicUrl = () => page.evaluate(() => (window.INJECTED_PROJECT_CONFIG.graphics || []).map(g => g.url))
const STABLE = '/finMobile/ekoHospital#frame?app=graphics&targetRef=@p:ekoHospital:r:3260abd5-07a0a7b6&url=%2Ffin5%2FekoHospital%3FprojectRef%3D%40p%3AekoHospital%3Ar%3A326dc5ee-27ca9b5a%26title%3DshowSettings%23targetRef%3D%40p%3AekoHospital%3Ar%3A3260abd5-07a0a7b6'

test('FIN graphics: Eko Hospital lists the entry and its URL is the connected FIN server + the stable path; it follows a new address without reopening', { skip }, async () => {
  await open(EKO())
  await setFin('https://192.0.2.10')
  assert.deepEqual(await graphicUrl(), ['https://192.0.2.10' + STABLE])
  await setFin('http://198.51.100.7:8080')   // FIN reconnected on another address
  assert.deepEqual(await graphicUrl(), ['http://198.51.100.7:8080' + STABLE])
  await setFin(null)   // signed out: no address is kept
  assert.deepEqual(await graphicUrl(), [null])
  const cfg = await page.evaluate(() => window.INJECTED_PROJECT_CONFIG.graphics.map(g => [g.id, g.title]))
  assert.deepEqual(cfg, [['hospital-roof-hvac', 'Hospital Roof – HVAC Graphics']])
})

test('FIN graphics: Marsa and other projects have none, and Eko Hospital -> Marsa -> Eko Hospital follows', { skip }, async () => {
  await setFin('https://192.0.2.10')
  for (const [meta, n] of [[MARSA(), 0], [OTHER(), 0], [OLD(), 0], [EKO(), 1], [MARSA(), 0]]) {
    await open(meta)
    assert.equal((await graphicUrl()).length, n, meta.name)
  }
  await setFin(null)
})
