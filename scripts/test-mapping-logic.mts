// Logic tests for Data Mapping (no browser). Run: node scripts/test-mapping-logic.mts
import assert from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKEND_EXPORT_FILES } from '../src/lib/backendExport.ts'
import { rowsFromObject, objectFromRows, parseImport, mergeEntries } from '../src/lib/mappingRows.ts'
import { SITE_FIN_EQUIPMENT_CLASSES, SITE_FIN_METER_PROFILE } from '../src/constants/finDefaults.ts'
import {
  mappingProblem, applyMappingValues, toBackendSettings, MAPPING_FIELDS,
  FIN_SETTINGS_VERSION, DEFAULT_SITE_TIMEZONE, isTimeZone, dashboardProjectInfo, apiConfigFor, exportedSiteConfig, finExportMappings,
  rateOrNull, basisProblem, powerBoardsFromRows, powerBoardRows, boardKeyOptions, powerBoardsProblem,
} from '../src/lib/finSettings.ts'
import { projectIdFromSelection, projectLabel, savedProjectState } from '../src/lib/finProjects.ts'

const same = (a: unknown, b: unknown) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)))
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('ok  ' + name) }

test('untouched rows round-trip losslessly (strings, lists, empty lists, extra keys)', () => {
  same(objectFromRows(rowsFromObject({ a: 'p:{project}:r:1', b: ' spaced ' }, 'string'), 'string').value, { a: 'p:{project}:r:1', b: ' spaced ' })
  const eq = { ...SITE_FIN_EQUIPMENT_CLASSES, empty: [], odd: ['a, b', ' c '], _comment: 'note' }
  same(objectFromRows(rowsFromObject(eq, 'list'), 'list').value, eq)
  same(objectFromRows(rowsFromObject(SITE_FIN_METER_PROFILE.point_map, 'list'), 'list').value, SITE_FIN_METER_PROFILE.point_map)
  assert.strictEqual(objectFromRows([], 'string').value, undefined)
})

test('edit, delete and add change only the targeted entry', () => {
  const rows = rowsFromObject({ a: '1', b: '2', c: '3' }, 'string')
  rows[1] = { ...rows[1], text: '999' }
  same(objectFromRows(rows, 'string').value, { a: '1', b: '999', c: '3' })
  same(objectFromRows(rows.filter(r => r.key !== 'a'), 'string').value, { b: '999', c: '3' })
  same(objectFromRows([...rows, { id: 99, key: 'd', text: '4' }], 'string').value, { a: '1', b: '999', c: '3', d: '4' })
})

test('duplicate / empty keys are rejected', () => {
  const rows = rowsFromObject({ a: '1' }, 'string')
  assert(objectFromRows([...rows, { id: 5, key: 'a', text: 'x' }], 'string').error?.includes('Duplicate key "a"'))
  assert(objectFromRows([{ id: 1, key: ' ', text: 'v' }], 'string').error)
})

test('import: JSON, KEY=VALUE, lists, errors, merge', () => {
  same(parseImport('{"a":"1","b":"2"}', 'string').entries, { a: '1', b: '2' })
  same(parseImport('# note\nA=1\nB="2"', 'string').entries, { A: '1', B: '2' })
  same(parseImport('system_tags=ahu, fcu', 'list').entries, { system_tags: ['ahu', 'fcu'] })
  assert(parseImport('{ nope', 'string').error?.startsWith('Invalid JSON'))
  assert(parseImport('{"a":1}', 'string').error)
  assert(parseImport('text', 'string').error?.includes('Line 1'))
  assert(parseImport('A=1\nA=2', 'string').error?.includes('Duplicate'))
  const m = mergeEntries(rowsFromObject({ a: '1' }, 'string'), { a: 'NEW', z: '9' }, 'string')
  assert(m.added === 1 && m.updated === 1)
})

