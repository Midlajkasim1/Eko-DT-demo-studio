import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// The asset panel's Analytics data (static/js/data-map.js) for equipment named like the Eko Hospital units, per project.
// The dashboard hands data-map.js the open project's settings (window.INJECTED_PROJECT_CONFIG, set by DashboardOverlay from
// apiSettings.hospitalHvacGraphics). Only a project that set it classifies HOSPITAL_AHU_01 by the AHU in its name;
// Marsa, other projects and the standalone prototype classify as they always did, which is compared with the baseline script.
// The point lists are TEST INPUTS written from the Hospital screenshots; they are not readings from its FIN project.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = 'c81ed55'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }
let baselineScript = null
try { baselineScript = execFileSync('git', ['show', `${BASELINE}:static/js/data-map.js`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { /* not in this checkout */ }
const skipBaseline = baselineScript ? false : `baseline ${BASELINE} is not in this checkout`

let server, browser, base

before(async () => {
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (p === '/baseline/data-map.js' && baselineScript) { res.writeHead(200, { 'content-type': 'text/javascript' }).end(baselineScript); return }
    const file = p === '/' ? path.join(root, 'templates/index.html') : path.join(root, p)
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await browser?.close()
  await new Promise(r => server?.close(r))
})

const point = (navName, currentValue, unit = '') => ({ navName, currentValue, text: currentValue, unit, reporting: true })
const AHU = [
  point('ALARM_STATUS', 'Normal'), point('RA_FAN_CMD', 'Start'), point('SA_FAN_CMD', 'Start'),
  point('RA_CO2', '586.64', 'ppm'), point('RA_CO2_SP', '800', 'ppm'), point('SA_TEMP', '16', '°C'), point('SA_TEMP_SP', '16', '°C'),
  point('RA_TEMP', '23.4', '°C'), point('OA_TEMP', '44.2', '°C'), point('SA_PRESSURE', '259.93', 'Pa'), point('SA_PRESSURE_SP', '250', 'Pa'),
  point('SA_FAN_STATUS', 'On'), point('PREFILTER', 'Clean'), point('BAGFILTER', 'Clean'),
]
const FCU = [
  point('ALARMSTATUS', 'Null'), point('OCCUPANCY', 'Occupied'), point('COOLINGDEMAND', '52.63', '%'), point('ZONETEMPSP', '20.5', '°C'),
  point('ZONETEMP', '21.2', '°C'), point('ZONEHUMIDITY', '53.5', '%RH'), point('FILTER', 'Clean'), point('FANSPEED', 'Medium'), point('FANRUNSTATUS', 'On'),
]

// What the dashboard injects for each project (DashboardOverlay -> dashboardProjectInfo): only Eko Hospital set the flag
const site = (name, finProject) => ({ name, displayName: '', finProject, timezone: 'Asia/Dubai' })
const CONFIGS = {
  eko: { projectId: 'p-eko', demo: false, hospitalHvac: true, site: site('Eko Hospital', 'ekoHospital'), basis: {} },
  marsa: { projectId: 'p-marsa', demo: true, hospitalHvac: false, site: site('Marsa Al Arab', 'marsaAlArab'), basis: {} },
  other: { projectId: 'p-other', demo: false, hospitalHvac: false, site: site('ANC09 Tower', 'anc09'), basis: {} },
  missing: { projectId: 'p-old', demo: false, site: site('Saved before the setting existed', 'old'), basis: {} },
  standalone: null,
}

let loads = 0
/** A fresh dashboard page with the project's settings injected, then data-map.js (the current one, or the baseline copy) */
async function openFor(config, script = '/static/js/data-map.js') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(base + '/')
  await page.waitForFunction(() => window.EKO && window.EKO.data)
  await loadScript(page, config, script)
  return page
}
/** What DashboardOverlay does on each project open: inject the settings, then run the script again over the same window */
async function loadScript(page, config, script = '/static/js/data-map.js') {
  await page.evaluate(cfg => { window.DASHBOARD_OVERLAY = true; if (cfg) window.INJECTED_PROJECT_CONFIG = cfg; else delete window.INJECTED_PROJECT_CONFIG }, config)
  await page.addScriptTag({ url: `${base}${script}?load=${++loads}` })
}

/** Feed the equipment the way the live data layer does, and read the asset the panel is built from */
async function assetFor(page, name, points, type) {
  return page.evaluate(([name, points, type]) => {
    window.dispatchEvent(new CustomEvent('dashboard-data', { detail: { type: 'equipment', data: { equipment: [{ name, type, floor: 'Ground floor', tags: [], points }] } } }))
    const a = (window.EKO.data.assets || []).find(x => x.id === name)
    return a && { id: a.id, pairs: (a.compare?.pairs || []).map(p => [p.key, p.actName, p.spName, p.actual, p.sp]), analog: (a.analog || []).map(r => r[0]) }
  }, [name, points, type])
}
const keys = a => a.pairs.map(p => p[0])

const GENERIC_AHU = { name: 'HOSPITAL_AHU_01', points: AHU, type: '' }
const SAMPLE = [
  { name: 'AHU-L3-01', points: AHU, type: 'AHU' },
  { name: 'FCU-GF-01', points: FCU, type: 'FCU' },
  { name: 'FAHU-02', points: AHU, type: 'FAHU' },
  { name: 'HOSPITAL_AHU_01', points: AHU, type: '' },
  { name: 'HOSPITAL_FCU_03', points: FCU, type: '' },
  { name: 'L1 FCU 03', points: FCU, type: 'OTHER' },
  { name: 'ANC09 AHU 02', points: AHU, type: '' },
  { name: 'VAV-01', points: FCU, type: 'VAV' },
  { name: 'HOSPITAL_LOBBY', points: FCU, type: '' },
]
const analyse = async (page, eqs = SAMPLE) => {
  const out = {}
  for (const e of eqs) out[e.name] = await assetFor(page, e.name, e.points, e.type)
  return out
}

test('Eko Hospital (feature on): HOSPITAL_AHU_01 and HOSPITAL_FCU_03 pair each reading with its own setpoint', async () => {
  const page = await openFor(CONFIGS.eko)
  const ahu = await assetFor(page, 'HOSPITAL_AHU_01', AHU, '')
  assert.ok(ahu, 'the asset is built')
  const byKey = Object.fromEntries(ahu.pairs.map(p => [p[0], p]))
  assert.deepEqual(byKey.apCmpSA.slice(1), ['SA_TEMP', 'SA_TEMP_SP', 16, 16])
  assert.deepEqual(byKey.apCmpRACO2.slice(1, 3), ['RA_CO2', 'RA_CO2_SP'])
  assert.ok(!('apCmpTemp' in byKey), 'not the generic first-temperature pair, which would set OA_TEMP against a setpoint')
  const fcu = await assetFor(page, 'HOSPITAL_FCU_03', FCU, '')
  assert.deepEqual(fcu.pairs.find(p => p[0] === 'apCmpZone').slice(1), ['ZONETEMP', 'ZONETEMPSP', 21.2, 20.5])
  await page.close()
})

test('Marsa, another project, a project saved before the setting, and the standalone prototype: no name typing, as before', async () => {
  for (const name of ['marsa', 'other', 'missing', 'standalone']) {
    const page = await openFor(CONFIGS[name])
    const a = await assetFor(page, 'HOSPITAL_AHU_01', AHU, '')
    assert.deepEqual(keys(a), ['apCmpTemp'], `${name}: the generic pair, not the AHU charts`)
    const f = await assetFor(page, 'HOSPITAL_FCU_03', FCU, '')
    assert.ok(!keys(f).includes('apCmpZone'), `${name}: no FCU zone pair`)
    await page.close()
  }
})

test('the prefix and FIN type still decide, with the feature on or off', async () => {
  for (const name of ['eko', 'marsa', 'other', 'missing', 'standalone']) {
    const page = await openFor(CONFIGS[name])
    assert.ok(keys(await assetFor(page, 'AHU-L3-01', AHU, 'AHU')).includes('apCmpSA'), `${name}: AHU`)
    assert.ok(keys(await assetFor(page, 'FCU-GF-01', FCU, 'FCU')).includes('apCmpZone'), `${name}: FCU`)
    await page.close()
  }
})

test('Marsa analytics are the baseline\'s, for Marsa names and for names that could be mistaken for the Hospital\'s', { skip: skipBaseline }, async () => {
  const was = await openFor(CONFIGS.marsa, '/baseline/data-map.js')
  const baseline = await analyse(was)
  await was.close()
  const now = await openFor(CONFIGS.marsa)
  const current = await analyse(now)
  await now.close()
  assert.deepEqual(current, baseline)
  assert.ok(Object.values(baseline).every(Boolean), 'every sample built an asset, so the comparison compares something')
})

test('every project without the feature gets the baseline analytics too', { skip: skipBaseline }, async () => {
  const was = await openFor(CONFIGS.other, '/baseline/data-map.js')
  const baseline = await analyse(was)
  await was.close()
  for (const name of ['other', 'missing', 'standalone']) {
    const now = await openFor(CONFIGS[name])
    assert.deepEqual(await analyse(now), baseline, name)
    await now.close()
  }
})

test('the baseline comparison can fail: the Hospital project differs from the baseline on the Hospital names', { skip: skipBaseline }, async () => {
  const was = await openFor(CONFIGS.marsa, '/baseline/data-map.js')
  const baseline = await analyse(was)
  await was.close()
  const now = await openFor(CONFIGS.eko)
  const current = await analyse(now)
  await now.close()
  assert.notDeepEqual(current['HOSPITAL_AHU_01'], baseline['HOSPITAL_AHU_01'])
  assert.deepEqual(current['AHU-L3-01'], baseline['AHU-L3-01'], 'and not on a name that already worked')
})

test('switching projects in one window: Eko Hospital -> Marsa -> Eko Hospital, nothing carried over', async () => {
  const page = await openFor(CONFIGS.eko)
  assert.ok(keys(await assetFor(page, GENERIC_AHU.name, AHU, '')).includes('apCmpSA'), 'Eko Hospital: AHU charts')

  await loadScript(page, CONFIGS.marsa)
  assert.deepEqual(keys(await assetFor(page, GENERIC_AHU.name, AHU, '')), ['apCmpTemp'], 'Marsa: the Hospital\'s typing is gone')
  assert.ok(keys(await assetFor(page, 'AHU-L3-01', AHU, 'AHU')).includes('apCmpSA'), 'Marsa: its own names still pair')

  await loadScript(page, CONFIGS.eko)
  assert.ok(keys(await assetFor(page, GENERIC_AHU.name, AHU, '')).includes('apCmpSA'), 'back in Eko Hospital: AHU charts again')

  await loadScript(page, CONFIGS.other)
  assert.deepEqual(keys(await assetFor(page, GENERIC_AHU.name, AHU, '')), ['apCmpTemp'], 'another project: off')
  await page.close()
})

test('no points at all does not break the panel data, with the feature on or off', async () => {
  for (const name of ['eko', 'marsa']) {
    const page = await openFor(CONFIGS[name])
    const a = await assetFor(page, 'HOSPITAL_AHU_02', [], '')
    assert.ok(a, name)
    assert.deepEqual(a.pairs, [], name)
    await page.close()
  }
})

test('every reporting Hospital point is listed on the panel, so the overview values need no extra mapping', async () => {
  const page = await openFor(CONFIGS.eko)
  const ahu = await assetFor(page, 'HOSPITAL_AHU_01', AHU, '')
  for (const n of ['ALARM_STATUS', 'RA_FAN_CMD', 'SA_FAN_CMD', 'RA_CO2_SP', 'SA_TEMP_SP', 'SA_PRESSURE_SP']) assert.ok(ahu.analog.includes(n), n)
  const fcu = await assetFor(page, 'HOSPITAL_FCU_03', FCU, '')
  for (const n of ['OCCUPANCY', 'COOLINGDEMAND', 'ZONETEMPSP', 'ALARMSTATUS']) assert.ok(fcu.analog.includes(n), n)
  await page.close()
})
