// FCU / FAHU / MAHU / ECO internals driven by FIN points: what each reading means, which 3D part it
// colours or moves, and that nothing else changes with it. Values are given the way the backend sends
// them (display_cur_val: a Zinc T/F arrives as "On"/"Off", or as FIN's own label such as "Open").
// No browser, no FIN. Run: node scripts/test-hvac-schematics.mjs
import assert from 'node:assert'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src', import.meta.url))
const out = await build({
  stdin: {
    contents: [
      "export * from '@/lib/fcuSchematic'", "export * from '@/lib/fahuSchematic'",
      "export * from '@/lib/mauSchematic'", "export * from '@/lib/ecoSchematic'",
      "export { FAN_ON, FAN_OFF, FAN_FAULT, NO_DATA, FILTER_CLEAN, FILTER_DIRTY, COIL_IDLE, DAMPER_BLADE } from '@/lib/hvacGeometry'",
      "export * as THREE from 'three'",
    ].join('\n'),
    resolveDir: src, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': src }, logLevel: 'silent',
})
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
const { THREE, FAN_ON, FAN_OFF, FAN_FAULT, NO_DATA, FILTER_CLEAN, FILTER_DIRTY, DAMPER_BLADE } = M

let passed = 0, failed = 0
const test = (name, fn) => {
  try { fn(); passed++; console.log('ok  ' + name) } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]) }
}
const pts = o => Object.entries(o).map(([navName, currentValue]) => ({ navName, currentValue }))
const hex = c => c.getHexString()

// --- builders -------------------------------------------------------------------------------
const box = new THREE.Box3(new THREE.Vector3(-2, 0, -0.9), new THREE.Vector3(2, 1.6, 0.9))
const fcu = () => M.createFcuSchematic(new THREE.Box3(new THREE.Vector3(-0.6, 0, -0.3), new THREE.Vector3(0.6, 0.3, 0.3)), new THREE.Matrix4())
const mau = () => M.createMauSchematic(box, new THREE.Matrix4())
const eco = () => M.createEcoSchematic(box, new THREE.Matrix4())
// FAHU-ANC09-BF-01's two casings (fahuSchematic.ts): lower 5504 x 750 x 2036 mm, upper 1800 mm long on the -X end
function fahu() {
  const casing = new THREE.Group()
  const deck = (len, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.75, 2.036))
    m.position.set(x, y, 0); m.userData.ekoGhostDepth = true; casing.add(m)
  }
  deck(5.504, 0, 0.375)
  deck(1.8, -5.504 / 2 + 0.9, 0.75 + 0.05 + 0.375)
  return M.createFahuSchematic(new THREE.Box3(), new THREE.Matrix4(), casing)
}

// every material's colour, so a test can say exactly which parts a point changed
function colours(s) {
  const mats = new Map()
  s.group.traverse(o => { if (o.isMesh && o.material?.color) mats.set(o.material, hex(o.material.color)) })
  return mats
}
function changed(s, before, after) {
  s.apply(before); const a = colours(s)
  s.apply(after); const b = colours(s)
  return [...b].filter(([m, c]) => a.get(m) !== c).map(([m, c]) => ({ m, from: a.get(m), to: c }))
}
const spins = (s, points) => {
  s.apply(points)
  const rot = []; s.group.traverse(o => rot.push([o, o.rotation.z]))
  s.tick(0.5)
  return rot.some(([o, z]) => o.rotation.z !== z)
}

// Damper blades (ekoDamperBlade) per damper, in their parent's frame. Seen through the damper
// (along the air), what share of the frame opening do the blades cover?
function damperCover(s) {
  const byParent = new Map()
  s.group.traverse(o => { if (o.userData.ekoDamperBlade) (byParent.get(o.parent) || byParent.set(o.parent, []).get(o.parent)).push(o) })
  return [...byParent.values()].map(blades => {
    blades.sort((a, b) => a.position.y - b.position.y)
    const stride = blades[1].position.y - blades[0].position.y
    const lo = blades[0].position.y - stride / 2, hi = blades.at(-1).position.y + stride / 2
    const spans = blades.map(b => {
      b.updateMatrix(); b.geometry.computeBoundingBox()
      const bb = b.geometry.boundingBox.clone().applyMatrix4(b.matrix)
      return [Math.max(lo, bb.min.y), Math.min(hi, bb.max.y)]
    }).sort((a, b) => a[0] - b[0])
    let covered = 0, end = lo
    for (const [a, b] of spans) { if (b > end) { covered += b - Math.max(a, end); end = b } }
    return covered / (hi - lo)
  })
}

