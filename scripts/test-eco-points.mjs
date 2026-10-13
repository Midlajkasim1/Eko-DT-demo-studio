// ECO-ANC09-BF-01 point reading and schematic build/dispose (no browser). Run: node scripts/test-eco-points.mjs
import assert from 'node:assert'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src', import.meta.url))
const out = await build({
  stdin: { contents: "export * from '@/lib/ecoSchematic'; export * as THREE from 'three'", resolveDir: src, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': src }, logLevel: 'silent',
})
const { readEcoPoints, createEcoSchematic, ECO_FILTERS, THREE } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('ok  ' + name) }
const pts = o => Object.entries(o).map(([navName, currentValue]) => ({ navName, currentValue }))

test('no points: every reading is unknown, nothing is called off, clean or normal', () => {
  const r = readEcoPoints([])
  for (const k of ['preFilterDirty', 'bagFilterDirty', 'boxFilterDirty', 'uv1Alarm', 'uv2Alarm', 'kefOn']) assert.strictEqual(r[k], null, k)
  assert.strictEqual(r.kefRate, 0)
  for (const k of ['preFilter', 'bagFilter', 'boxFilter', 'uv1', 'uv2', 'kefStatus', 'vfdRun', 'vfdSpeed', 'kefHoa', 'kefTrip', 'allFilterAlarm', 'commonAlarm']) assert.strictEqual(r[k], '—', k)
})

test('FIN "—" / Null values count as missing', () => {
  const r = readEcoPoints(pts({ KEF_ON_STS: '—', BOX_FILTER: 'Null', COMMAN_ALARM: 'N/A' }))
  assert.strictEqual(r.kefOn, null)
  assert.strictEqual(r.boxFilter, '—')
  assert.strictEqual(r.commonAlarm, '—')
})

test('the FIN page point names drive the readings', () => {
  const r = readEcoPoints(pts({
    PRE_FILTER: 'F', BAG_FILTER: 'T', BOX_FILTER: 'F',
    '1ST_STAGE_UV_ALARM': 'F', '2ND_STAGE_UV_ALARM': 'T',
    KEF_ON_STS: 'T', VFD_RUN_STS: 'T', VFD_SPEED_POS: '50', KEF_HOA: 'Auto', KEF_TRIP_STS: 'F',
    ALL_FILTER_ALARM: 'F', COMMAN_ALARM: 'T',
  }))
  assert.strictEqual(r.preFilter, 'Clean')
  assert.strictEqual(r.bagFilter, 'Dirty')
  assert.strictEqual(r.boxFilter, 'Clean')
  assert.strictEqual(r.uv1, 'Normal')
  assert.strictEqual(r.uv2Alarm, true)
  assert.strictEqual(r.uv2, 'Alarm')
  assert.strictEqual(r.kefOn, true)
  assert.ok(Math.abs(r.kefRate - 1.8) < 1e-9)
  assert.strictEqual(r.vfdSpeed, '50 %')
  assert.strictEqual(r.kefHoa, 'Auto')
  assert.strictEqual(r.kefTrip, 'Normal')
  assert.strictEqual(r.allFilterAlarm, 'Normal')
  assert.strictEqual(r.commonAlarm, 'Alarm')
})

test('the two UV stages never answer for each other, and 1/0 reads as a status', () => {
  const r = readEcoPoints(pts({ '1ST_STAGE_UV_ALARM': '1' }))
  assert.strictEqual(r.uv1, 'Alarm')
  assert.strictEqual(r.uv2, '—')
})

test('fan falls back to VFD_RUN_STS, and off stops it', () => {
  assert.strictEqual(readEcoPoints(pts({ KEF_ON_STS: '—', VFD_RUN_STS: 'T' })).kefOn, true)
  const off = readEcoPoints(pts({ KEF_ON_STS: 'F' }))
  assert.strictEqual(off.kefOn, false)
  assert.strictEqual(off.kefRate, 0)
})

const box = new THREE.Box3(new THREE.Vector3(-2, 0, -0.9), new THREE.Vector3(2, 1.6, 0.9))
const order = s => [...s.anchors].sort((a, b) => a.position.x - b.position.x).map(a => a.key)
/* Direct parts of the schematic, grouped by the section (anchor) they sit in */
const partsBySection = s => {
  const out = Object.fromEntries(s.anchors.map(a => [a.key, 0]))
  for (const o of s.group.children) {
    const near = s.anchors.reduce((b, a) => Math.abs(a.position.x - o.position.x) < Math.abs(b.position.x - o.position.x) ? a : b)
    out[near.key]++
  }
  return out
}

