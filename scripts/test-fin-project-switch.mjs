// Browser test: Dashboard Settings > Data Mapping follows the FIN project selected in FIN Config.
//
//   1. npm run dev                       (Vite on :5173, proxying /api/fin to :8000)
//   2. make sure nothing listens on :8000 (this script starts the backend with a FAKE FIN client)
//   3. node scripts/test-fin-project-switch.mjs
//
// Needs Playwright (devDependency) and Microsoft Edge, or set PW_CHANNEL=chrome. PYTHON overrides the interpreter.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = process.env.APP_URL || 'http://localhost:5173'
const API = 'http://127.0.0.1:8000'
const python = process.env.PYTHON || path.join(ROOT, 'backend', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')

let failures = 0
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++ }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 10000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { try { const v = await fn(); if (v) return v } catch { /* retry */ } await sleep(100) }
  throw new Error('timed out waiting for ' + what)
}

// The FIN project this Eko-DT project saved. The other projects come from the (fake) FIN server.
const SAVED = 'adnocWarsan'   // not config.json's own site: that one is served the standard mappings (main.PROJECT_MAPPINGS_DYNAMIC)
const meta = {
  version: 1, createdAt: 1, updatedAt: 1, models: [], geolocation: null,
  projectId: 'switch-1', name: 'Switch test', isFinProject: true,
  apiSettings: { finProjectName: SAVED, finLivePoints: { total_power: 'p:{project}:r:111' } },
}

const server = spawn(python, ['tests/fake_fin_server.py', '--port', '8000'], { cwd: path.join(ROOT, 'backend'), stdio: 'ignore' })
await until(async () => (await fetch(API + '/api/fin/status')).ok, 'fake backend on :8000', 20000)
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++ })

// Every /api/fin/resources request is answered here, so the test decides when and with what each
// one finishes. The points are generated from the requested project, never listed in advance.
const requested = []
const held = new Map()         // project -> release(), for a request that must not finish yet
let hold = new Set()           // projects whose next request is held
const body = project => ({
  project, truncated: false,
  resources: [1, 2, 3].map(n => ({
    id: `p:${project}:r:${n}`, ref: `p:{project}:r:${n}-${project.slice(0, 4)}`, name: `${project} point ${n}`,
    navName: null, equip: null, unit: null, his: false,
  })),
})
await page.route('**/api/fin/resources?*', async route => {
  const project = new URL(route.request().url()).searchParams.get('project')
  requested.push(project)
  if (hold.has(project)) {
    hold.delete(project)
    await new Promise(release => held.set(project, release))
  }
  const real = await route.fetch()                   // the real backend still decides the status
  await route.fulfill(real.ok()
    ? { status: 200, contentType: 'application/json', body: JSON.stringify(body(project)) }
    : { response: real })
})

// The keys of each block, as the backend describes them (names only)
const schema = await (await fetch(API + '/api/fin/mapping-schema')).json()
const KV_TITLES = {
  finLivePoints: 'FIN Live Points Mapping', finEndpoints: 'FIN Historical Endpoints',
  finEquipmentClasses: 'Equipment Classes', finMeterProfile: 'Meter Profile',
}
const BLOCKS = ['finLivePoints', 'finEndpoints', 'finEquipmentClasses', 'finMeterProfile', 'finSeverityBands']