test('block shape validation', () => {
  assert(mappingProblem('finSeverityBands', { order: 'up' }))
  assert(mappingProblem('finSeverityBands', { order: 'desc', critical: 250, warning: 150 }) === null)
  assert(mappingProblem('finEquipmentClasses', { system_tags: 'ahu' }))
  assert(mappingProblem('finMeterProfile', { prefix: 'PMU', point_map: { a: ['kw'] } }) === null)
  assert(mappingProblem('finLivePoints', { a: 1 as unknown as string }))
})

test('project A and B settings stay independent through apply / allow-list', () => {
  const A = applyMappingValues({}, { finLivePoints: { total_power: 'p:{project}:r:A' }, finSeverityBands: { order: 'desc' } })
  const B = applyMappingValues({}, { finLivePoints: { total_power: 'p:{project}:r:B' } })
  assert.notDeepStrictEqual(A.finLivePoints, B.finLivePoints)
  assert(!('finSeverityBands' in B))
  const A2 = applyMappingValues(A, { finLivePoints: { total_power: 'p:{project}:r:A2' }, finSeverityBands: { order: 'desc' } })
  assert.strictEqual((A.finLivePoints as Record<string, string>).total_power, 'p:{project}:r:A')   // inputs never mutated
  assert.strictEqual((A2.finLivePoints as Record<string, string>).total_power, 'p:{project}:r:A2')
  assert.deepStrictEqual(toBackendSettings(undefined), {})
  const sent = toBackendSettings({ ...A, weatherApiKey: 'SECRET', navButtons: [] } as never)
  assert(!('weatherApiKey' in sent) && !('navButtons' in sent) && sent.finLivePoints)
  for (const f of MAPPING_FIELDS) assert(f.startsWith('fin'))
})

test('each project keeps its own FIN project name and mappings through a project.json save and reload', () => {
  // what handleSave writes and openRecentProject reads back is the JSON text of the project
  const reload = (s: object) => JSON.parse(JSON.stringify({ apiSettings: s })).apiSettings
  const A = applyMappingValues({ finProjectName: 'marsaAlArab' }, { finLivePoints: { ahu_temp: 'p:{project}:r:A' } })
  const B = applyMappingValues({ finProjectName: 'ellisdonDemo' }, { finLivePoints: { ahu_temp: 'p:{project}:r:B' } })
  for (const [s, name, id] of [[A, 'marsaAlArab', 'A'], [B, 'ellisdonDemo', 'B']] as const) {
    const back = reload(s)
    assert.strictEqual(back.finProjectName, name)
    assert.deepStrictEqual(back.finLivePoints, { ahu_temp: `p:{project}:r:${id}` })
    assert.deepStrictEqual(toBackendSettings(back), toBackendSettings(s))        // what the backend is sent
  }
  // a project that saved nothing has no project name and no mapping, and gets none from A or B
  assert.deepStrictEqual(toBackendSettings(reload(applyMappingValues({}, {}))), {})
})

