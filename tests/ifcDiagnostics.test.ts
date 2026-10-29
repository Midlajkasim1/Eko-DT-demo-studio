import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runIfcDiagnostics } from '../src/lib/ifcDiagnostics.ts'
import { classifyLoaded } from '../src/lib/layerGroups.ts'

const READ_ONLY = new Set(['getCategories', 'getItemsOfCategories', 'getItemsIdsWithGeometry', 'getItemsData'])

// A fragments-model stand-in that records every call, and fails the test if anything but a read is attempted
const fake = () => {
  const calls: string[] = []
  const data: Record<string, number[]> = { IFCSPACE: [1, 2, 3], IFCFURNISHINGELEMENT: [10, 11], IFCBUILDINGSTOREY: [90], IFCFURNISHINGELEMENTTYPE: [200] }
  const rows: Record<number, Record<string, unknown>> = {
    1: { Name: { value: 'Room 1' }, LongName: { value: 'Ward' } }, 2: { Name: { value: 'Room 2' } }, 3: { Name: { value: 'Room 1' } },
    10: { Name: { value: 'Chair' }, ObjectType: { value: 'Chair:Std' }, PredefinedType: { value: 'CHAIR' } }, 11: { Name: { value: 'Chair' } },
    90: { Name: { value: 'Level 1' }, Elevation: { value: 0 } },
  }
  const impl: Record<string, (...a: any[]) => Promise<unknown>> = {
    getItemsIdsWithGeometry: async () => [1, 2, 3, 10, 11],
    getCategories: async () => Object.keys(data),
    getItemsOfCategories: async ([re]: RegExp[]) => Object.fromEntries(Object.entries(data).filter(([k]) => re.test(k))),
    getItemsData: async (ids: number[]) => ids.map(id => rows[id] ?? {}),
  }
  const model = new Proxy({}, {
    get: (_, name: string) => (...a: any[]) => {
      calls.push(name)
      assert.ok(READ_ONLY.has(name), `non-read call: ${name}`)
      return impl[name](...a)
    },
  })
  return { model, calls }
}

const models = [
  { modelId: 'm1', originalFileName: '3D - SPACES.ifc' },
  { modelId: 'm2', originalFileName: '1913-blc-pal-equipment_r21.ifc' },
  { modelId: 'm3', originalFileName: 'Structures.ifc' },
  { modelId: 'm4', originalFileName: 'Glb thing.glb', type: 'glb' },
]

test('by default it reports the models no rule could place, and reads only', async () => {
  const f = fake()
  const list = new Map<string, unknown>([['m1', f.model], ['m2', f.model], ['m3', f.model]])
  const out = await runIfcDiagnostics({ models, fragments: list, loadedInEngine: { m1: true, m2: true, m3: true }, classify: classifyLoaded })
  assert.deepEqual(out.map(o => o.fileName), ['3D - SPACES.ifc', '1913-blc-pal-equipment_r21.ifc', 'Glb thing.glb'])
  const spaces = out[0]
  assert.deepEqual(spaces.classification, { group: 'other', known: false, basis: 'nothing' })
  assert.equal(spaces.totals.itemsWithGeometry, 5)
  assert.deepEqual(spaces.classes.find(c => c.class === 'IFCSPACE'), { class: 'IFCSPACE', all: 3, withGeometry: 3 })
  assert.deepEqual(spaces.classes.find(c => c.class === 'IFCFURNISHINGELEMENTTYPE'), { class: 'IFCFURNISHINGELEMENTTYPE', all: 1, withGeometry: 0 })
  assert.deepEqual(spaces.spatial.storeys, [{ name: 'Level 1', longName: undefined, elevation: '0' }])
  assert.deepEqual(spaces.samples.IFCSPACE.commonNames, [['Room 1', 2], ['Room 2', 1]])
  assert.deepEqual(spaces.samples.IFCFURNISHINGELEMENT.predefinedTypes, [['CHAIR', 1]])
  assert.equal(spaces.errors.length, 0)
  assert.ok(f.calls.length > 0 && f.calls.every(c => READ_ONLY.has(c)))
  // a glb has nothing to read, and says so rather than inventing something
  assert.match(out[2].errors[0], /glb model/)
})

test('a model can be picked by name fragment or id, or all of them', async () => {
  const f = fake()
  const src = { models, fragments: new Map<string, unknown>([['m1', f.model], ['m3', f.model]]), loadedInEngine: {}, classify: classifyLoaded }
  assert.deepEqual((await runIfcDiagnostics(src, 'spaces')).map(o => o.modelId), ['m1'])
  assert.deepEqual((await runIfcDiagnostics(src, ['M2', 'structures'])).map(o => o.modelId), ['m2', 'm3'])
  assert.equal((await runIfcDiagnostics(src, 'all')).length, 4)
  assert.equal((await runIfcDiagnostics(src, 'nothing-like-this')).length, 0)
})

test('a model that is not in the engine, or a query that fails, is reported as an error, not as data', async () => {
  const src = { models, fragments: new Map<string, unknown>(), loadedInEngine: { m1: false }, classify: classifyLoaded }
  const [one] = await runIfcDiagnostics(src, 'spaces')
  assert.equal(one.engineModelFound, false)
  assert.match(one.errors[0], /not in the engine/)
  assert.equal(one.totals.itemsWithGeometry, null)
  const broken = new Proxy({}, { get: () => async () => { throw new Error('worker not ready') } })
  const [two] = await runIfcDiagnostics({ ...src, fragments: new Map<string, unknown>([['m1', broken]]) }, 'spaces')
  assert.ok(two.errors.some(e => /worker not ready/.test(e)))
})
