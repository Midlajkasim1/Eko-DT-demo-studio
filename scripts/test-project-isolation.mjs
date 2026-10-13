// Browser test: each project has its own Data Mapping, in the UI, on disk, in the exports and in the backend.
//
//   1. npm run dev                       (Vite on :5173, proxying /api/fin to :8000)
//   2. make sure nothing listens on :8000 (this script starts the backend with a FAKE FIN client)
//   3. node scripts/test-project-isolation.mjs
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
  let last
  while (Date.now() < end) { try { last = await fn(); if (last) return last } catch { /* retry */ } await sleep(150) }
  throw new Error('timed out waiting for ' + what)
}

// ─── projects: every block differs between A and B; C is a normal project with no mappings ───
const base = { version: 1, createdAt: 1, updatedAt: 1, models: [], geolocation: null }
const settingsFor = (n, prefix, order, critical, warning, fin) => ({
  finProjectName: fin,
  finLivePoints: { total_power: `p:{project}:r:${n}`, [`only_${prefix}`]: `p:{project}:r:${n}1` },
  finEndpoints: { [`${prefix}_his`]: `/api/{project}/eval?expr=hisRead(@p:{project}:r:${n},today())` },
  finEquipmentClasses: { system_tags: [prefix === 'A' ? 'ahu' : 'fcu'], meter_tags: ['meter'], type_priority: [prefix === 'A' ? 'ahu' : 'fcu'] },
  finMeterProfile: { prefix: prefix === 'A' ? 'PMU' : 'MTR', point_map: { active_power: [`power ${prefix}`] } },
  finSeverityBands: { order, critical, warning },
})
const A = { ...base, projectId: 'iso-A', name: 'Project A', isFinProject: true, apiSettings: settingsFor(111, 'A', 'desc', 250, 150, 'adnocWarsan') }   // not config.json's own site: that one is served the standard mappings (main.PROJECT_MAPPINGS_DYNAMIC)
const B = { ...base, projectId: 'iso-B', name: 'Project B', isFinProject: true, apiSettings: settingsFor(222, 'B', 'asc', 300, 250, 'ellisdonDemo') }
const C = { ...base, projectId: 'iso-C', name: 'Project C (normal)' }
// a FIN project that has not been given a FIN Project Name yet
const D = { ...base, projectId: 'iso-D', name: 'Project D (FIN, no name)', isFinProject: true }

// ─── backend with the fake FIN client ───
const server = spawn(python, ['tests/fake_fin_server.py', '--port', '8000'], { cwd: path.join(ROOT, 'backend'), stdio: 'ignore' })
const cleanup = async (browser) => { try { await browser?.close() } catch { /* ignore */ } server.kill() }
await until(async () => (await fetch(API + '/api/fin/status')).ok, 'fake backend on :8000', 20000)

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const loginPosts = []
page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/fin/login')) loginPosts.push(r.url()) })
page.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++ })

