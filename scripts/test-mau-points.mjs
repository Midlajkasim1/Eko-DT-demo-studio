// MAHU point reading and schematic build/dispose (no browser). Run: node scripts/test-mau-points.mjs
import assert from 'node:assert'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src', import.meta.url))
const out = await build({
  stdin: { contents: "export * from '@/lib/mauSchematic'; export * as THREE from 'three'", resolveDir: src, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': src }, logLevel: 'silent',
})
const { readMauPoints, createMauSchematic, THREE } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('ok  ' + name) }
const pts = o => Object.entries(o).map(([navName, currentValue]) => ({ navName, currentValue }))

test('no points: every reading is unknown, nothing is called off, clean or normal', () => {
  const r = readMauPoints([])
  assert.strictEqual(r.faDamperOpen, null)
  assert.strictEqual(r.preFilterDirty, null)
  assert.strictEqual(r.sfOn, null)
  assert.strictEqual(r.sfRate, 0)
  for (const k of ['faDamper', 'preFilter', 'bagFilter', 'sfStatus', 'sfTrip', 'saTemp', 'tempAfterHp', 'coolingValveCmd']) assert.strictEqual(r[k], '—', k)
})

test('FIN "—" / Null values count as missing', () => {
  const r = readMauPoints(pts({ SF_VFD_RUN_STS: '—', PRE_FILTER: 'Null', SA_TEMP: 'N/A' }))
  assert.strictEqual(r.sfOn, null)
  assert.strictEqual(r.preFilter, '—')
  assert.strictEqual(r.saTemp, '—')
})

test('the FIN page point names drive the readings', () => {
  const r = readMauPoints(pts({
    FA_DAMPER_STS: 'T', PRE_FILTER: 'F', BAG_FILTER: 'T', COOLING_VALVE_POS: '40%', COOLING_VALVE_CMD: '45%',
    SF_VFD_RUN_STS: 'T', SF_VFD_SPD_POS: '50', SF_TRIP_ALARM: 'F',
    TEMP_BEFORE_HEATPIPE: '24.5°C', HUM_AFTER_HEATPIPE: '61', SA_PRESSURE: '250',
  }))
  assert.strictEqual(r.faDamperOpen, 1)
  assert.strictEqual(r.faDamper, 'Open')
  assert.strictEqual(r.preFilter, 'Clean')
  assert.strictEqual(r.bagFilter, 'Dirty')
  assert.strictEqual(r.coolingValvePos, 0.4)
  assert.strictEqual(r.coolingValveCmd, '45 %')
  assert.strictEqual(r.sfOn, true)
  assert.ok(Math.abs(r.sfRate - 1.8) < 1e-9)
  assert.strictEqual(r.sfTrip, 'Normal')
  assert.strictEqual(r.tempBeforeHp, '24.5°C')
  assert.strictEqual(r.humAfterHp, '61 %RH')
  assert.strictEqual(r.saPressure, '250 Pa')
})

test('a setpoint never answers for its reading', () => {
  const r = readMauPoints(pts({ SA_TEMP_SP: '18', SA_PRESSURE_SP: '300' }))
  assert.strictEqual(r.saTemp, '—')
  assert.strictEqual(r.saTempSp, '18 °C')
  assert.strictEqual(r.saPressure, '—')
})

test('FA_DAMPER_STS is open/closed even when FIN sends 1/0, never a percentage', () => {
  const open = readMauPoints(pts({ FA_DAMPER_STS: '1' }))
  assert.strictEqual(open.faDamper, 'Open')
  assert.strictEqual(open.faDamperOpen, 1)
  const shut = readMauPoints(pts({ FA_DAMPER_STS: '0' }))
  assert.strictEqual(shut.faDamper, 'Closed')
  assert.strictEqual(shut.faDamperOpen, 0)
  assert.strictEqual(readMauPoints(pts({ FA_DAMPER_STS: 'F' })).faDamper, 'Closed')
})

test('fan falls back to SF_AIRFLOW_STS, and off stops it', () => {
  assert.strictEqual(readMauPoints(pts({ SF_VFD_RUN_STS: '—', SF_AIRFLOW_STS: 'T' })).sfOn, true)
  const off = readMauPoints(pts({ SF_VFD_RUN_STS: 'F' }))
  assert.strictEqual(off.sfOn, false)
  assert.strictEqual(off.sfRate, 0)
})

test('schematic fits a casing, tracks every part, and dispose detaches it', () => {
  const box = new THREE.Box3(new THREE.Vector3(-2, 0, -0.9), new THREE.Vector3(2, 1.6, 0.9))
  const s = createMauSchematic(box, new THREE.Matrix4())
  assert.ok(s)
  const parent = new THREE.Group()
  parent.add(s.group)
  let meshes = 0
  s.group.traverse(o => { if (o.isMesh) meshes++ })
  assert.ok(meshes > 100, `only ${meshes} meshes`)
  assert.ok(s.anchors.length === 7)
  s.apply(pts({ SF_VFD_RUN_STS: 'T' }))
  s.tick(0.1)
  s.dispose()
  assert.strictEqual(s.group.parent, null)
  const bare = createMauSchematic(box, new THREE.Matrix4(), undefined, { bagFilter: false, heatPipe: false })
  assert.strictEqual(bare.anchors.length, 5)
  bare.dispose()
})

console.log(`\n${passed} MAHU tests passed`)