// --- FCU ------------------------------------------------------------------------------------
test('FCU: the fan state comes from its run STATUS; a run command alone is no proof it runs', () => {
  assert.strictEqual(M.readFcuPoints(pts({ FAN_RUN_STS: 'On' })).fanOn, true)
  assert.strictEqual(M.readFcuPoints(pts({ FAN_RUN_STS: 'Off' })).fanOn, false)
  assert.strictEqual(M.readFcuPoints(pts({ FAN_STATUS: 'On' })).fanOn, true)
  assert.strictEqual(M.readFcuPoints(pts({ FAN_RUN_CMD: 'On' })).fanOn, null, 'a command is not a status')
  assert.strictEqual(M.readFcuPoints(pts({ FAN_RUN_CMD: 'On', FAN_RUN_STS: 'Off' })).fanOn, false)
  assert.strictEqual(M.readFcuPoints(pts({ FAN_RUN_STS: '—' })).fanOn, null)
  assert.strictEqual(M.readFcuPoints([]).fanOn, null)
  assert.strictEqual(M.readFcuPoints(pts({ FAN_RUN_STS: 'Off', FAN_SPEED: '80%' })).fanRate, 0, 'stopped never spins')
})

test('FCU: fan colour and spin follow the status; no status is the no-data grey, not "off"', () => {
  const s = fcu()
  const fan = changed(s, pts({ FAN_RUN_STS: 'Off' }), pts({ FAN_RUN_STS: 'On' }))
  assert.deepStrictEqual(fan.map(c => [c.from, c.to]), [[hex(FAN_OFF), hex(FAN_ON)]], 'only the fan blades change')
  assert.ok(spins(s, pts({ FAN_RUN_STS: 'On' })))
  assert.ok(!spins(s, pts({ FAN_RUN_STS: 'Off' })))
  const none = changed(s, pts({ FAN_RUN_STS: 'On' }), [])
  assert.ok(none.some(c => c.to === hex(NO_DATA) && c.from === hex(FAN_ON)), 'missing status shows no-data')
  s.dispose()
})

test('FCU: the coil colour follows the valve position only', () => {
  const s = fcu()
  const coil = changed(s, pts({ COOLING_VALVE_POS: '0%' }), pts({ COOLING_VALVE_POS: '100%' }))
  assert.strictEqual(coil.length, 1, 'one material (the coil and its pipework) changes')
  assert.deepStrictEqual(changed(s, pts({ COOLING_VALVE_POS: '40%' }), pts({ COOLING_VALVE_POS: '40%', COOLING_VALVE_CMD: '90%' })), [],
    'the command does not colour the coil')
  s.dispose()
})

test('FCU: FAN_SPEED_MODE is a mode, not a %: shown as sent, never scales the spin', () => {
  const r = M.readFcuPoints(pts({ FAN_RUN_STS: 'On', FAN_SPEED_MODE: '2' }))
  assert.strictEqual(r.fanSpeed, '2')
  assert.strictEqual(r.fanRate, M.readFcuPoints(pts({ FAN_RUN_STS: 'On' })).fanRate, 'the default running spin')
  assert.strictEqual(M.readFcuPoints(pts({ FAN_SPEED: '80' })).fanSpeed, '80 %', 'a real speed point keeps its %')
})