test('layout is filter, filter, filter, UV stage 1, UV stage 2, exhaust fan', () => {
  const s = createEcoSchematic(box, new THREE.Matrix4())
  assert.deepStrictEqual(ECO_FILTERS, ['PRE_FILTER', 'BAG_FILTER', 'BOX_FILTER'])
  assert.deepStrictEqual(order(s), ['preFilter', 'bagFilter', 'boxFilter', 'uv1', 'uv2', 'kefStatus'])
  s.dispose()
})

test('exactly three filter frames, two UV canisters and one fan; no damper, cube or lamp bank', () => {
  const s = createEcoSchematic(box, new THREE.Matrix4())
  // Panel filter: 4 frame bars + media + 2 braces. Canister: body, cap, neck, gauge. Fan: wheel pivot + 4 opening rails.
  assert.deepStrictEqual(partsBySection(s), { preFilter: 7, bagFilter: 7, boxFilter: 7, uv1: 4, uv2: 4, kefStatus: 5 })
  assert.strictEqual(s.group.children.length, 34)
  s.dispose()
})

test('the six sections do not overlap along the airflow', () => {
  const s = createEcoSchematic(box, new THREE.Matrix4())
  const spans = s.anchors.map(a => {
    const b = new THREE.Box3()
    for (const o of s.group.children) {
      const near = s.anchors.reduce((m, x) => Math.abs(x.position.x - o.position.x) < Math.abs(m.position.x - o.position.x) ? x : m)
      if (near === a) b.expandByObject(o)
    }
    // expandByObject is in world space; the group sits at the casing centre with no rotation here
    return [b.min.x, b.max.x]
  }).sort((p, q) => p[0] - q[0])
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i - 1][1] < spans[i][0], `section ${i - 1} overlaps section ${i}`)
  s.dispose()
})

test('each filter frame shows its own FIN point, and a missing point stays neutral', () => {
  const s = createEcoSchematic(box, new THREE.Matrix4())
  s.apply(pts({ PRE_FILTER: 'T', BAG_FILTER: 'F', BOX_FILTER: 'Null' }))
  const colours = key => {
    const a = s.anchors.find(x => x.key === key)
    return s.group.children.filter(o => o.isMesh && Math.abs(o.position.x - a.position.x) < 1e-6).map(o => o.material.color.getHex())
  }
  assert.ok(colours('preFilter').includes(0x9c6b2e), 'PRE_FILTER dirty')
  assert.ok(colours('bagFilter').includes(0xc8d6df), 'BAG_FILTER clean')
  assert.ok(colours('boxFilter').includes(0x9aa3ab), 'BOX_FILTER no data')
  assert.ok(!colours('boxFilter').includes(0x9c6b2e) && !colours('boxFilter').includes(0xc8d6df), 'BOX_FILTER is neither clean nor dirty')
  s.dispose()
})

test('the filter frames can be pointed at other FIN filter points', () => {
  const s = createEcoSchematic(box, new THREE.Matrix4(), undefined, { filters: ['BOX_FILTER', 'BAG_FILTER'] })
  assert.deepStrictEqual(order(s), ['boxFilter', 'bagFilter', 'uv1', 'uv2', 'kefStatus'])
  s.dispose()
})

test('live states drive the parts; null data leaves them neutral; dispose detaches', () => {
  const s = createEcoSchematic(box, new THREE.Matrix4())
  const parent = new THREE.Group()
  parent.add(s.group)
  const r = s.apply(pts({ KEF_ON_STS: 'T', VFD_SPEED_POS: '50', '1ST_STAGE_UV_ALARM': 'F', '2ND_STAGE_UV_ALARM': 'T', PRE_FILTER: 'T' }))
  assert.strictEqual(r.uv1Alarm, false)
  assert.strictEqual(r.uv2Alarm, true)
  assert.strictEqual(r.preFilterDirty, true)
  assert.ok(r.kefRate > 0)
  const before = s.group.children.find(o => o.isGroup).children.find(o => o.isGroup).rotation.z
  s.tick(0.1)
  assert.notStrictEqual(s.group.children.find(o => o.isGroup).children.find(o => o.isGroup).rotation.z, before)
  const empty = s.apply(pts({ KEF_ON_STS: 'Null', '1ST_STAGE_UV_ALARM': '—' }))
  assert.strictEqual(empty.kefOn, null)
  assert.strictEqual(empty.kefRate, 0)
  assert.strictEqual(empty.uv1Alarm, null)
  s.dispose()
  assert.strictEqual(s.group.parent, null)
})

console.log(`\n${passed} ECO tests passed`)
