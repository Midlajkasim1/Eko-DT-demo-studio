import { test } from 'node:test'
import assert from 'node:assert/strict'
import { levelHides, floorFilterSkips, isCeilingType, HVAC_SPECIFIC, HVAC_GENERIC } from '../src/lib/floorPolicy.ts'
import type { LevelIndex } from '../src/lib/floorPolicy.ts'
import { setHidden, isHidden } from '../src/lib/visibilityCoordinator.ts'

const rank: Record<string, number> = { B: -10, F1: 1, F2: 2, F3: 3, F4: 4, F5: 5 }
const rankOf = (id: string) => rank[id]
const pick = (id: string) => ({ id, rank: rank[id] })

// An architectural model: a wall and a ceiling on every floor from 1 to 5
const wall = (f: number) => 100 + f
const ceil = (f: number) => 200 + f
const arch = (): LevelIndex => ({
  geom: [1, 2, 3, 4, 5].flatMap(f => [wall(f), ceil(f)]),
  byFloor: new Map([1, 2, 3, 4, 5].map(f => [`F${f}`, [wall(f), ceil(f)]])),
  ceilings: new Set([1, 2, 3, 4, 5].map(ceil)),
  hvac: new Map(),
})
const shown = (ix: LevelIndex, hides: number[] | null) => ix.geom.filter(id => !hides?.includes(id)).sort((a, b) => a - b)

test('Fourth floor: its own ceilings hide, the floors above hide, the floors below keep everything', () => {
  const ix = arch()
  const out = shown(ix, levelHides(ix, pick('F4'), rankOf))
  assert.deepEqual(out, [wall(1), ceil(1), wall(2), ceil(2), wall(3), ceil(3), wall(4)].sort((a, b) => a - b))
})

test('another floor, and switching between floors, each get their own ceilings hidden', () => {
  const ix = arch()
  assert.deepEqual(shown(ix, levelHides(ix, pick('F2'), rankOf)), [wall(1), wall(2), ceil(1)])
  assert.deepEqual(shown(ix, levelHides(ix, pick('F5'), rankOf)).includes(ceil(5)), false)
  assert.deepEqual(shown(ix, levelHides(ix, pick('F4'), rankOf)).includes(ceil(4)), false)
  // back down: the ceiling of the floor just left comes back only if that floor is below the new one
  assert.deepEqual(shown(ix, levelHides(ix, pick('F2'), rankOf)).includes(ceil(4)), false)
  assert.deepEqual(shown(ix, levelHides(ix, pick('F5'), rankOf)).includes(ceil(4)), true)
})

test('without ceilings or HVAC it is the plain floor filter', () => {
  const ix: LevelIndex = { ...arch(), ceilings: new Set(), hvac: new Map() }
  assert.deepEqual(shown(ix, levelHides(ix, pick('F3'), rankOf)), [wall(1), wall(2), wall(3), ceil(1), ceil(2), ceil(3)])
})

test('only ceilings go: other coverings and other elements on the floor stay', () => {
  const ix = arch()
  ix.geom.push(900) // a floor finish, an IfcCovering that is not a ceiling
  ix.byFloor.get('F4')!.push(900)
  assert.ok(shown(ix, levelHides(ix, pick('F4'), rankOf)).includes(900))
})

test('a floor the catalog does not know hides everything; a covered floor with nothing to show filters nothing', () => {
  const ix = arch()
  assert.deepEqual(levelHides(ix, undefined, rankOf), ix.geom)
  const lonely: LevelIndex = { geom: [1], byFloor: new Map([['F1', []]]), ceilings: new Set(), hvac: new Map() }
  assert.equal(levelHides(lonely, pick('F1'), rankOf), null)
})

test('HVAC: kept when unassigned, or when its geometry is at or below the picked floor; hidden when the model puts it above', () => {
  const ix = arch()
  ix.geom.push(301, 302, 303, 304, 305)
  ix.byFloor.get('F5')!.push(301, 302, 303)   // filed under the floor above
  ix.byFloor.get('F2')!.push(304)             // filed under a floor below
  ix.hvac = new Map([
    [301, { assigned: true, heightFloor: 'F4' }],   // in the ceiling void of 4, hosted from 5: stays
    [302, { assigned: true, heightFloor: 'F5' }],   // really on 5: hides
    [303, { assigned: true, heightFloor: null }],   // filed above, height unknown: hides
    [304, { assigned: true, heightFloor: 'F2' }],   // below: stays
    [305, { assigned: false, heightFloor: null }],  // no floor at all: stays
  ])
  const out = shown(ix, levelHides(ix, pick('F4'), rankOf))
  assert.deepEqual([301, 302, 303, 304, 305].filter(id => out.includes(id)), [301, 304, 305])
})

