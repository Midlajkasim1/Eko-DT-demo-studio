// ECO-ANC09-BF-01 point reading and schematic build/dispose (no browser). Run: node scripts/test-eco-points.mjs
import assert from 'node:assert'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src', import.meta.url))
const out = await build({
  stdin: { contents: "export * from '@/lib/ecoSchematic'; export * as THREE from 'three'", resolveDir: src, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': src }, logLevel: 'silent',
})
const { readEcoPoints, createEcoSchematic, THREE } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

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

test('schematic fits a casing, tracks every part, and dispose detaches it', () => {
  const box = new THREE.Box3(new THREE.Vector3(-2, 0, -0.9), new THREE.Vector3(2, 1.6, 0.9))
  const s = createEcoSchematic(box, new THREE.Matrix4())
  assert.ok(s)
  const parent = new THREE.Group()
  parent.add(s.group)
  let meshes = 0
  s.group.traverse(o => { if (o.isMesh) meshes++ })
  assert.ok(meshes > 60, `only ${meshes} meshes`)
  assert.strictEqual(s.anchors.length, 6)
  s.apply(pts({ KEF_ON_STS: 'T', '1ST_STAGE_UV_ALARM': 'F' }))
  s.tick(0.1)
  s.dispose()
  assert.strictEqual(s.group.parent, null)
})

console.log(`\n${passed} ECO tests passed`)