// --- FAHU -----------------------------------------------------------------------------------
test('FAHU: a filter switch the backend sends as "On" is dirty, "Off" clean, missing unknown', () => {
  assert.strictEqual(M.readFahuPoints(pts({ PRE_FILTER: 'On' })).preFilterDirty, true)
  assert.strictEqual(M.readFahuPoints(pts({ PRE_FILTER: 'Off' })).preFilterDirty, false)
  assert.strictEqual(M.readFahuPoints(pts({ PRE_FILTER: 'Dirty' })).preFilterDirty, true)
  assert.strictEqual(M.readFahuPoints(pts({ PRE_FILTER: 'Clean' })).preFilterDirty, false)
  assert.strictEqual(M.readFahuPoints([]).preFilterDirty, null)
  assert.strictEqual(M.readFahuPoints([]).sfFanOn, null)
  assert.strictEqual(M.readFahuPoints(pts({ SF_VFD_RUN_STS: 'Off' })).sfFanOn, false)
})

test('FAHU: each filter point colours only its own filter, and clears back to clean', () => {
  const s = fahu()
  assert.ok(s, 'FAHU schematic builds on a two-deck casing')
  const base = { PRE_FILTER: 'Off', BAG_FILTER: 'Off', RA_FILTER: 'Off', SF_VFD_RUN_STS: 'On', EF_VFD_RUN_STS: 'On' }
  for (const f of ['PRE_FILTER', 'BAG_FILTER', 'RA_FILTER']) {
    const c = changed(s, pts(base), pts({ ...base, [f]: 'On' }))
    assert.deepStrictEqual(c.map(x => [x.from, x.to]), [[hex(FILTER_CLEAN), hex(FILTER_DIRTY)]], f)
    const back = changed(s, pts({ ...base, [f]: 'On' }), pts(base))
    assert.deepStrictEqual(back.map(x => x.to), [hex(FILTER_CLEAN)], f + ' clears')
  }
  const fans = changed(s, pts(base), pts({ ...base, SF_VFD_RUN_STS: 'Off' }))
  assert.deepStrictEqual(fans.map(x => [x.from, x.to]), [[hex(FAN_ON), hex(FAN_OFF)]], 'only the supply fan')
  s.dispose()
})

test('FAHU: dampers are shut when closed and open when open', () => {
  const s = fahu()
  s.apply(pts({ EA_DAMPER_STS: 'Closed', SA_DAMPER_STS: 'Closed' }))
  assert.strictEqual(damperCover(s).length, 2, 'the exhaust and supply dampers')
  for (const c of damperCover(s)) assert.ok(c > 0.9, 'closed covers the opening: ' + c.toFixed(2))
  s.apply(pts({ EA_DAMPER_STS: 'Open', SA_DAMPER_STS: 'Open' }))
  for (const c of damperCover(s)) assert.ok(c < 0.3, 'open leaves the opening clear: ' + c.toFixed(2))
  s.dispose()
})

test('FAHU: the fan uses its VFD run status over the airflow switch, whichever FIN lists first', () => {
  assert.strictEqual(M.readFahuPoints(pts({ SF_AIRFLOW_STS: 'Off', SF_VFD_RUN_STS: 'On' })).sfFanOn, true)
  assert.strictEqual(M.readFahuPoints(pts({ EF_AIRFLOW_STS: 'On', EF_VFD_RUN_STS: 'Off' })).efFanOn, false)
  assert.strictEqual(M.readFahuPoints(pts({ SF_AIRFLOW_STS: 'On' })).sfFanOn, true, 'airflow when no run status is sent')
  assert.strictEqual(M.readFahuPoints(pts({ SF_VFD_CMD: 'On' })).sfFanOn, null, 'a command is not a status')
})

test('FAHU: EF_TRIP / SF_TRIP_ALARM turn only their own fan amber; spin still follows the run status', () => {
  const s = fahu()
  const base = { SF_VFD_RUN_STS: 'On', EF_VFD_RUN_STS: 'On', EF_TRIP: 'Off', SF_TRIP_ALARM: 'Off' }
  for (const t of ['EF_TRIP', 'SF_TRIP_ALARM']) {
    const c = changed(s, pts(base), pts({ ...base, [t]: 'On' }))
    assert.deepStrictEqual(c.map(x => [x.from, x.to]), [[hex(FAN_ON), hex(FAN_FAULT)]], t)
  }
  const r = M.readFahuPoints(pts({ SF_TRIP_ALARM: 'Trip' }))
  assert.deepStrictEqual([r.sfTripped, r.sfFanOn], [true, null], 'a trip says nothing about running')
  s.dispose()
})