test('FIN project dropdown: shows the name, stores the identifier, never swaps a saved project', () => {
  const projects = [
    { id: 'adnocWarsan', name: 'ADNOC WARSAN' }, { id: 'ellisdonDemo', name: 'ELLISDON DEMO' },
    { id: 'khaznaDataCenter', name: 'KHAZNA DATA CENTER' }, { id: 'marsaAlArab', name: 'MARSA AL ARAB' },
  ]
  assert.strictEqual(projectIdFromSelection(projects, 'marsaAlArab'), 'marsaAlArab')
  assert.strictEqual(projectIdFromSelection(projects, 'ellisdonDemo'), 'ellisdonDemo')
  assert.strictEqual(projectIdFromSelection(projects, 'MARSA AL ARAB'), '')      // a display name is never an id
  assert.strictEqual(projectLabel(projects[3]), 'MARSA AL ARAB (marsaAlArab)')
  assert.strictEqual(projectLabel({ id: 'x', name: 'x' }), 'x')
  assert.strictEqual(savedProjectState(projects, undefined), 'none')             // unconfigured stays unconfigured
  assert.strictEqual(savedProjectState(projects, 'marsaAlArab'), 'available')
  assert.strictEqual(savedProjectState(projects, 'retiredProject'), 'missing')   // kept and reported, not replaced
  assert.strictEqual(savedProjectState([], 'marsaAlArab'), 'missing')

  // A -> B -> A through the settings the picker feeds: each keeps its own project and mapping
  const reload = (s: object) => JSON.parse(JSON.stringify({ apiSettings: s })).apiSettings
  const pick = (base: object, id: string, ref: string) =>
    applyMappingValues({ ...base, finProjectName: projectIdFromSelection(projects, id) }, { finLivePoints: { total_power: ref } })
  const A = pick({}, 'marsaAlArab', 'p:{project}:r:A')
  const B = pick({}, 'ellisdonDemo', 'p:{project}:r:B')
  for (const s of [A, B, A]) {
    const back = toBackendSettings(reload(s))
    assert.strictEqual(back.finProjectName, s === A ? 'marsaAlArab' : 'ellisdonDemo')
    assert.deepStrictEqual(back.finLivePoints, { total_power: s === A ? 'p:{project}:r:A' : 'p:{project}:r:B' })
  }
  // a project nobody configured is not given a project by the dropdown
  assert.strictEqual(toBackendSettings(reload(applyMappingValues({}, {}))).finProjectName, undefined)
})

test('offered dashboard keys without a value are not part of the mapping', () => {
  const offered = ['k1', 'k2', 'k3'].map((key, i) => ({ id: 100 + i, key, text: '', suggested: true }))
  assert.strictEqual(objectFromRows(offered, 'string').value, undefined)
  assert.strictEqual(objectFromRows(offered, 'string').error, undefined)
  // the user's choice for one key is saved; the blank keys are not, and nothing is guessed for them
  const chosen = offered.map(r => (r.key === 'k2' ? { ...r, text: 'p:{project}:r:chosen' } : r))
  same(objectFromRows(chosen, 'string').value, { k2: 'p:{project}:r:chosen' })
  // a saved mapping is unaffected, and a blank row the user added themselves is still a (blank) entry
  same(objectFromRows([...rowsFromObject({ a: '1' }, 'string'), { id: 7, key: 'b', text: '' }], 'string').value, { a: '1', b: '' })
})

// config.json as the repo ships it, reduced to what the export reads
const SITE_CFG = {
  project_name: 'marsaAlArab', fin_server_url: 'https://localhost', polling: { live_ms: 5000, realtime_ms: 30000 },
  live_point_ids: { total_power: 'p:{project}:r:3181ee6e-site' }, power_endpoints: { X_his: 'site' },
  equipment_classes: { system_tags: ['ahu'] }, meter_profile: { prefix: 'PMU' }, severity_bands: { order: 'desc' },
  realtime_endpoints: { points: 'q' }, workorder_expr: 'sqlQuery(read(sqlConn), "SELECT * FROM workOrderMarsa")',
}

test('export: another FIN project ships none of config.json\'s site point maps; the site keeps them', () => {
  const other = exportedSiteConfig(SITE_CFG, { finProjectName: 'khaznaDataCenter', finBaseUrl: 'https://10.10.90.21', finInterval: 7000 })
  for (const k of ['live_point_ids', 'power_endpoints', 'equipment_classes', 'meter_profile', 'severity_bands']) same(other[k], {})
  assert(!JSON.stringify(other).includes('3181ee6e'), 'no site point ID in an unrelated project\'s export')
  assert.strictEqual(other.project_name, 'khaznaDataCenter')
  assert.strictEqual(other.fin_server_url, 'https://10.10.90.21')                    // a new server address needs no code change
  same(other.polling, { live_ms: 7000, realtime_ms: 30000 })
  same(other.realtime_endpoints, SITE_CFG.realtime_endpoints)                         // the query template is not a site mapping
  assert.strictEqual(other.workorder_expr, '')                                        // nor does it run the site's work-order table
  const site = exportedSiteConfig(SITE_CFG, { finProjectName: 'marsaAlArab' })
  same(site.live_point_ids, SITE_CFG.live_point_ids)                                  // existing Marsa export unchanged
  assert.strictEqual(site.workorder_expr, SITE_CFG.workorder_expr)
  same(exportedSiteConfig(SITE_CFG, undefined), SITE_CFG)                             // nothing set: config.json as is
  same(SITE_CFG.live_point_ids, { total_power: 'p:{project}:r:3181ee6e-site' })      // input never mutated
})