test('a separate mechanical model whose floors are all above still keeps its unassigned and low HVAC, and hides the rest', () => {
  const mep: LevelIndex = {
    geom: [1, 2, 3, 4],
    byFloor: new Map([['F5', [1, 2]]]),
    ceilings: new Set(),
    hvac: new Map([
      [1, { assigned: true, heightFloor: 'F5' }],
      [2, { assigned: true, heightFloor: 'F3' }],
      [3, { assigned: false, heightFloor: null }],
      [4, { assigned: false, heightFloor: null }],
    ]),
  }
  assert.deepEqual(shown(mep, levelHides(mep, pick('F4'), rankOf)), [2, 3, 4])
})

test('ceiling detection reads the PredefinedType, not the name', () => {
  for (const t of ['CEILING', '.CEILING.', 'ceiling', ' CEILING ']) assert.equal(isCeilingType(t), true, t)
  for (const t of ['', 'FLOORING', 'CLADDING', 'NOTDEFINED', 'USERDEFINED', 'Compound Ceiling:ACT 600']) assert.equal(isCeilingType(t), false, t)
})

test('HVAC classes: instances only, and the generic flow classes are kept apart from the specific ones', () => {
  for (const c of ['IFCDUCTSEGMENT', 'IFCAIRTERMINAL', 'IFCFAN', 'IFCPIPEFITTING', 'IFCUNITARYEQUIPMENT']) assert.ok(HVAC_SPECIFIC.test(c), c)
  for (const c of ['IFCFLOWSEGMENT', 'IFCFLOWFITTING', 'IFCFLOWTERMINAL', 'IFCFLOWMOVINGDEVICE', 'IFCFLOWCONTROLLER', 'IFCENERGYCONVERSIONDEVICE']) assert.ok(HVAC_GENERIC.test(c), c)
  for (const c of ['IFCDUCTSEGMENTTYPE', 'IFCFLOWTERMINALTYPE', 'IFCFANTYPE', 'IFCWALL', 'IFCCOVERING', 'IFCCABLECARRIERSEGMENT', 'IFCSLAB']) {
    assert.ok(!HVAC_SPECIFIC.test(c) && !HVAC_GENERIC.test(c), c)
  }
  assert.ok(!HVAC_SPECIFIC.test('IFCFLOWSEGMENT') && !HVAC_GENERIC.test('IFCDUCTSEGMENT'))
})

test('with the visibility coordinator: the Tree keeps its own hides, and Reset gives back only the floor filter\'s', async () => {
  const log: Array<[number[], boolean]> = []
  const model = { setVisible: async (ids: number[] | undefined, v: boolean) => { log.push([ids ?? [], v]) } }
  const ix = arch()
  await setHidden(model, 'tree', [wall(4)])                                  // the Tree hid a wall on 4
  await setHidden(model, 'level', levelHides(ix, pick('F4'), rankOf)!)       // Fourth floor
  assert.ok(isHidden(model, ceil(4)) && isHidden(model, wall(4)) && isHidden(model, wall(5)))
  assert.ok(!isHidden(model, wall(3)))
  await setHidden(model, 'level', levelHides(ix, pick('F2'), rankOf)!)       // switch to Second floor
  assert.ok(isHidden(model, ceil(2)) && isHidden(model, wall(4)) && !isHidden(model, ceil(1)))
  await setHidden(model, 'level', [])                                        // Reset / All levels
  assert.ok(!isHidden(model, ceil(2)) && !isHidden(model, wall(5)) && !isHidden(model, ceil(4)))
  assert.ok(isHidden(model, wall(4)), 'the Tree\'s hide survives Reset of the floor filter')
})

/* ------------------------------ Isolate floor ------------------------------ */