test('FAHU: the wheels turn on their speed feedback, never on HRW_CMD / SENSIBLE_CMD alone', () => {
  assert.deepStrictEqual([M.readFahuPoints(pts({ HRW_CMD: 'On', SENSIBLE_CMD: 'On' })).hrwOn, M.readFahuPoints(pts({ SENSIBLE_CMD: 'On' })).sensibleOn], [false, false])
  assert.strictEqual(M.readFahuPoints(pts({ HRW_VFD_SPD_POS: '60%' })).hrwOn, true)
  assert.strictEqual(M.readFahuPoints(pts({ SENSIBLE_VFD_SPD_POS: '0%' })).sensibleOn, false)
})

test('FAHU: a damper with no reading is no-data grey, not a believable open damper', () => {
  const s = fahu()
  const c = changed(s, pts({ EA_DAMPER: 'Open', SA_DAMPER: 'Closed' }), [])
  assert.deepStrictEqual(c.map(x => [x.from, x.to]).filter(([f]) => f === hex(DAMPER_BLADE)),
    [[hex(DAMPER_BLADE), hex(NO_DATA)], [hex(DAMPER_BLADE), hex(NO_DATA)]], 'both dampers')
  s.dispose()
})

// --- MAHU -----------------------------------------------------------------------------------
test('MAHU: FA_DAMPER_STS closed shows a shut damper, open an open one, unknown half-way', () => {
  const s = mau()
  for (const [v, want] of [['Closed', 'shut'], ['Off', 'shut'], ['0', 'shut'], ['Open', 'open'], ['On', 'open'], ['1', 'open']]) {
    s.apply(pts({ FA_DAMPER_STS: v }))
    const all = damperCover(s)
    assert.strictEqual(all.length, 1, 'one fresh-air damper')
    const [c] = all
    assert.ok(want === 'shut' ? c > 0.9 : c < 0.3, `${v}: cover ${c.toFixed(2)}`)
  }
  s.apply([])
  const [mid] = damperCover(s)
  assert.ok(mid > 0.3 && mid < 0.9, 'no reading is neither open nor shut: ' + mid.toFixed(2))
  // FA_DAMPER_STS showed Null on the FIN page: that must not look like a real, open damper
  const c = changed(s, pts({ FA_DAMPER_STS: 'Open' }), [])
  assert.deepStrictEqual(c.map(x => [x.from, x.to]).filter(([f]) => f === hex(DAMPER_BLADE)), [[hex(DAMPER_BLADE), hex(NO_DATA)]])
  assert.deepStrictEqual(changed(s, [], pts({ FA_DAMPER_STS: 'Closed' })).map(x => x.to).filter(t => t === hex(DAMPER_BLADE)), [hex(DAMPER_BLADE)], 'a reading clears it')
  s.dispose()
})

test('MAHU: the damper position point wins over the status when both are sent', () => {
  assert.strictEqual(M.readMauPoints(pts({ FA_DAMPER_STS: 'Open', FA_DAMPER_POS: '0%' })).faDamperOpen, 0)
})

test('MAHU: a supply-fan trip is amber, separate from stopped and running; spin follows the run status', () => {
  const s = mau()
  const trip = changed(s, pts({ SF_VFD_RUN_STS: 'Off', SF_TRIP_ALARM: 'Off' }), pts({ SF_VFD_RUN_STS: 'Off', SF_TRIP_ALARM: 'On' }))
  assert.deepStrictEqual(trip.map(x => [x.from, x.to]), [[hex(FAN_OFF), hex(FAN_FAULT)]])
  assert.ok(!spins(s, pts({ SF_VFD_RUN_STS: 'Off', SF_TRIP_ALARM: 'On' })), 'tripped and stopped does not spin')
  assert.ok(spins(s, pts({ SF_VFD_RUN_STS: 'On', SF_TRIP_ALARM: 'On' })), 'the run status still decides the spin')
  assert.strictEqual(M.readMauPoints(pts({ SF_TRIP_ALARM: 'Off' })).sfOn, null, 'no trip says nothing about running')
  s.dispose()
})