test('FIN viewer export: config.json\'s maps only for its own named site; other and unnamed projects ship their own', () => {
  const own = { finLivePoints: { total_power: 'p:{project}:r:own' }, finEndpoints: { own_his: 'x' }, finMeterProfile: { prefix: 'MTR' }, finWorkorderExpr: 'mine' }
  const site = finExportMappings(SITE_CFG, { finProjectName: 'marsaAlArab', ...own })
  same(site.finLivePoints, SITE_CFG.live_point_ids)                                   // the audited maps win for the site
  same(site.finMeterProfile, SITE_CFG.meter_profile)
  assert.strictEqual(site.finWorkorderExpr, SITE_CFG.workorder_expr)
  for (const settings of [{ finProjectName: 'khaznaDataCenter', ...own }, own]) {     // another FIN project, and a blank name
    const m = finExportMappings(SITE_CFG, settings)
    same(m.finLivePoints, own.finLivePoints)
    same(m.finEndpoints, own.finEndpoints)
    same(m.finMeterProfile, own.finMeterProfile)
    assert.strictEqual(m.finSeverityBands, undefined)                                 // a block it did not set stays unset
    assert.strictEqual(m.finWorkorderExpr, 'mine')
    assert(!JSON.stringify(m).includes('3181ee6e') && !JSON.stringify(m).includes('workOrderMarsa'), 'no site value')
  }
  const bare = finExportMappings(SITE_CFG, {})
  same(bare.finLivePoints, {})
  assert.strictEqual(bare.finWorkorderExpr, '')
  same(finExportMappings({ project_name: 'marsaAlArab' }, { finProjectName: 'marsaAlArab', ...own }).finLivePoints, own.finLivePoints)   // site with no audited map: its own
})

test('exported project files carry the settings and never a credential', () => {
  // the FIN password is typed at sign-in and kept only in the login form: apiSettings has no field for it
  const s = applyMappingValues({
    schemaVersion: FIN_SETTINGS_VERSION, finProjectName: 'khaznaDataCenter', finBaseUrl: 'https://fin.client.example:8443',
    finDisplayName: 'Khazna DC', siteTimezone: 'Asia/Dubai',
  }, { finLivePoints: { total_power: 'p:{project}:r:1' }, finSeverityBands: { order: 'asc', critical: 3 } })
  const files = JSON.stringify([{ apiSettings: s }, apiConfigFor(s, 'Khazna'), exportedSiteConfig(SITE_CFG, s)])
  assert(!/password|token|cookie|authorization|secret/i.test(files), files)
  const api = apiConfigFor(s, 'Khazna')
  assert.strictEqual(api.project_name, 'khaznaDataCenter')
  same(api.live_point_ids, { total_power: 'p:{project}:r:1' })
  same(api.severity_bands, { order: 'asc', critical: 3 })
  assert.strictEqual(apiConfigFor({}, 'Unnamed').project_name, 'Unnamed')
  // export → reopen: the JSON text round-trips every setting
  same(JSON.parse(JSON.stringify({ apiSettings: s })).apiSettings, s)
})

