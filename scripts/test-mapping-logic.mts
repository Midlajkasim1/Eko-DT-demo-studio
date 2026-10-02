// Logic tests for Data Mapping (no browser). Run: node scripts/test-mapping-logic.mts
import assert from 'node:assert'
import { rowsFromObject, objectFromRows, parseImport, mergeEntries } from '../src/lib/mappingRows.ts'
import { SITE_FIN_EQUIPMENT_CLASSES, SITE_FIN_METER_PROFILE } from '../src/constants/finDefaults.ts'
import { mappingProblem, applyMappingValues, toBackendSettings, MAPPING_FIELDS } from '../src/lib/finSettings.ts'

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

console.log(`\n${passed} logic tests passed`)