const OFF = { alone: false }
const ON = { alone: true }
// the fixture's floors are F1..F5; the elements of floor n are wall(n) and ceil(n)
const onFloors = (ix: LevelIndex, hides: number[] | null) => {
  const out = new Set<number>()
  for (const f of [1, 2, 3, 4, 5]) for (const id of [wall(f), ceil(f)]) if (shown(ix, hides).includes(id)) out.add(f)
  return [...out].sort()
}
const walls = (ix: LevelIndex, hides: number[] | null) => [1, 2, 3, 4, 5].filter(f => shown(ix, hides).includes(wall(f)))

test('isolate OFF: Floor 3 shows floors 1, 2 and 3', () => {
  const ix = arch()
  assert.deepEqual(walls(ix, levelHides(ix, pick('F3'), rankOf, OFF)), [1, 2, 3])
  // and the options object being absent is the same thing
  assert.deepEqual(levelHides(ix, pick('F3'), rankOf, OFF), levelHides(ix, pick('F3'), rankOf))
})

test('isolate ON: Floor 3 shows floor 3 alone, and Floor 4 floor 4 alone', () => {
  const ix = arch()
  assert.deepEqual(walls(ix, levelHides(ix, pick('F3'), rankOf, ON)), [3])
  assert.deepEqual(walls(ix, levelHides(ix, pick('F4'), rankOf, ON)), [4])
  assert.deepEqual(walls(ix, levelHides(ix, pick('F1'), rankOf, ON)), [1])
  assert.deepEqual(walls(ix, levelHides(ix, pick('F5'), rankOf, ON)), [5])
})

test('isolate ON, switching floors: each pick shows only the newly picked floor', () => {
  const ix = arch()
  const seen = ['F3', 'F4', 'F2', 'F5', 'F1'].map(f => walls(ix, levelHides(ix, pick(f), rankOf, ON)))
  assert.deepEqual(seen, [[3], [4], [2], [5], [1]])
})

test('isolate turned OFF on Floor 4: floors 1 to 4 are visible again', () => {
  const ix = arch()
  assert.deepEqual(walls(ix, levelHides(ix, pick('F4'), rankOf, ON)), [4])
  assert.deepEqual(walls(ix, levelHides(ix, pick('F4'), rankOf, OFF)), [1, 2, 3, 4])
  // ... and on again: back to the one floor
  assert.deepEqual(walls(ix, levelHides(ix, pick('F4'), rankOf, ON)), [4])
})

test('ceilings: the picked floor own ceilings are hidden in both states, and no ceiling comes back', () => {
  const ix = arch()
  for (const f of ['F2', 'F3', 'F4']) {
    for (const opts of [OFF, ON]) {
      const out = shown(ix, levelHides(ix, pick(f), rankOf, opts))
      assert.ok(!out.includes(ceil(Number(f[1]))), `${f} ${JSON.stringify(opts)}`)
    }
  }
  // OFF keeps the ceilings of the floors below; ON shows no ceiling at all (nothing but the floor's own elements)
  assert.deepEqual(onFloors(arch(), levelHides(ix, pick('F3'), rankOf, OFF)), [1, 2, 3])
  assert.deepEqual(shown(ix, levelHides(ix, pick('F3'), rankOf, ON)), [wall(3)])
  assert.ok(shown(ix, levelHides(ix, pick('F3'), rankOf, OFF)).includes(ceil(2)))
})

test('isolate ON and HVAC: kept when it is on the floor or has no floor, hidden when the model puts it elsewhere', () => {
  const ix = arch()
  ix.geom.push(301, 302, 303, 304, 305, 306)
  ix.byFloor.get('F5')!.push(301, 302)       // filed above
  ix.byFloor.get('F2')!.push(303)            // filed below
  ix.byFloor.get('F4')!.push(306)            // filed on the picked floor
  ix.hvac = new Map([
    [301, { assigned: true, heightFloor: 'F4' }],   // filed above but physically on 4: stays
    [302, { assigned: true, heightFloor: 'F5' }],   // really on 5: hides
    [303, { assigned: true, heightFloor: 'F2' }],   // really on 2: hides when 4 is alone, stays when 4 is cumulative
    [304, { assigned: false, heightFloor: null }],  // no floor at all: stays
    [306, { assigned: true, heightFloor: 'F5' }],   // filed on 4: shown by its filing
  ])
  const alone = shown(ix, levelHides(ix, pick('F4'), rankOf, ON))
  assert.deepEqual([301, 302, 303, 304, 306].filter(id => alone.includes(id)), [301, 304, 306])
  const cumulative = shown(ix, levelHides(ix, pick('F4'), rankOf, OFF))
  assert.deepEqual([301, 302, 303, 304, 306].filter(id => cumulative.includes(id)), [301, 303, 304, 306])
})