test('saved settings: schema version, older projects, and what reaches the backend', () => {
  // a project saved before schemaVersion existed opens as is: its settings and mappings are untouched
  const old = { finProjectName: 'marsaAlArab', finLivePoints: { a: 'p:{project}:r:1' }, navButtons: [] } as never
  same(toBackendSettings(old), { finProjectName: 'marsaAlArab', finLivePoints: { a: 'p:{project}:r:1' } })
  // the version and timezone are browser-side: the backend allow-list never sends them
  const sent = toBackendSettings({ ...(old as object), schemaVersion: 1, siteTimezone: 'Asia/Riyadh' } as never)
  assert(!('schemaVersion' in sent) && !('siteTimezone' in sent))
  // Save keeps the version through the mapping step
  assert.strictEqual(applyMappingValues({ schemaVersion: FIN_SETTINGS_VERSION }, {}).schemaVersion, 1)
})

test('dashboard project info: the open project\'s identity and timezone, never another site\'s', () => {
  const k = dashboardProjectInfo({ projectId: 'p-k', name: 'Khazna', apiSettings: {
    finProjectName: 'khaznaDataCenter', finDisplayName: 'Khazna DC', siteTimezone: 'Asia/Riyadh',
    energyTariff: 0.18, currency: 'SAR', tariffName: 'SEC-C', co2Factor: 0.55, co2FactorName: 'KSA grid' } })
  same(k, { projectId: 'p-k', demo: false, powerBoards: null,
    site: { name: 'Khazna', displayName: 'Khazna DC', finProject: 'khaznaDataCenter', timezone: 'Asia/Riyadh' },
    basis: { currency: 'SAR', energyTariff: 0.18, tariffName: 'SEC-C', gasTariff: null, co2Factor: 0.55, co2FactorName: 'KSA grid' } })
  const blank = dashboardProjectInfo({ projectId: 'p-new', name: 'New' })
  same(blank.site, { name: 'New', displayName: '', finProject: '', timezone: DEFAULT_SITE_TIMEZONE })
  // a project that set no rate has none: never DEWA's 0.30 AED/kWh or 0.41 kg/kWh
  same(blank.basis, { currency: 'AED', energyTariff: null, tariffName: '', gasTariff: null, co2Factor: null, co2FactorName: '' })
  assert.strictEqual(blank.demo, false, 'real mode unless the project turns demo figures on')
  assert.strictEqual(dashboardProjectInfo({ projectId: 'd', name: 'd', apiSettings: { dashboardDemo: true } }).demo, true)
  assert.strictEqual(dashboardProjectInfo({ projectId: 'x', name: 'x', apiSettings: { siteTimezone: 'Mars/Olympus' } }).site.timezone, DEFAULT_SITE_TIMEZONE)
  assert(isTimeZone('Asia/Dubai') && !isTimeZone('Mars/Olympus'))
})

test('reporting basis: only usable rates are kept, and bad input is not saved', () => {
  assert.strictEqual(rateOrNull(0.3), 0.3)
  for (const bad of [0, -1, NaN, Infinity, '0.3', null, undefined]) assert.strictEqual(rateOrNull(bad), null, String(bad))
  assert.strictEqual(basisProblem({}), null)                                            // nothing set: nothing to fix
  assert.strictEqual(basisProblem({ energyTariff: 0.3, gasTariff: 2.1, co2Factor: 0.41, currency: 'AED' }), null)
  assert(basisProblem({ energyTariff: 0 })?.includes('Electricity tariff'))
  assert(basisProblem({ co2Factor: NaN })?.includes('CO₂ factor'))
  assert(basisProblem({ currency: 'dirham' })?.includes('three-letter'))
  // the rates are browser-side report settings: the backend allow-list never sends them
  const sent = toBackendSettings({ finProjectName: 'x', energyTariff: 0.3, co2Factor: 0.4, currency: 'AED', dashboardDemo: true })
  same(sent, { finProjectName: 'x' })
})

