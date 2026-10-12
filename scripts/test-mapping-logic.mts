// Logic tests for Data Mapping (no browser). Run: node scripts/test-mapping-logic.mts
import assert from 'node:assert'
import { rowsFromObject, objectFromRows, parseImport, mergeEntries } from '../src/lib/mappingRows.ts'
import { SITE_FIN_EQUIPMENT_CLASSES, SITE_FIN_METER_PROFILE } from '../src/constants/finDefaults.ts'
import { mappingProblem, applyMappingValues, toBackendSettings, MAPPING_FIELDS } from '../src/lib/finSettings.ts'
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

console.log(`\n${passed} logic tests passed`)