try {
  await page.goto(APP)
  await page.waitForFunction(() => window.__twin?.stores?.project, null, { timeout: 60000 })

  // open a project: first time writes it to a real (OPFS) folder handle; afterwards it is re-read from disk
  const open = (meta, fresh) => page.evaluate(async ({ meta, fresh }) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(meta.projectId, { create: true })
    if (fresh) {
      const w = await (await dir.getFileHandle('project.json', { create: true })).createWritable()
      await w.write(JSON.stringify(meta)); await w.close()
    }
    const onDisk = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text())
    window.__twin.stores.project.setState({ currentProject: onDisk, folderHandle: dir })
    window.__twin.stores.app.getState().setStep('viewing')
  }, { meta, fresh })
  const disk = id => page.evaluate(async id => {
    const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle(id)
    return JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text())
  }, id)
  const backend = async p => (await fetch(API + p)).json()

  const section = t => page.locator('.ds-field', { has: page.locator(`h3:text-is("${t}")`) }).last()
  const rows = async t => section(t).locator('input[aria-label="Key"]').evaluateAll(ks =>
    ks.map(k => [k.value, k.parentElement.querySelector('input[aria-label="Value"]').value]))
  const openData = async () => { await page.click('text=Dashboard Settings'); await page.waitForSelector('.dashboard-settings-modal'); await page.click('.ds-tab:has-text("Data Mapping")') }
  const close = () => page.click('.ds-close-btn')

  // everything the Data Mapping tab shows, for all five blocks
  const readUi = async () => ({
    live: await rows('FIN Live Points Mapping'),
    endpoints: await rows('FIN Historical Endpoints'),
    equipment: await rows('Equipment Classes'),
    meterPrefix: await section('Meter Profile').locator('input[type=text]').first().inputValue(),
    meterMap: await rows('Meter Profile'),
    sevOrder: await section('Severity Configuration').locator('select').inputValue(),
    sevCritical: await section('Severity Configuration').locator('input').nth(0).inputValue(),
    sevWarning: await section('Severity Configuration').locator('input').nth(1).inputValue(),
  })
  const expectedUi = s => ({
    live: Object.entries(s.finLivePoints),
    endpoints: Object.entries(s.finEndpoints),
    equipment: Object.entries(s.finEquipmentClasses).map(([k, v]) => [k, v.join(', ')]),
    meterPrefix: s.finMeterProfile.prefix,
    meterMap: Object.entries(s.finMeterProfile.point_map).map(([k, v]) => [k, v.join(', ')]),
    sevOrder: s.finSeverityBands.order,
    sevCritical: String(s.finSeverityBands.critical),
    sevWarning: String(s.finSeverityBands.warning),
  })
  const showsProject = async (meta, label) => {
    await openData()
    const ui = await readUi()
    let same = true
    try { assert.deepStrictEqual(ui, expectedUi(meta.apiSettings)) } catch (e) { same = false; console.log(JSON.stringify(ui), '\n vs \n', JSON.stringify(expectedUi(meta.apiSettings))) }
    check(same, `${label}: Data Mapping UI shows ${meta.name}'s five blocks`)
    await close()
  }
  const backendServes = async (meta, label) => {
    const cfg = await until(async () => { const c = await backend('/api/fin/project-settings'); return c.project_id === meta.projectId && c }, `backend to serve ${meta.name}`)
    const s = meta.apiSettings
    assert.deepStrictEqual(cfg.config.live_point_ids, s.finLivePoints)
    assert.deepStrictEqual(cfg.config.power_endpoints, s.finEndpoints)
    assert.deepStrictEqual(cfg.config.equipment_classes, s.finEquipmentClasses)
    assert.deepStrictEqual(cfg.config.meter_profile, s.finMeterProfile)
    assert.deepStrictEqual(cfg.config.severity_bands, s.finSeverityBands)
    check(Object.values(cfg.source).every(v => v === 'project'), `${label}: backend serves ${meta.name}'s five blocks`)
    // and the data it produces follows them
    const want = Number(s.finLivePoints.total_power.split(':').pop())
    const power = await until(async () => (await backend('/api/fin/power-live')).total_power === want, 'power-live for ' + meta.name).then(() => want)
    const hist = Object.keys(await until(async () => { const h = await backend('/api/fin/power-history'); return Object.keys(h).length && h }, 'power-history'))
    const alarms = (await until(async () => { const a = await backend('/api/fin/alarms'); return a.alarms?.length && a }, 'alarms')).alarms
    check(power === want && JSON.stringify(hist) === JSON.stringify(Object.keys(s.finEndpoints)) &&
      alarms[0].severity === (s.finSeverityBands.order === 'desc' ? 'warning' : 'critical'),
      `${label}: API output follows ${meta.name} (total_power=${power}, history=${hist}, severity=${alarms[0].severity})`)
  }

  // ── A, B written to disk; open A ──
  await open(A, true); await open(B, true); await open(A, false)
  await page.waitForSelector('text=Dashboard Settings')
  await showsProject(A, 'A')

  // ── connect the backend through the UI (the only login of this run) ──
  await page.fill('#fin-username', 'tester'); await page.fill('#fin-password', 'secret')
  await page.click('button:has-text("Connect")')
  await page.waitForSelector('text=Connected', { timeout: 10000 })
  await backendServes(A, 'A (after login)')

  // ── A -> B ──
  await open(B, false)
  await showsProject(B, 'A->B')
  await backendServes(B, 'A->B')

  // ── edit B's live point, save: only B changes, in the UI, on disk and in the backend ──
  await openData()
  await section('FIN Live Points Mapping').locator('input[aria-label="Value"]').first().fill('p:{project}:r:333')
  await page.click('text=Save Settings'); await page.waitForSelector('.dashboard-settings-modal', { state: 'detached' })
  const diskA = await disk('iso-A'); const diskB = await disk('iso-B')
  check(diskB.apiSettings.finLivePoints.total_power === 'p:{project}:r:333', 'B edit saved into B project.json')
  check(JSON.stringify(diskA.apiSettings) === JSON.stringify(A.apiSettings), 'A project.json untouched by the edit')
  const B2 = { ...B, apiSettings: diskB.apiSettings }
  await backendServes(B2, 'B edited')

  // ── B -> A -> B ──
  await open(A, false)
  await showsProject(A, 'B->A')
  await backendServes(A, 'B->A')
  await open(B, false)
  await showsProject(B2, 'A->B again (edit kept)')
  await backendServes(B2, 'A->B again')

  // ── a normal project (C) while connected: all tabs, empty mapping, backend back on config.json defaults ──
  await open(C, true)
  await page.click('text=Dashboard Settings'); await page.waitForSelector('.dashboard-settings-modal')
  const tabs = await page.$$eval('.ds-tab', e => e.map(x => x.textContent.trim()))
  check(tabs.length === 5 && tabs.includes('FIN Config') && tabs.includes('Data Mapping'), 'C (normal project): Dashboard Settings shows all five tabs')
  await page.click('.ds-tab:has-text("Data Mapping")')
  // an unset block lists its keys as blank rows; no value from A or B is filled in
  const blank = async t => { const r = await rows(t); return r.length > 0 && r.every(([, v]) => v === '') }
  check(await blank('FIN Live Points Mapping') && await blank('Equipment Classes'), 'C: Data Mapping has only blank rows (no mappings from A or B)')
  await close()
  const cfgC = await until(async () => { const c = await backend('/api/fin/project-settings'); return c.project_id === 'iso-C' && c }, 'backend to serve C')
  check(Object.values(cfgC.source).every(v => v === 'not_configured') && Object.values(cfgC.config).every(v => JSON.stringify(v) === '{}'),
    'C: backend serves no mapping for C: neither B\'s nor config.json\'s')
  const stC = await backend('/api/fin/status')
  check(stC.project_name === '' && stC.project_source === 'unset' && stC.display_name === '' && stC.project_validated === null,
    'C: no FIN project name is shown as unconfigured, not as the default site (' + JSON.stringify([stC.project_name, stC.project_source]) + ')')

  // ── real navigation: project list -> open A ──
  await page.evaluate(() => window.__twin.stores.app.getState().setStep('projects'))
  await open(A, false)
  await backendServes(A, 'list->A')

  // ── export carries the project's own settings, not another project's ──
  // the zips are built in the page (the real export code) and unpacked here
  const zips = await page.evaluate(async () => {
    const db = await import('/src/lib/projectDb.ts')
    const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('iso-B')
    const meta = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text())
    const b64 = async blob => {
      const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(s)
    }
    return { backend: await b64(await db.exportProjectAsZip(dir, meta)), fin: await b64(await db.exportFinProjectAsZip(dir, meta)) }
  })
  const { default: JSZip } = await import('jszip')
  const unzip = async (b64, name) => JSON.parse(await (await JSZip.loadAsync(Buffer.from(b64, 'base64'))).file(name).async('string'))
  const exported = {
    backend: await unzip(zips.backend, 'backend/project.json'),
    fin: await unzip(zips.fin, 'project.json'),
    finApi: await unzip(zips.fin, 'api-config.json'),
  }
  for (const k of ['finLivePoints', 'finEndpoints', 'finEquipmentClasses', 'finMeterProfile', 'finSeverityBands']) {
    assert.deepStrictEqual(exported.backend.apiSettings[k], B2.apiSettings[k], 'backend export ' + k)
    assert.deepStrictEqual(exported.fin.apiSettings[k], B2.apiSettings[k], 'fin export ' + k)
  }
  check(true, 'export with backend / FIN viewer export: project.json carries B\'s five blocks (incl. the edit)')
  check(exported.finApi.live_point_ids.total_power === 'p:{project}:r:333' && exported.finApi.severity_bands.order === 'asc' &&
    exported.finApi.meter_profile.prefix === 'MTR' && !JSON.stringify(exported).includes('p:{project}:r:111'),
    'FIN viewer api-config.json has B\'s mappings and none of A\'s')

  check(loginPosts.length === 1, `exactly one /api/fin/login (the explicit Connect), got ${loginPosts.length}`)

  // ═══ Mapping validation (the fake FIN has no point whose ID ends ":999", and no project "ghost") ═══
  const badges = (t, status) => section(t).locator(status ? `[data-status="${status}"]` : '[data-status]')
  const liveT = 'FIN Live Points Mapping'
  const validate = async () => { await page.click('button:has-text("Validate Mapping")'); await page.waitForSelector('text=Nothing was changed') }

  // A: both configured live points exist -> two ✓ Valid, nothing else
  await open(A, false)
  await openData()
  check(await badges(liveT).count() === 0, 'A: no validation badges before Validate Mapping is pressed')
  await validate()
  check(await badges(liveT, 'valid').count() === 2, 'A: Validate Mapping marks both live points ✓ Valid')
  check((await badges(liveT, 'valid').first().innerText()).includes('Valid'), 'A: badge reads "✓ Valid"')
  // meter prefix is checked against equipment once the first poll has landed
  await until(async () => { await validate(); return (await badges('Meter Profile', 'valid').count()) >= 1 }, 'meter prefix ✓ Valid')
  check(true, 'A: meter prefix PMU ✓ Valid against the fake FIN equipment')

  // editing a row makes its old result disappear; a missing point shows ✕ Not Found and is NOT removed
  await section(liveT).locator('input[aria-label="Value"]').first().fill('p:{project}:r:999')
  check(await badges(liveT).count() === 0, 'A: editing a block clears its (now stale) validation badges')
  await validate()
  const nf = badges(liveT, 'not_found')
  check(await nf.count() === 1 && (await nf.first().innerText()).includes('Not Found'), 'A: a point FIN does not have shows ✕ Not Found')
  check((await rows(liveT))[0][1] === 'p:{project}:r:999' && (await rows(liveT)).length === 2, 'A: the invalid mapping stays in the editor, not deleted')
  check(await badges(liveT, 'valid').count() === 1, 'A: the other live point is still ✓ Valid')
  await close()
  check(JSON.stringify((await disk('iso-A')).apiSettings) === JSON.stringify(A.apiSettings), 'A: validating wrote nothing to project.json')

  // B (A -> B): B's own mappings, no leftover result from A, and A's invalid point does not leak
  await open(B, false)
  await openData()
  check(await badges(liveT).count() === 0, 'A->B: no validation result carried over from A')
  await validate()
  check(await badges(liveT, 'valid').count() === Object.keys(B2.apiSettings.finLivePoints).length &&
    await badges(liveT, 'not_found').count() === 0, 'A->B: B validates against its own mappings, A\'s invalid point is not B\'s')
  await close()
  // B -> A: A's unsaved edit is gone, A's saved mapping is valid again
  await open(A, false)
  await openData()
  await validate()
  check(await badges(liveT, 'valid').count() === 2 && await badges(liveT, 'not_found').count() === 0, 'B->A: A\'s saved mappings are ✓ Valid again')
  await close()

  // C (normal project, no mappings): Not Configured, and none of config.json's Marsa IDs on screen
  await open(C, false)
  await openData()
  const body = () => page.locator('.dashboard-settings-modal').innerText()
  check((await body()).includes('No project-specific mappings configured'), 'C: "No project-specific mappings configured" is shown')
  check(await badges(liveT, 'not_configured').count() === 1 && (await rows(liveT)).every(([, v]) => v === ''), 'C: Live Points reads — Not Configured, with blank rows only')
  check(!(await body()).includes('3181ee6e') && !(await body()).includes('r:111'), 'C: no config.json / other-project point IDs are displayed')
  await validate()
  check(await page.locator('.dashboard-settings-modal [data-status="not_configured"]').count() >= 5 &&
    !(await body()).includes('config.json'), 'C: after Validate every block is Not Configured, with no config.json default behind it')
  check(!(await body()).includes('3181ee6e'), 'C: still no default point IDs after validating')
  await close()

  // ── connection validation and the FIN Project Name ──
  const typeProject = async name => {
    await page.click('button:has-text("Disconnect")')
    await page.waitForSelector('#fin-username')
    await page.fill('#fin-username', 'tester'); await page.fill('#fin-password', 'secret')
    if (!(await page.locator('#fin-project').count())) await page.click('.fin-advanced-toggle')
    await page.fill('#fin-project', name)
    await page.click('button:has-text("Connect")')
  }
  const nameField = () => page.locator('.ds-field', { has: page.locator('label:text-is("FIN Project")') }).locator('input, select').first()
  const openFin = async () => { await page.click('text=Dashboard Settings'); await page.waitForSelector('.dashboard-settings-modal'); await page.click('.ds-tab:has-text("FIN Config")') }

  await open(D, true)
  await typeProject('ghost')
  await page.waitForSelector('text=could not be validated', { timeout: 10000 })
  check(await page.locator('text=Not validated').count() > 0 && await page.locator('text=Project validated').count() === 0,
    'ghost project: signed in but NOT reported as a validated FIN connection')
  await typeProject('typedA')
  await page.waitForSelector('text=Project validated', { timeout: 10000 })
  check(await page.locator('text=could not be validated').count() === 0, 'real project: ✓ FIN Connected / ✓ Project validated')
  await openFin()
  check(await nameField().inputValue() === 'typedA', 'D: FIN Project Name is filled with the name this project was connected with')
  await close()
  check((await disk('iso-D')).apiSettings === undefined, 'D: that name is only a draft until Save Settings (nothing written)')
  // another project must not receive A's connection name
  await open(B, false)
  await openFin()
  check(await nameField().inputValue() === 'ellisdonDemo', 'D->B: B shows its own FIN Project Name, not the name D connected with')
  await close()
  await open(D, false)
  await openFin()
  check(await nameField().inputValue() === '', 'B->D: the connection name was not saved into D by switching')
  await close()
} catch (e) {
  console.log('ERROR', e.stack || e.message)
  failures++
} finally {
  await cleanup(browser)
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PROJECT-ISOLATION CHECKS PASSED')
process.exit(failures ? 1 : 0)