try {
  await page.goto(APP)
  await page.waitForFunction(() => window.__twin?.stores?.project, null, { timeout: 60000 })

  // open an Eko-DT project: written to a real (OPFS) folder when fresh, then always re-read from disk
  const openProject = (m, fresh) => page.evaluate(async ({ m, fresh }) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(m.projectId, { create: true })
    if (fresh) {
      const w = await (await dir.getFileHandle('project.json', { create: true })).createWritable()
      await w.write(JSON.stringify(m)); await w.close()
    }
    const onDisk = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text())
    window.__twin.stores.project.setState({ currentProject: onDisk, folderHandle: dir })
    window.__twin.stores.app.getState().setStep('viewing')
  }, { m, fresh })
  const disk = id => page.evaluate(async id => {
    const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle(id)
    return JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text()).apiSettings ?? {}
  }, id)

  await openProject(meta, true)
  await page.waitForSelector('text=Dashboard Settings')
  await page.fill('#fin-username', 'tester'); await page.fill('#fin-password', 'secret')
  await page.click('button:has-text("Connect")')
  await page.waitForSelector('text=Connected', { timeout: 10000 })

  const openSettings = async () => { await page.click('button:has-text("Dashboard Settings")'); await page.waitForSelector('.dashboard-settings-modal') }
  const save = async () => {
    await page.click('button:has-text("Save Settings")')
    try { await page.waitForSelector('.dashboard-settings-modal', { state: 'detached', timeout: 5000 }) } catch (e) {
      const why = await page.locator('.dashboard-settings-modal [style*="var(--red)"]').allInnerTexts()
      throw new Error('Save did not close the settings: ' + JSON.stringify(why))
    }
  }
  const picker = page.locator('.ds-field', { has: page.locator('label:text-is("FIN Project")') }).locator('select')
  const section = title => page.locator('.ds-field', { has: page.locator(`h3:text-is("${title}")`) }).last()
  const keysIn = title => section(title).locator('input[aria-label="Key"]').evaluateAll(k => k.map(x => x.value))
  const valuesIn = title => section(title).locator('input[aria-label="Value"]').evaluateAll(v => v.map(x => x.value))
  const live = section(KV_TITLES.finLivePoints)
  const keys = () => keysIn(KV_TITLES.finLivePoints)
  const values = () => valuesIn(KV_TITLES.finLivePoints)

  await openSettings()
  await picker.waitFor()
  await until(async () => (await picker.locator('option').count()) > 1, 'project list')
  const ids = await picker.locator('option').evaluateAll(o => o.map(x => x.value).filter(Boolean))
  const other = ids.find(i => i !== SAVED)

  const pick = async id => {
    await page.click('.ds-tab:has-text("FIN Config")'); await picker.selectOption(id)
    await page.click('.ds-tab:has-text("Data Mapping")')
  }
  const status = () => page.locator('[data-testid="fin-resources-status"]').first().innerText().catch(() => '')
  // the FIN points offered for a Live Points value (the Power Boards editor offers mapping keys, not points)
  const offered = () => page.locator('.ds-field', { has: page.locator('h3:text-is("FIN Live Points Mapping")') }).locator('datalist option')
    .evaluateAll(o => o.map(x => x.textContent))
  const showsPoints = async (project, label) => {
    try {
      await until(async () => (await status()).includes(`3 points available from FIN project ${project}.`), `status for ${project}`)
      const names = await offered()
      check(names.length === 3 && names.every(t => t.startsWith(project)), `${label}: the 3 points offered all belong to ${project}`)
    } catch (e) { check(false, `${label}: ${e.message} -- status was "${await status()}"`) }
  }

  await page.click('.ds-tab:has-text("Data Mapping")')
  await showsPoints(SAVED, 'saved project')

  // ── FIN project A -> B -> A ──
  await pick(other); await showsPoints(other, `${SAVED} -> ${other}`)
  check(requested.includes(other), `GET /api/fin/resources?project=${other} was requested`)
  await pick(SAVED); await showsPoints(SAVED, `${other} -> ${SAVED}`)

  // the saved Eko-DT mapping is untouched by switching the FIN project
  check(JSON.stringify(await values()) === JSON.stringify(['p:{project}:r:111']), 'saved Live Points rows unchanged by the switch')

  // ── stale answer: A is still loading when B is chosen; B answers, then A finishes late ──
  hold = new Set([SAVED])
  await pick(other)
  await pick(SAVED)                                  // the request for SAVED starts and is held
  await until(async () => held.has(SAVED), 'held request for ' + SAVED)
  await pick(other)                                  // the user switches away while it is running
  await showsPoints(other, 'stale case, B answered')
  held.get(SAVED)()                                  // A finishes late
  await sleep(600)
  const after = await status()
  check(after.includes(`from FIN project ${other}.`) && !after.includes(SAVED),
    `stale case: the late answer for ${SAVED} did not replace ${other} (status: "${after}")`)
  const names = await offered()
  check(names.length === 3 && names.every(t => t.startsWith(other)), `stale case: the points offered still belong to ${other}`)

  // ── a project with NO saved Live Points mapping: the keys are offered, nothing is assigned ──
  await page.click('.ds-close-btn')
  const meta2 = { ...meta, projectId: 'switch-2', name: 'Switch test, no mapping', apiSettings: { finProjectName: SAVED } }
  await openProject(meta2, true)
  await openSettings()
  await page.click('.ds-tab:has-text("Data Mapping")')
  await showsPoints(SAVED, 'no saved mapping')
  const mappingKeys = schema.finLivePoints
  check(mappingKeys.length > 0 && JSON.stringify(await keys()) === JSON.stringify(mappingKeys),
    `no saved mapping: the ${mappingKeys.length} Eko-DT keys from the backend are listed as rows`)
  check((await values()).every(v => v === ''), 'no saved mapping: no FIN point was assigned to any key')
  check(await live.locator('[data-testid="fin-points-hint"]').count() === 1, 'the Live Points block says FIN points can be chosen')
  const listId = await live.locator('input[aria-label="Value"]').first().getAttribute('list')
  const optionsOf = id => page.locator(`datalist[id="${id}"] option`).evaluateAll(o => o.map(x => x.textContent))
  check(listId && (await optionsOf(listId)).every(t => t.startsWith(SAVED)), `Value fields offer the ${SAVED} points`)

  // the user chooses a point for the first key
  const choice = await page.locator(`datalist[id="${listId}"] option`).first().getAttribute('value')
  await live.locator('input[aria-label="Value"]').first().fill(choice)
  // ...and switches the FIN project: the choice stays, the offered points change
  await pick(other)
  await showsPoints(other, 'chosen value kept: switched')
  const keptValues = await values()
  check(keptValues[0] === choice && keptValues.slice(1).every(v => v === ''), 'the user choice is kept when the FIN project changes')
  check(JSON.stringify(await keys()) === JSON.stringify(mappingKeys), 'the key rows are kept when the FIN project changes')
  const listB = await live.locator('input[aria-label="Value"]').nth(1).getAttribute('list')
  check(listB && (await optionsOf(listB)).every(t => t.startsWith(other)), `Value fields now offer the ${other} points`)
  await pick(SAVED)
  await showsPoints(SAVED, 'switched back')
  const listA = await live.locator('input[aria-label="Value"]').nth(1).getAttribute('list')
  check(listA && (await optionsOf(listA)).every(t => t.startsWith(SAVED)), `Value fields offer the ${SAVED} points again`)
  check((await values())[0] === choice, 'the user choice is still there after switching back')

  // saving writes only what was chosen, not the blank keys
  await save()
  const saved = await disk('switch-2')
  check(JSON.stringify(saved.finLivePoints) === JSON.stringify({ [mappingKeys[0]]: choice }), 'saved Live Points hold only the chosen mapping (blank keys are not written)')
  check(BLOCKS.filter(b => b !== 'finLivePoints').every(b => !(b in saved)), 'the untouched blocks were not written either')

  // ── a brand-new Eko-DT project: every block is shown as blank, editable fields ──
  const fresh = { ...meta, projectId: 'switch-new', name: 'Brand new project', apiSettings: undefined }
  await openProject(fresh, true)
  await openSettings()
  await page.click('.ds-tab:has-text("Data Mapping")')
  for (const [field, title] of Object.entries(KV_TITLES)) {
    const k = await until(async () => { const v = await keysIn(title); return v.length && v }, `${title} rows`).catch(() => [])
    check(schema[field].length > 0 && JSON.stringify(k) === JSON.stringify(schema[field]), `new project: ${title} lists its ${schema[field].length} keys as rows`)
    check((await valuesIn(title)).every(v => v === ''), `new project: ${title} has no value filled in`)
  }
  const meter = section('Meter Profile')
  const severity = section('Severity Configuration')
  check(await meter.locator('input[type=text]').first().inputValue() === '', 'new project: meter prefix is blank')
  check(await severity.locator('select').inputValue() === '' &&
    await severity.locator('input').nth(0).inputValue() === '' && await severity.locator('input').nth(1).inputValue() === '',
    'new project: severity direction / critical / warning are blank')
  check(await page.locator('.dashboard-settings-modal button', { hasText: /^Load / }).count() === 0, 'new project: no "Load <site>" preset buttons')
  const blockTitles = [...Object.values(KV_TITLES), 'Severity Configuration']
  const unset = await Promise.all(blockTitles.map(t => section(t).locator('[data-testid="block-unset"]').count()))
  check(blockTitles.length === BLOCKS.length && unset.every(n => n === 1), 'new project: each block says it is not set for this project yet')
  check(await section('Power Boards').locator('[data-testid="block-unset"]').count() === 1, 'new project: Power Boards are not set either (the built-in boards apply)')
  await save()                                       // nothing entered, so nothing is written
  const freshSaved = await disk('switch-new')
  check(BLOCKS.every(b => !(b in freshSaved)), 'new project: Save with nothing entered writes no mapping block')

  // ── two projects configured through the UI, then A -> B -> A ──
  const configure = async (m, finProject, tag, order, critical, warning) => {
    await openProject(m, true)
    await openSettings()
    await page.click('.ds-tab:has-text("FIN Config")'); await picker.selectOption(finProject)
    await page.click('.ds-tab:has-text("Data Mapping")')
    await showsPoints(finProject, `${tag}: configure`)
    const point = await page.locator('datalist option').first().getAttribute('value')
    await live.locator('input[aria-label="Value"]').first().fill(point)
    await section(KV_TITLES.finEndpoints).locator('input[aria-label="Value"]').first().fill(`/api/{project}/eval?expr=hisRead(${tag})`)
    await section(KV_TITLES.finEquipmentClasses).locator('input[aria-label="Value"]').first().fill(`${tag}_tag1, ${tag}_tag2`)
    await meter.locator('input[type=text]').first().fill(`${tag}PFX`)
    await meter.locator('input[aria-label="Value"]').first().fill(`${tag} alias`)
    await severity.locator('select').selectOption(order)
    await severity.locator('input').nth(0).fill(String(critical))
    await severity.locator('input').nth(1).fill(String(warning))
    await save()
    return {
      finProjectName: finProject,
      finLivePoints: { [schema.finLivePoints[0]]: point },
      finEndpoints: { [schema.finEndpoints[0]]: `/api/{project}/eval?expr=hisRead(${tag})` },
      finEquipmentClasses: { [schema.finEquipmentClasses[0]]: [`${tag}_tag1`, `${tag}_tag2`] },
      finMeterProfile: { prefix: `${tag}PFX`, point_map: { [schema.finMeterProfile[0]]: [`${tag} alias`] } },
      finSeverityBands: { order, critical, warning },
    }
  }
  const pA = { ...meta, projectId: 'switch-A', name: 'Project A', apiSettings: undefined }
  const pB = { ...meta, projectId: 'switch-B', name: 'Project B', apiSettings: undefined }
  const wantA = await configure(pA, SAVED, 'AAA', 'desc', 90, 40)
  const wantB = await configure(pB, other, 'BBB', 'asc', 3, 7)

  const savedIs = async (id, want, label) => {
    const s = await disk(id)
    const got = Object.fromEntries(['finProjectName', ...BLOCKS].map(k => [k, s[k]]))
    let same = true
    try { assert.deepStrictEqual(got, want) } catch { same = false; console.log(JSON.stringify(got), '\n vs \n', JSON.stringify(want)) }
    check(same, `${label}: project.json holds exactly what was entered for it`)
  }
  await savedIs('switch-A', wantA, 'A')
  await savedIs('switch-B', wantB, 'B')

  const showsConfig = async (m, want, notTag, label) => {
    await openProject(m, false)
    await openSettings()
    await page.click('.ds-tab:has-text("FIN Config")')
    check(await picker.inputValue() === want.finProjectName, `${label}: FIN project is ${want.finProjectName}`)
    await page.click('.ds-tab:has-text("Data Mapping")')
    const ui = {
      live: (await valuesIn(KV_TITLES.finLivePoints))[0],
      endpoint: (await valuesIn(KV_TITLES.finEndpoints))[0],
      equipment: (await valuesIn(KV_TITLES.finEquipmentClasses))[0],
      prefix: await meter.locator('input[type=text]').first().inputValue(),
      alias: (await valuesIn(KV_TITLES.finMeterProfile))[0],
      severity: [await severity.locator('select').inputValue(), await severity.locator('input').nth(0).inputValue(), await severity.locator('input').nth(1).inputValue()],
    }
    const expected = {
      live: Object.values(want.finLivePoints)[0],
      endpoint: Object.values(want.finEndpoints)[0],
      equipment: Object.values(want.finEquipmentClasses)[0].join(', '),
      prefix: want.finMeterProfile.prefix,
      alias: Object.values(want.finMeterProfile.point_map)[0].join(', '),
      severity: [want.finSeverityBands.order, String(want.finSeverityBands.critical), String(want.finSeverityBands.warning)],
    }
    check(JSON.stringify(ui) === JSON.stringify(expected), `${label}: all five blocks show this project's values ${JSON.stringify(ui)}`)
    const allValues = await page.locator('.dashboard-settings-modal input').evaluateAll(i => i.map(x => x.value).join(' '))
    check(!allValues.includes(notTag), `${label}: none of the other project's values is shown`)
    await page.click('.ds-close-btn')
  }
  await showsConfig(pA, wantA, 'BBB', 'A')
  await showsConfig(pB, wantB, 'AAA', 'A -> B')
  await showsConfig(pA, wantA, 'BBB', 'B -> A')
  await savedIs('switch-A', wantA, 'A after A -> B -> A')
  await savedIs('switch-B', wantB, 'B after A -> B -> A')
} catch (e) {
  console.log('ERROR', e.message); failures++
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT }).catch(() => {})
} finally {
  await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
  await browser.close()
  server.kill()
}

console.log(failures ? `\n${failures} FAILED` : '\nAll passed')
process.exit(failures ? 1 : 0)