test("MAHU: FIN's own trip labels count; the fan speed is the feedback, not SF_VFD_SPD_CMD", () => {
  for (const [v, want] of [['Trip', true], ['Tripped', true], ['Alarm', true], ['Normal', false], ['No Trip', false], ['On', true], ['Off', false], ['—', null]])
    assert.strictEqual(M.readMauPoints(pts({ SF_TRIP_ALARM: v })).sfTripped, want, v)
  assert.strictEqual(M.readMauPoints(pts({ SF_VFD_SPD_CMD: '80' })).sfSpeed, '—', 'a command is not the speed')
  assert.strictEqual(M.readMauPoints(pts({ SF_VFD_SPD_POS: '80' })).sfSpeed, '80 %')
})

test('MAHU: a filter point colours only its filter', () => {
  const s = mau()
  const base = { PRE_FILTER: 'Off', BAG_FILTER: 'Off', SF_VFD_RUN_STS: 'On', FA_DAMPER_STS: 'Open' }
  for (const f of ['PRE_FILTER', 'BAG_FILTER']) {
    assert.deepStrictEqual(changed(s, pts(base), pts({ ...base, [f]: 'On' })).map(x => x.to), [hex(FILTER_DIRTY)], f)
  }
  s.dispose()
})

// --- ECO ------------------------------------------------------------------------------------
test('ECO: KEF_TRIP_STS is a fan fault (amber), not "stopped"; spin follows KEF_ON_STS', () => {
  const r = M.readEcoPoints(pts({ KEF_TRIP_STS: 'On', KEF_ON_STS: 'Off' }))
  assert.deepStrictEqual([r.kefTripped, r.kefOn], [true, false])
  assert.strictEqual(M.readEcoPoints(pts({ KEF_TRIP_STS: 'On' })).kefOn, null, 'a trip says nothing about running')
  const s = eco()
  const c = changed(s, pts({ KEF_ON_STS: 'On', KEF_TRIP_STS: 'Off' }), pts({ KEF_ON_STS: 'On', KEF_TRIP_STS: 'On' }))
  assert.deepStrictEqual(c.map(x => [x.from, x.to]), [[hex(FAN_ON), hex(FAN_FAULT)]], 'only the fan blades')
  assert.ok(!spins(s, pts({ KEF_ON_STS: 'Off', KEF_TRIP_STS: 'On' })))
  s.dispose()
})

test("ECO: FIN's own alarm labels count for the UV lamps and the fan trip", () => {
  const r = M.readEcoPoints(pts({ '1ST_STAGE_UV_ALARM': 'Alarm', '2ND_STAGE_UV_ALARM': 'Normal', KEF_TRIP_STS: 'Trip' }))
  assert.deepStrictEqual([r.uv1Alarm, r.uv2Alarm, r.kefTripped], [true, false, true])
  assert.deepStrictEqual([r.uv1, r.uv2, r.kefTrip], ['Alarm', 'Normal', 'Trip'])
  assert.strictEqual(M.readEcoPoints([]).uv1Alarm, null)
})

test('ECO: each filter point colours only its own frame; ALL_FILTER_ALARM is not mapped onto a filter', () => {
  const s = eco()
  const base = { PRE_FILTER: 'Off', BAG_FILTER: 'Off', BOX_FILTER: 'Off', KEF_ON_STS: 'On' }
  for (const f of ['PRE_FILTER', 'BAG_FILTER', 'BOX_FILTER']) {
    assert.deepStrictEqual(changed(s, pts(base), pts({ ...base, [f]: 'On' })).map(x => x.to), [hex(FILTER_DIRTY)], f)
  }
  assert.deepStrictEqual(changed(s, pts(base), pts({ ...base, ALL_FILTER_ALARM: 'On' })), [])
  s.dispose()
})

console.log(`\n${passed} HVAC schematic tests passed` + (failed ? `, ${failed} FAILED` : ''))
if (failed) process.exit(1)