test('isolate ON, a model with no elements on the picked floor hides entirely; with no floor information it filters nothing', () => {
  // MEP-style model: elements on floors 1, 2 and 4, none on 3
  const mep: LevelIndex = {
    geom: [1, 2, 4], byFloor: new Map([['F1', [1]], ['F2', [2]], ['F3', []], ['F4', [4]]]), ceilings: new Set(), hvac: new Map(),
  }
  assert.deepEqual(levelHides(mep, pick('F3'), rankOf, ON), [1, 2, 4])           // alone on 3: nothing of this model
  assert.deepEqual(shown(mep, levelHides(mep, pick('F3'), rankOf, OFF)), [1, 2]) // cumulative on 3: floors 1 and 2
  // a model that names floors but places nothing on any of them: no information, no filter, in both states
  const blind: LevelIndex = { geom: [1, 2], byFloor: new Map([['F1', []], ['F2', []]]), ceilings: new Set(), hvac: new Map() }
  assert.equal(levelHides(blind, pick('F2'), rankOf, ON), null)
  assert.equal(levelHides(blind, pick('F2'), rankOf, OFF), null)
  // a model without the picked floor at all hides entirely when it is alone; cumulative still shows the floors below
  const lacking: LevelIndex = { geom: [1, 2], byFloor: new Map([['F1', [1]], ['F4', [2]]]), ceilings: new Set(), hvac: new Map() }
  assert.deepEqual(levelHides(lacking, pick('F3'), rankOf, ON), [1, 2])
  assert.deepEqual(shown(lacking, levelHides(lacking, pick('F3'), rankOf, OFF)), [1])
})

test('isolate with the visibility coordinator: the Tree hides survive switching floors and the toggle, and Reset gives back only the floor filter hides', async () => {
  const model = { setVisible: async () => {} }
  const ix = arch()
  await setHidden(model, 'tree', [wall(3)])                                                  // the Tree hid a wall on floor 3
  await setHidden(model, 'level', levelHides(ix, pick('F3'), rankOf, ON)!)                   // Floor 3 alone
  assert.ok(isHidden(model, wall(3)) && isHidden(model, wall(2)) && isHidden(model, wall(4)) && isHidden(model, ceil(3)))
  await setHidden(model, 'level', levelHides(ix, pick('F4'), rankOf, ON)!)                   // switch: Floor 4 alone
  assert.ok(!isHidden(model, wall(4)) && isHidden(model, wall(3)) && isHidden(model, wall(1)) && isHidden(model, ceil(4)))
  await setHidden(model, 'level', levelHides(ix, pick('F4'), rankOf, OFF)!)                  // isolate off, still on Floor 4
  assert.ok(!isHidden(model, wall(1)) && !isHidden(model, wall(2)) && isHidden(model, wall(3)), 'floors 1-4 back; the Tree hide stays')
  assert.ok(isHidden(model, wall(5)) && isHidden(model, ceil(4)))
  await setHidden(model, 'level', [])                                                        // Reset
  assert.ok(!isHidden(model, wall(5)) && !isHidden(model, ceil(4)) && isHidden(model, wall(3)))
})

test('the ground around the building (Landscape) is not filtered by a floor pick, unless the floor is isolated', () => {
  assert.equal(floorFilterSkips('land', false), true)
  assert.equal(floorFilterSkips('land', true), false, 'isolating a floor keeps the existing floor-only filter')
  for (const group of ['arch', 'elec', 'mech', 'str', 'int', 'site', 'equip', 'other']) {
    assert.equal(floorFilterSkips(group, false), false, `${group} still follows the floors`)
    assert.equal(floorFilterSkips(group, true), false)
  }
})