test('weather: no shared API key is written into a project; the project\'s own key is kept', () => {
  const none = apiConfigFor({ finProjectName: 'p' }, 'P')
  assert(!('apiKey' in none.weather), 'no fallback key')
  assert.strictEqual(apiConfigFor({ weatherApiKey: 'user-key' }, 'P').weather.apiKey, 'user-key')
})

test('power boards: what the editor saves, and the round trip through project.json', () => {
  const rows = [
    { name: ' Chiller Plant ', liveKey: ' chiller_kw ', historyKey: 'Chiller_EC_his', meter: ' MTR-3 ' },
    { name: '', liveKey: '', historyKey: '', meter: '' },                                  // a blank row is not saved
    { name: 'Lighting', liveKey: 'light_kw', historyKey: '  ', meter: '' },                // optional fields left out
  ]
  const boards = powerBoardsFromRows(rows)
  same(boards, [{ name: 'Chiller Plant', liveKey: 'chiller_kw', historyKey: 'Chiller_EC_his', meter: 'MTR-3' }, { name: 'Lighting', liveKey: 'light_kw' }])
  assert.strictEqual(powerBoardsFromRows([{ name: '', liveKey: '', historyKey: '', meter: '' }]), undefined, 'no board: absent, the built-in boards apply')
  same(powerBoardsFromRows(powerBoardRows(boards)), boards)                                  // restore → save unchanged
  same(JSON.parse(JSON.stringify({ apiSettings: { finPowerBoards: boards } })).apiSettings.finPowerBoards, boards)   // export / reopen
  // browser-side: never sent to the backend
  assert(!('finPowerBoards' in toBackendSettings({ finProjectName: 'k', finPowerBoards: boards })))
  // the dashboard gets the project's boards, or null (built-in boards) when it has none
  same(dashboardProjectInfo({ projectId: 'k', name: 'K', apiSettings: { finPowerBoards: boards } }).powerBoards, boards)
  assert.strictEqual(dashboardProjectInfo({ projectId: 'k', name: 'K', apiSettings: { finPowerBoards: [] } }).powerBoards, null)
  assert.strictEqual(dashboardProjectInfo({ projectId: 'old', name: 'Old', apiSettings: { finProjectName: 'x' } }).powerBoards, null, 'older project: no boards field')
})

test('power boards: config.json\'s keys only for the project the backend verified on its server', () => {
  const keys = { finLivePoints: ['mcc1', 'mcc2'], finEndpoints: ['Hourly_EC_MCC1_his'], standardProfile: 'marsaAlArab' }
  const verified = { ...keys, standardProject: 'marsaAlArab', standardProjectId: 'proj-M' }
  const own = { live: { chiller_kw: 'p:{project}:r:1' }, history: { Chiller_EC_his: '/api/...' } }
  const OWN = { live: ['chiller_kw'], history: ['Chiller_EC_his'] }
  // verified Marsa server, this Eko-DT project, this FIN project: config.json's keys
  same(boardKeyOptions('proj-M', 'marsaAlArab', own, verified), { live: ['mcc1', 'mcc2'], history: ['Hourly_EC_MCC1_his'], standard: true, unverifiedStandard: false })
  // the same name on another tenant (the backend verified nothing): its own keys only, flagged
  same(boardKeyOptions('proj-M', 'marsaAlArab', own, keys), { ...OWN, standard: false, unverifiedStandard: true })
  // verified for another Eko-DT project, or the form now names another FIN project: not this one's
  same(boardKeyOptions('proj-M2', 'marsaAlArab', own, verified), { ...OWN, standard: false, unverifiedStandard: true })
  same(boardKeyOptions('proj-M', 'khaznaDataCenter', own, verified), { ...OWN, standard: false, unverifiedStandard: false })
  // mapping-schema unavailable: its own keys only, never config.json's
  same(boardKeyOptions('proj-M', 'marsaAlArab', own, {}), { ...OWN, standard: false, unverifiedStandard: false })
  // other projects keep their custom keys
  same(boardKeyOptions('proj-K', 'khaznaDataCenter', {}, verified), { live: [], history: [], standard: false, unverifiedStandard: false })
  const marsaBoard = [{ name: 'MCC 1', liveKey: 'mcc1' }]
  assert.strictEqual(powerBoardsProblem(marsaBoard, boardKeyOptions('proj-M', 'marsaAlArab', own, verified)), null)
  assert(powerBoardsProblem(marsaBoard, boardKeyOptions('proj-M', 'marsaAlArab', own, keys))?.includes('"mcc1" is not a key'), 'unverified: standard-only key refused')
  assert(powerBoardsProblem(marsaBoard, boardKeyOptions('proj-M', 'marsaAlArab', own, {}))?.includes('"mcc1" is not a key'), 'backend down: standard-only key refused')
})

