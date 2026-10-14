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
    // the dashboard drops data stamped for another project, so the stamp must name this one
    const stamp = (await fetch(API + '/api/fin/power-live')).headers.get('x-eko-project')
    check(stamp === meta.projectId, `${label}: live data is stamped for ${meta.projectId} (got ${stamp})`)
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
  check(diskB.apiSettings.schemaVersion === 1, 'Save Settings stamps the settings schema version')
  const B2 = { ...B, apiSettings: diskB.apiSettings }
  await backendServes(B2, 'B edited')

  // ── FIN Config fields persist: save, reopen from disk, shown again ──
  const finField = label => page.locator('.ds-field', { has: page.locator(`label:text-is("${label}")`) }).locator('input').first()
  await page.click('text=Dashboard Settings'); await page.waitForSelector('.dashboard-settings-modal'); await page.click('.ds-tab:has-text("FIN Config")')
  await finField('Display Name').fill('Bee Site')
  await finField('Site Timezone').fill('Asia/Riyadh')
  await page.click('text=Save Settings'); await page.waitForSelector('.dashboard-settings-modal', { state: 'detached' })
  const diskB3 = await disk('iso-B')
  check(diskB3.apiSettings.finDisplayName === 'Bee Site' && diskB3.apiSettings.siteTimezone === 'Asia/Riyadh' &&
    JSON.stringify(diskB3.apiSettings.finLivePoints) === JSON.stringify(diskB.apiSettings.finLivePoints),
    'B: display name and timezone saved into project.json, mappings unchanged')
  await open(A, false); await open(B, false)                                           // close and reopen B from disk
  await page.click('text=Dashboard Settings'); await page.waitForSelector('.dashboard-settings-modal'); await page.click('.ds-tab:has-text("FIN Config")')
  check(await finField('Display Name').inputValue() === 'Bee Site' && await finField('Site Timezone').inputValue() === 'Asia/Riyadh',
    'B reopened: display name and timezone restored in FIN Config')
  // reporting basis: a rate of 0 is refused, nothing is written
  await finField('Electricity Tariff (per kWh)').fill('0')
  await page.click('text=Save Settings')
  await page.waitForSelector('text=Not saved.', { timeout: 5000 }).catch(() => {})
  check((await page.locator('.dashboard-settings-modal').innerText()).includes('Electricity tariff must be a number above zero') &&
    (await disk('iso-B')).apiSettings.energyTariff === undefined, 'reporting basis: a tariff of 0 is not saved')
  await finField('Electricity Tariff (per kWh)').fill('0.42')
  await finField('Currency').fill('sar')
  await finField('CO₂ Factor (kg per kWh)').fill('0.5')
  await finField('Tariff Name').fill('Bee Tariff')
  await page.click('text=Save Settings'); await page.waitForSelector('.dashboard-settings-modal', { state: 'detached' })
  const basisDisk = (await disk('iso-B')).apiSettings
  check(basisDisk.energyTariff === 0.42 && basisDisk.currency === 'SAR' && basisDisk.co2Factor === 0.5 && basisDisk.tariffName === 'Bee Tariff' &&
    basisDisk.gasTariff === undefined && basisDisk.dashboardDemo === undefined, 'reporting basis saved into B\'s project.json; unset rates stay unset')
  check((await disk('iso-A')).apiSettings.energyTariff === undefined, 'A got none of B\'s rates')
  await open(A, false); await open(B, false)
  await page.click('text=Dashboard Settings'); await page.waitForSelector('.dashboard-settings-modal'); await page.click('.ds-tab:has-text("FIN Config")')
  check(await finField('Electricity Tariff (per kWh)').inputValue() === '0.42' && await finField('Currency').inputValue() === 'SAR' &&
    await page.locator('label:has-text("Show the prototype\'s demo figures") input').isChecked() === false,
    'B reopened: reporting basis restored, demo figures off')
  await close()
  await open(A, false)
  await page.click('text=Dashboard Settings'); await page.waitForSelector('.dashboard-settings-modal'); await page.click('.ds-tab:has-text("FIN Config")')
  check(await finField('Electricity Tariff (per kWh)').inputValue() === '' && await finField('Currency').inputValue() === '', 'A shows no rate of its own (none from B)')
  await close()
  await open(B, false)
  B2.apiSettings = (await disk('iso-B')).apiSettings
  await page.click('text=Dashboard Settings'); await page.waitForSelector('.dashboard-settings-modal')   // the checks below close it
  check(await page.evaluate(() => window.INJECTED_PROJECT_CONFIG === undefined || window.INJECTED_PROJECT_CONFIG.projectId === 'iso-B'),
    'B reopened: any injected dashboard config names B')
  await close()
  B2.apiSettings = diskB3.apiSettings

  // ── a save that cannot be written is reported, and changes nothing ──
  await openData()
  await page.evaluate(() => {
    const s = window.__twin.stores.project
    window.__realHandle = s.getState().folderHandle
    const fail = async () => { throw new Error('disk is read-only') }
    s.setState({ folderHandle: { kind: 'directory', name: 'broken', getFileHandle: fail, getDirectoryHandle: fail } })
  })
  await section('FIN Live Points Mapping').locator('input[aria-label="Value"]').first().fill('p:{project}:r:444')
  await page.click('text=Save Settings')
  await page.waitForSelector('text=Not saved.', { timeout: 5000 }).catch(() => {})
  const failText = await page.locator('.dashboard-settings-modal').innerText().catch(() => '')
  const inStore = await page.evaluate(() => window.__twin.stores.project.getState().currentProject.apiSettings.finLivePoints.total_power)
  check(failText.includes('Not saved.') && failText.includes('disk is read-only'), 'failed write: "Not saved" and the reason are shown')
  check(await page.locator('.dashboard-settings-modal').count() === 1, 'failed write: the modal stays open with the edit')
  check(inStore === 'p:{project}:r:333' && (await disk('iso-B')).apiSettings.finLivePoints.total_power === 'p:{project}:r:333',
    'failed write: neither the open project nor project.json took the unsaved value')
  await page.evaluate(() => window.__twin.stores.project.setState({ folderHandle: window.__realHandle }))
  await close()

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

  // ── Power Boards: add / validate / delete / save / restore / edit, per project ──
  const boardsSec = () => section('Power Boards')
  const boardRows = () => boardsSec().locator('input[aria-label="Board name"]').evaluateAll(ns => ns.map(n => {
    const row = n.parentElement, v = l => row.querySelector(`input[aria-label="${l}"]`).value
    return [v('Board name'), v('Live key'), v('History key'), v('Meter')] }))
  const fillBoard = async (i, [name, live, his, meter]) => {
    const f = l => boardsSec().locator(`input[aria-label="${l}"]`).nth(i)
    await f('Board name').fill(name); await f('Live key').fill(live); await f('History key').fill(his); await f('Meter').fill(meter)
  }
  // the Save button itself (an unset block's note also says "Save Settings"); the save must be refused, not just flagged
  const saveBtn = '.dashboard-settings-modal button:has-text("Save Settings")'
  const saveExpectingError = async text => {
    await page.click(saveBtn)
    await page.waitForSelector('text=Not saved.', { timeout: 5000 }).catch(() => {})
    const t = await page.locator('.dashboard-settings-modal').innerText()
    return t.includes('Not saved. Power board') && t.includes(text)
  }
  await open(B, false)
  const boardsBefore = (await disk('iso-B')).apiSettings.finPowerBoards
  await openData()
  check(await boardsSec().locator('[data-testid="block-unset"]').count() === 1 && (await boardRows()).length === 0, 'Power Boards: not set for B yet')
  await boardsSec().locator('button:has-text("+ Add board")').click()
  await fillBoard(0, ['Main Board', 'total_power', 'B_his', 'MTR-1'])
  await boardsSec().locator('button:has-text("+ Add board")').click()
  await fillBoard(1, ['main board', 'only_B', '', ''])
  check(await saveExpectingError('another board already has this name') && (await disk('iso-B')).apiSettings.finPowerBoards === boardsBefore,
    'Power Boards: a duplicate name is refused and nothing is written')
  await fillBoard(1, ['Aux Board', 'mcc1', '', ''])
  check(await saveExpectingError('"mcc1" is not a key of this project\'s FIN Live Points Mapping'), 'Power Boards: another site\'s key (mcc1) is refused for B')
  await fillBoard(1, ['Aux Board', 'only_B', '', ''])
  await boardsSec().locator('button:has-text("+ Add board")').click()
  await fillBoard(2, ['Temporary', 'total_power', '', ''])
  await boardsSec().locator('button[aria-label="Delete board 3"]').click()
  await page.click(saveBtn); await page.waitForSelector('.dashboard-settings-modal', { state: 'detached' })
  const wantBoards = [{ name: 'Main Board', liveKey: 'total_power', historyKey: 'B_his', meter: 'MTR-1' }, { name: 'Aux Board', liveKey: 'only_B' }]
  check(JSON.stringify((await disk('iso-B')).apiSettings.finPowerBoards) === JSON.stringify(wantBoards), 'Power Boards: B\'s two boards saved to its project.json (the deleted one is not)')
  check((await disk('iso-A')).apiSettings.finPowerBoards === undefined, 'Power Boards: A got none of B\'s boards')
  await open(A, false); await openData()
  check((await boardRows()).length === 0, 'Power Boards: A shows no boards of B\'s'); await close()
  await open(B, false); await openData()
  check(JSON.stringify(await boardRows()) === JSON.stringify([['Main Board', 'total_power', 'B_his', 'MTR-1'], ['Aux Board', 'only_B', '', '']]),
    'Power Boards: B reopened from disk shows its boards')
  await fillBoard(1, ['Aux Board 2', 'only_B', '', ''])
  await page.click(saveBtn); await page.waitForSelector('.dashboard-settings-modal', { state: 'detached' })
  check((await disk('iso-B')).apiSettings.finPowerBoards[1].name === 'Aux Board 2', 'Power Boards: an edit is saved')
  B2.apiSettings = (await disk('iso-B')).apiSettings

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
  const siteCfg = await unzip(zips.backend, 'backend/config.json')
  check(JSON.stringify(siteCfg.live_point_ids) === '{}' && JSON.stringify(siteCfg.power_endpoints) === '{}' && !JSON.stringify(siteCfg).includes('3181ee6e'),
    'backend export for B (ellisdonDemo): config.json carries none of config.json\'s Marsa point maps')
  check(siteCfg.project_name === 'ellisdonDemo', 'backend export config.json names B\'s FIN project')
  const exportedText = JSON.stringify([exported, siteCfg])
  check(!/\bsecret\b/.test(exportedText) && !/\btester\b/.test(exportedText), 'exports contain neither the FIN password nor the username typed at sign-in')
  check(exported.backend.apiSettings.siteTimezone === 'Asia/Riyadh' && exported.fin.apiSettings.finDisplayName === 'Bee Site',
    'exports carry B\'s site settings (timezone, display name)')
  check(exported.fin.apiSettings.energyTariff === 0.42 && exported.backend.apiSettings.currency === 'SAR', 'exports carry B\'s reporting basis')
  check(JSON.stringify(exported.backend.apiSettings.finPowerBoards) === JSON.stringify(B2.apiSettings.finPowerBoards) &&
    JSON.stringify(exported.fin.apiSettings.finPowerBoards) === JSON.stringify(B2.apiSettings.finPowerBoards), 'exports carry B\'s power boards')
  check(!('apiKey' in exported.finApi.weather), 'FIN viewer api-config.json has no weather key (B set none)')
  // no shared weather key in any exported file: a hardcoded fallback has the shape `|| '<32 hex>'` (the key is never printed)
  const hardcodedKey = /\|\|\s*["'][0-9a-f]{32}["']/
  const zipTexts = async b64 => { const z = await JSZip.loadAsync(Buffer.from(b64, 'base64')); const out = []
    for (const f of Object.values(z.files)) if (!f.dir && /\.(js|json|html|py)$/.test(f.name)) out.push([f.name, await f.async('string')])
    return out }
  const withKey = [...await zipTexts(zips.backend), ...await zipTexts(zips.fin)].filter(([, t]) => hardcodedKey.test(t)).map(([n]) => n)
  check(withKey.length === 0, 'no exported file carries a hardcoded fallback key' + (withKey.length ? ': ' + withKey.join(', ') : ''))
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

  // ── switching project while a save is still being written: the save lands in A's folder only ──
  await open(A, true)                                                               // A as on disk at the start
  const diskB0 = JSON.stringify((await disk('iso-B')).apiSettings)
  await openData()
  await page.evaluate(() => {                                                       // A's folder answers slowly
    const s = window.__twin.stores.project, real = s.getState().folderHandle
    s.setState({ folderHandle: { kind: 'directory', name: real.name,
      getFileHandle: async (n, o) => { await new Promise(r => setTimeout(r, 1500)); return real.getFileHandle(n, o) },
      getDirectoryHandle: (n, o) => real.getDirectoryHandle(n, o) } })
  })
  await section('FIN Live Points Mapping').locator('input[aria-label="Value"]').first().fill('p:{project}:r:555')
  await page.click('text=Save Settings')
  await open(B, false)                                                              // switch before the write finishes
  await sleep(2500)
  const openNow = await page.evaluate(() => { const c = window.__twin.stores.project.getState().currentProject; return { id: c.projectId, live: c.apiSettings.finLivePoints } })
  check(openNow.id === 'iso-B' && JSON.stringify(openNow.live) === JSON.stringify(B2.apiSettings.finLivePoints),
    'save during a switch: the open project is still B, with B\'s own mappings ' + JSON.stringify(openNow))
  check((await disk('iso-A')).apiSettings.finLivePoints.total_power === 'p:{project}:r:555', 'save during a switch: written into A\'s project.json')
  check(JSON.stringify((await disk('iso-B')).apiSettings) === diskB0, 'save during a switch: B\'s project.json untouched')
  await backendServes(B2, 'save during a switch: backend')

  // ── Power Boards on config.json's own site: its boards name config.json's keys ──
  const M = { ...base, projectId: 'iso-M', name: 'Project M (Marsa)', isFinProject: true, apiSettings: { finProjectName: 'marsaAlArab' } }
  await open(M, true)
  await openData()
  await boardsSec().locator('button:has-text("+ Add board")').click()
  await fillBoard(0, ['MCC 1', 'total_power', '', ''])
  check(await saveExpectingError('"total_power" is not a key of this project\'s FIN Live Points Mapping'), 'Marsa: a key config.json does not serve is refused')
  await fillBoard(0, ['MCC 1', 'mcc1', 'Hourly_EC_MCC1_his', 'PMU09'])
  await page.click(saveBtn); await page.waitForSelector('.dashboard-settings-modal', { state: 'detached' })
  check(JSON.stringify((await disk('iso-M')).apiSettings.finPowerBoards) === JSON.stringify([{ name: 'MCC 1', liveKey: 'mcc1', historyKey: 'Hourly_EC_MCC1_his', meter: 'PMU09' }]),
    'Marsa: a board on config.json\'s keys is saved')
  check((await (await fetch(API + '/api/fin/mapping-schema')).json()).standardProjectId === 'iso-M', 'Marsa: the backend reports it verified this project on this server')

  // mapping-schema unreachable: standard-only keys are not accepted, said plainly; own keys still save
  await page.route('**/api/fin/mapping-schema', r => r.abort())
  await openData()
  await fillBoard(0, ['MCC 1 renamed', 'mcc1', 'Hourly_EC_MCC1_his', 'PMU09'])
  check(await saveExpectingError('could not be reached') && (await disk('iso-M')).apiSettings.finPowerBoards[0].name === 'MCC 1',
    'Marsa, backend unreachable: config.json\'s keys are refused with a clear message, nothing written')
  await close()
  await open(B, false); await openData()
  await fillBoard(1, ['Aux Board 3', 'only_B', '', ''])
  await page.click(saveBtn); await page.waitForSelector('.dashboard-settings-modal', { state: 'detached' })
  check((await disk('iso-B')).apiSettings.finPowerBoards[1].name === 'Aux Board 3', 'B, backend unreachable: boards on B\'s own keys still save')
  await page.unroute('**/api/fin/mapping-schema')

  // no FIN session (nothing verified on any server): a name match alone does not admit config.json's keys
  await open(M, false)
  await fetch(API + '/api/fin/logout', { method: 'POST' })
  await openData()
  await fillBoard(0, ['MCC 1 renamed', 'mcc1', '', ''])
  check(await saveExpectingError('accepted only once the backend has verified marsaAlArab') && (await disk('iso-M')).apiSettings.finPowerBoards[0].name === 'MCC 1',
    'Marsa, not verified: config.json\'s keys are refused until the backend verifies the server')
  await close()
} catch (e) {
  console.log('ERROR', e.stack || e.message)
  failures++
} finally {
  await cleanup(browser)
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PROJECT-ISOLATION CHECKS PASSED')
process.exit(failures ? 1 : 0)