test('power boards: names unique and present, keys mapped, history optional, meter matches the profile', () => {
  const keys = { live: ['chiller_kw', 'light_kw'], history: ['Chiller_EC_his'] }
  const ok = [{ name: 'Chiller Plant', liveKey: 'chiller_kw', historyKey: 'Chiller_EC_his', meter: 'MTR-3' }, { name: 'Lighting', liveKey: 'light_kw' }]
  assert.strictEqual(powerBoardsProblem(ok, keys, 'MTR'), null)
  assert.strictEqual(powerBoardsProblem(undefined, keys), null)
  assert(powerBoardsProblem([{ name: '', liveKey: 'light_kw' }], keys)?.includes('a name is required'))
  assert(powerBoardsProblem([...ok, { name: ' lighting'.trim().toUpperCase(), liveKey: 'light_kw' }], keys)?.includes('another board already has this name'))
  assert(powerBoardsProblem([{ name: 'X', liveKey: '' }], keys)?.includes('choose its live key'))
  assert(powerBoardsProblem([{ name: 'X', liveKey: 'mcc1' }], keys)?.includes('"mcc1" is not a key of this project\'s FIN Live Points Mapping'), 'another site\'s key is refused')
  assert(powerBoardsProblem([{ name: 'X', liveKey: 'light_kw', historyKey: 'Hourly_EC_MCC1_his' }], keys)?.includes('Historical Endpoints'))
  assert(powerBoardsProblem([{ name: 'X', liveKey: 'light_kw', meter: 'PMU09' }], keys, 'MTR')?.includes('does not match this project\'s meter prefix'))
  assert.strictEqual(powerBoardsProblem([{ name: 'X', liveKey: 'light_kw', meter: 'PMU09' }], keys), null, 'no prefix known: any meter label')
  assert(powerBoardsProblem([{ name: 'P2', liveKey: 'light_kw' }, { name: 'X', liveKey: 'nope' }], keys)?.startsWith('Power board 2 (X)'), 'says which board')
})

test('backend export: every local module main.py imports ships beside it', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend')
  for (const name of BACKEND_EXPORT_FILES) assert(existsSync(path.join(dir, name)), `${name} is listed but missing from backend/`)
  // walk local imports from the entry points: a module the export leaves out fails at startup
  const seen = new Set<string>(), todo = ['main', 'start_viewer']
  while (todo.length) {
    const mod = todo.pop()!
    if (seen.has(mod)) continue
    seen.add(mod)
    const src = readFileSync(path.join(dir, mod + '.py'), 'utf-8')
    for (const m of src.matchAll(/^\s*(?:from\s+(\w+)\s+import|import\s+(\w+))/gm)) {
      const dep = m[1] || m[2]
      if (existsSync(path.join(dir, dep + '.py'))) todo.push(dep)
    }
  }
  assert(seen.has('workorders'), 'main.py imports workorders')
  for (const mod of seen) assert(BACKEND_EXPORT_FILES.includes(mod + '.py'), `${mod}.py is imported but not exported`)
})

console.log(`\n${passed} logic tests passed`)
