import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// The AHU and FCU graphics and their point labels, run on a real THREE scene with no browser, model or FIN.
// The point lists below are test inputs made to look like the Eko Hospital screenshots (HOSPITAL_AHU_01, HOSPITAL_FCU_03).
// They are NOT readings from the Hospital's FIN project, which was not reachable: they prove how names are matched.

const src = fileURLToPath(new URL('../src', import.meta.url))
const out = await build({
  stdin: {
    contents: [
      "export * as THREE from 'three'",
      "export { createAhuSchematic, readAhuPoints } from '@/lib/ahuSchematic'",
      "export { createFcuSchematic, readFcuPoints } from '@/lib/fcuSchematic'",
      "export { readEkoAhuPoints, createEkoAhuSchematic } from '@/lib/ekoAhuSchematic'",
      "export { readEkoFahuPoints, createEkoFahuSchematic } from '@/lib/ekoFahuSchematic'",
      "export { createHvacLabels } from '@/lib/hvacLabels'",
      "export { defaultType } from '@/lib/assetLinks'",
    ].join('\n'),
    resolveDir: src, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': src }, logLevel: 'silent',
})
const L = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
const { THREE, createAhuSchematic, readAhuPoints, createFcuSchematic, readFcuPoints, createHvacLabels, defaultType,
  readEkoAhuPoints, createEkoAhuSchematic, readEkoFahuPoints, createEkoFahuSchematic } = L

const pts = obj => Object.entries(obj).map(([navName, currentValue]) => ({ navName, currentValue }))
const box = () => new THREE.Box3(new THREE.Vector3(-3, -0.6, -0.8), new THREE.Vector3(3, 0.6, 0.8))

// ── which graphic a Hospital unit gets (name typing is the Hospital feature's: spec/hospitalHvac.test.mjs shows it off elsewhere) ──
test('HOSPITAL_AHU_01 and HOSPITAL_FCU_03 are typed AHU and FCU when FIN gives no type of its own', () => {
  assert.equal(defaultType({ name: 'HOSPITAL_AHU_01' }, true), 'AHU')
  assert.equal(defaultType({ name: 'HOSPITAL_FCU_03', type: 'OTHER' }, true), 'FCU')
  assert.equal(defaultType({ name: 'HOSPITAL AHU_01', type: '' }, true), 'AHU')
})

test('typing by name changes nothing for the names that already worked, and FIN\'s own type still wins', () => {
  assert.equal(defaultType({ name: 'AHU-L3-01' }, true), 'AHU')
  assert.equal(defaultType({ name: 'FCU-GF-01' }, true), 'FCU')
  assert.equal(defaultType({ name: 'MAHU-ANC09-BF-01' }, true), 'MAHU')
  assert.equal(defaultType({ name: 'HOSPITAL_AHU_01', type: 'ahu' }, true), 'AHU')
  assert.equal(defaultType({ name: 'PMU03_MAHU_FEED', type: 'meter' }, true), 'METER', 'a meter named after an MAHU is not an MAHU')
  assert.equal(defaultType({ name: 'PMU03_MAHU_FEED' }, true), 'PMU', 'and without a FIN type too')
  assert.equal(defaultType({ name: 'HOSPITAL_LOBBY' }, true), 'HOSPITAL', 'no type word: left as before')
})

// ── AHU ──
const ahuHospital = pts({
  RA_TEMP: '23.4', RA_HUMIDITY: '50.1', RA_CO2: '586.64', SA_TEMP: '16', SA_HUMIDITY: '95', SA_PRESSURE: '259.93',
  PREFILTER: 'Clean', BAGFILTER: 'Clean', SA_FAN_STATUS: 'On',
})

test('AHU: a point FIN did not send is "—" and unknown, never an assumed Off or Clean', () => {
  const r = readAhuPoints([])
  assert.equal(r.sfFanOn, null)
  assert.equal(r.sfFanStatus, '—')
  assert.equal(r.preFilterDirty, null)
  assert.equal(r.preFilter, '—')
  assert.equal(r.bagFilter, '—')
  for (const k of ['raTemp', 'raHum', 'raCo2', 'saTemp', 'saHum', 'saPressure', 'faDamperPos', 'coolingValveCmd']) assert.equal(r[k], '—', k)
})

test('AHU: the points the existing mapping already knows read through for the Hospital unit', () => {
  const r = readAhuPoints(ahuHospital)
  assert.deepEqual(
    [r.raTemp, r.raHum, r.raCo2, r.saTemp, r.saHum, r.saPressure, r.preFilter, r.bagFilter, r.sfFanStatus],
    ['23.4 °C', '50.1 %RH', '586.6 ppm', '16 °C', '95 %RH', '259.9 Pa', 'Clean', 'Clean', 'On'])
  assert.equal(r.sfFanOn, true)
  assert.equal(readAhuPoints(pts({ PREFILTER: 'Dirty', SA_FAN_STATUS: 'Off' })).preFilterDirty, true)
  assert.equal(readAhuPoints(pts({ SA_FAN_STATUS: 'Off' })).sfFanOn, false)
})

test('AHU: the graphic labels the six sensors of the screenshot as well as damper, filters, coil and fan', () => {
  const s = createAhuSchematic(box(), new THREE.Matrix4(), undefined, { hospitalHvac: true })
  const keys = s.anchors.map(a => a.key)
  for (const k of ['faDamperPos', 'preFilter', 'bagFilter', 'coolingValveCmd', 'sfFanStatus', 'raHum', 'raCo2', 'raTemp', 'saHum', 'saPressure', 'saTemp']) assert.ok(keys.includes(k), k)
  const probe = Object.fromEntries(s.anchors.map(a => [a.key, a]))
  assert.equal(probe.raTemp.optional, true, 'a sensor label shows only when FIN reports that point')
  assert.ok(!probe.sfFanStatus.optional, 'the equipment the graphic is built from always has its label')
  assert.equal(s.apply(ahuHospital).sfFanStatus, 'On')
  assert.equal(s.apply([]).sfFanStatus, '—', 'and back to no-data when the points go')
  s.dispose()
})

// ── FCU ──
const fcuHospital = pts({ ZONETEMP: '21.2', ZONETEMPSP: '20.5', ZONEHUMIDITY: '53.5', FILTER: 'Clean', FANSPEED: 'Medium', FANRUNSTATUS: 'On', COOLINGDEMAND: '52.63', OCCUPANCY: 'Occupied' })

test('FCU: zone humidity and filter are read when sent, "—" when not; the zone setpoint is not the zone temperature', () => {
  const r = readFcuPoints(fcuHospital)
  assert.equal(r.zoneTemp, '21.2 °C', 'ZONETEMPSP is the setpoint, not the reading')
  assert.equal(r.zoneHum, '53.5 %RH')
  assert.equal(r.filter, 'Clean')
  assert.equal(r.fanRun, 'On')
  const none = readFcuPoints([])
  assert.deepEqual([none.zoneHum, none.filter, none.filterDirty], ['—', '—', null])
  assert.equal(readFcuPoints(pts({ FILTER: 'Dirty' })).filterDirty, true)
})

test('FCU: the fan spins faster from Low to Medium to High, and stops when it is not running', () => {
  const rate = speed => readFcuPoints(pts({ FANRUNSTATUS: 'On', FANSPEED: speed })).fanRate
  const low = rate('Low'), med = rate('Medium'), high = rate('High')
  assert.ok(low < med && med < high, `${low} < ${med} < ${high}`)
  assert.equal(rate('Auto'), 1.6, 'Auto keeps one rate while the fan is running')
  assert.equal(readFcuPoints(pts({ FANRUNSTATUS: 'Off', FANSPEED: 'High' })).fanRate, 0)
  assert.equal(readFcuPoints(pts({ FAN_SPEED_MODE: 'Low', FAN_RUN_STS: 'On' })).fanRate, low)
  assert.equal(readFcuPoints(pts({ FANSPEED: '40', FANRUNSTATUS: 'On' })).fanSpeed, '40 %')
})

test('FCU: the filter and the humidity probe are optional parts, so a unit without those points looks as before', () => {
  const s = createFcuSchematic(box(), new THREE.Matrix4(), undefined, { hospitalHvac: true })
  const a = Object.fromEntries(s.anchors.map(x => [x.key, x]))
  assert.equal(a.filter.optional, true)
  assert.equal(a.zoneHum.optional, true)
  for (const k of ['zoneTemp', 'valve', 'fanSpeed', 'fanRun']) assert.ok(a[k] && !a[k].optional, k)
  assert.ok(a.valvePos.optional && !a.valveCmd, 'COOLING_VALVE replaces the command label; the position label shows only for its own point')
  const filterPart = s.group.getObjectByName('ekoFcuFilter')
  assert.ok(filterPart, 'the filter is built')
  s.apply([])
  assert.equal(filterPart.visible, false, 'not drawn without a filter point')
  s.apply(fcuHospital)
  assert.equal(filterPart.visible, true, 'drawn once FIN sends one')
  s.dispose()
})

// ── labels ──
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.className = ''; this._text = ''; this.title = ''; this.offsetWidth = 40; this.offsetHeight = 14 }
  get textContent() { return this._text }
  set textContent(v) { this._text = String(v) }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  toggleAttribute(k, force) { if (force) this.attrs[k] = ''; else delete this.attrs[k] }
  append(...n) { this.children.push(...n) }
  appendChild(c) { this.children.push(c); return c }
  remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 600 } }
}

test('labels: an optional anchor with no value is not shown, and appears once its point is sent', () => {
  const host = new El('div')
  const labels = createHvacLabels(() => host, '—', { createElement: t => new El(t) })
  const group = new THREE.Group(); group.updateMatrixWorld(true)
  const at = x => new THREE.Vector3(x, 0, 0)
  labels.show({ group, anchors: [
    { key: 'a', title: 'A', position: at(-2), side: 'above' },
    { key: 'b', title: 'B', position: at(2), side: 'above', optional: true },
  ], apply: () => ({}), tick() {}, dispose() {} }, { a: 'On' })
  const cam = new THREE.PerspectiveCamera(50, 1000 / 600, 0.1, 100)
  cam.position.set(0, 0, 10); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true); cam.updateProjectionMatrix()
  const canvas = { left: 0, top: 0, width: 1000, height: 600 }
  const shown = () => host.children.map(e => e.getAttribute('data-shown'))
  labels.update(cam, canvas)
  assert.deepEqual(shown(), ['1', '0'])
  labels.setReading({ a: 'On', b: 'Clean' })
  labels.update(cam, canvas)
  assert.deepEqual(shown(), ['1', '1'])
})

// ── Eko Hospital dampers and FCU cooling valve ──
// FIN names a damper by its air stream (ExhaustAirDamperPos, FreshAirDamperPos), as the FAHU's Analytics tab lists ExhaustAirDamperPos and
// FreshAirTemp. The abbreviation spellings (EA_DAMPER_POS) keep working. Test inputs, not readings from the Hospital's FIN project.

test('Eko AHU: EA, MA and OA dampers read by their long FIN names and their abbreviations alike, each from its own point', () => {
  const long = readEkoAhuPoints(pts({ ExhaustAirDamperPos: '30', MixedAirDamperPos: '70', OutsideAirDamperPos: '45' }))
  assert.deepEqual([long.eaDamper, long.maDamper, long.oaDamper], ['30 %', '70 %', '45 %'])
  assert.deepEqual([long.eaDamperOpen, long.maDamperOpen, long.oaDamperOpen], [0.3, 0.7, 0.45])
  const abbr = readEkoAhuPoints(pts({ EA_DAMPER_POS: '31', MA_DAMPER_POS: '71', OA_DAMPER_POS: '46' }))
  assert.deepEqual([abbr.eaDamper, abbr.maDamper, abbr.oaDamper], ['31 %', '71 %', '46 %'])
  const fresh = readEkoAhuPoints(pts({ FreshAirDamperPos: '12.5' }))
  assert.equal(fresh.oaDamper, '12.5 %')
  assert.equal(fresh.eaDamper, '—')
})

test('Eko AHU: a damper command, set-point or fault is not the damper position, and a missing one is "—"', () => {
  const r = readEkoAhuPoints(pts({ ExhaustAirDamperCmd: '100', MixedAirDamperPosSP: '50', OutsideAirDamperFault: 'true' }))
  assert.deepEqual([r.eaDamper, r.maDamper, r.oaDamper], ['—', '—', '—'])
  assert.deepEqual([r.eaDamperOpen, r.maDamperOpen, r.oaDamperOpen], [null, null, null])
  const both = readEkoAhuPoints(pts({ ExhaustAirDamperCmd: '100', ExhaustAirDamperPos: '30' }))
  assert.equal(both.eaDamper, '30 %', 'the position, not the command beside it')
})

test('Eko FAHU: FA and EA dampers are separate points, read by long name or abbreviation', () => {
  const r = readEkoFahuPoints(pts({ FreshAirDamperPos: '80', ExhaustAirDamperPos: '30' }))
  assert.deepEqual([r.faDamper, r.eaDamper], ['80 %', '30 %'])
  assert.deepEqual([r.faDamperOpen, r.eaDamperOpen], [0.8, 0.3])
  assert.deepEqual([readEkoFahuPoints(pts({ ExhaustAirDamperPos: '30' })).faDamper, readEkoFahuPoints(pts({ FreshAirDamperPos: '80' })).eaDamper], ['—', '—'],
    'one is never read for the other')
  const abbr = readEkoFahuPoints(pts({ FA_DAMPER_POS: '81', EA_DAMPER_POS: '31' }))
  assert.deepEqual([abbr.faDamper, abbr.eaDamper], ['81 %', '31 %'])
  const cmd = readEkoFahuPoints(pts({ FreshAirDamperCmd: '100', ExhaustAirDamperSP: '10' }))
  assert.deepEqual([cmd.faDamper, cmd.eaDamper], ['—', '—'])
})

test('Eko FAHU and AHU: the damper labels and their drawn blades follow the reading', () => {
  const f = createEkoFahuSchematic(box(), new THREE.Matrix4(), undefined)
  const r = f.apply(pts({ FreshAirDamperPos: '80', ExhaustAirDamperPos: '30' }))
  assert.deepEqual([r.faDamper, r.eaDamper], ['80 %', '30 %'])
  assert.ok(f.anchors.some(a => a.key === 'faDamper' && a.title === 'FA DAMPER'))
  assert.ok(f.anchors.some(a => a.key === 'eaDamper' && a.title === 'EA DAMPER'))
  assert.equal(f.apply([]).eaDamper, '—')
  f.dispose()
  const a = createEkoAhuSchematic(box(), new THREE.Matrix4(), undefined)
  assert.deepEqual(['eaDamper', 'maDamper', 'oaDamper'].map(k => a.apply(pts({ ExhaustAirDamperPos: '30', MixedAirDamperPos: '70', OutsideAirDamperPos: '45' }))[k]), ['30 %', '70 %', '45 %'])
  a.dispose()
})

test('Hospital FCU: COOLING_VALVE shows the FIN cooling valve point (COOLINGVALVE), not a command', () => {
  const r = readFcuPoints(pts({ COOLINGVALVE: '100.00 %', COOLINGDEMAND: '99.02', ZONETEMP: '24.8' }), { hospitalHvac: true })
  assert.equal(r.valve, '100.00 %')
  assert.equal(r.valveOpen, 1, 'the coil colour follows the same point')
  const cmdOnly = readFcuPoints(pts({ COOLING_VALVE_CMD: '60' }), { hospitalHvac: true })
  assert.equal(cmdOnly.valve, '—', 'a command is not the valve position')
  assert.equal(readFcuPoints([], { hospitalHvac: true }).valve, '—')
  assert.equal(readFcuPoints(pts({ COOLING_VALVE_POS: '40' }), { hospitalHvac: true }).valve, '40 %', 'a position point is the valve value too')
})

test('Hospital FCU: the cooling valve label is COOLING_VALVE; a position label shows only for a distinct position point', () => {
  const s = createFcuSchematic(box(), new THREE.Matrix4(), undefined, { hospitalHvac: true })
  const a = Object.fromEntries(s.anchors.map(x => [x.key, x]))
  assert.equal(a.valve.title, 'COOLING_VALVE')
  assert.ok(!a.valve.optional)
  assert.ok(!s.anchors.some(x => x.title === 'COOLING_VALVE_CMD'))
  assert.equal(a.valvePos.optional, true)
  assert.equal(s.apply(pts({ COOLINGVALVE: '100' })).valvePos, '—', 'no separate position point: no second label for the same value')
  assert.equal(s.apply(pts({ COOLINGVALVE: '100', COOLING_VALVE_POS: '90' })).valvePos, '90 %')
  s.dispose()
})

test('FCU without the Hospital feature keeps its COOLING_VALVE_CMD label and reading', () => {
  const s = createFcuSchematic(box(), new THREE.Matrix4(), undefined)
  assert.ok(s.anchors.some(x => x.key === 'valveCmd' && x.title === 'COOLING_VALVE_CMD'))
  assert.ok(!s.anchors.some(x => x.key === 'valve'))
  assert.equal(readFcuPoints(pts({ COOLING_VALVE_CMD: '60' })).valveCmd, '60 %')
  assert.equal(readFcuPoints(pts({ COOLINGVALVE: '100' })).valvePos, '—', 'the baseline mapping is untouched')
  s.dispose()
})

// ── Eko AHU: return-air fan status and mixed-air damper ──
// Test inputs (FIN names by air stream), not readings from the Hospital's FIN project.

test('Eko AHU: RA FAN STATUS reads the return air fan status by its long name, and never its trip, command or speed', () => {
  for (const name of ['ReturnAirFanStatus', 'RA_FAN_STATUS', 'ReturnFanStatus', 'RAFanRunSts']) {
    const r = readEkoAhuPoints(pts({ [name]: 'On' }))
    assert.deepEqual([name, r.raFanStatus, r.raFanOn], [name, 'On', true])
  }
  const off = readEkoAhuPoints(pts({ ReturnAirFanStatus: 'Off' }))
  assert.deepEqual([off.raFanStatus, off.raFanOn], ['Off', false])
  const noise = readEkoAhuPoints(pts({ ReturnAirFanTripStatus: 'On', ReturnAirFanSpeedCmd: '60', ReturnAirFanCmd: 'Start', ReturnAirFanSpeedSP: '50' }))
  assert.deepEqual([noise.raFanStatus, noise.raFanOn], ['—', null], 'a trip, command, speed or set-point is not the run status')
  const both = readEkoAhuPoints(pts({ ReturnAirFanTripStatus: 'Off', ReturnAirFanStatus: 'On' }))
  assert.equal(both.raFanStatus, 'On', 'the status, not the trip beside it')
})

test('Eko AHU: the return and supply fan statuses stay separate points', () => {
  const r = readEkoAhuPoints(pts({ ReturnAirFanStatus: 'On', SupplyFanStatus: 'Off' }))
  assert.deepEqual([r.raFanStatus, r.saFanStatus], ['On', 'Off'])
  assert.deepEqual([readEkoAhuPoints(pts({ ReturnAirFanStatus: 'On' })).saFanStatus, readEkoAhuPoints(pts({ SupplyFanStatus: 'On' })).raFanStatus], ['—', '—'])
})

test('Eko AHU: MA DAMPER reads the mixed air damper position under any of its names, from its own point only', () => {
  for (const name of ['MixedAirDamperPos', 'MixingAirDamperPos', 'MixAirDamperPos', 'MixingBoxDamperPos', 'MA_DAMPER_POS']) {
    const r = readEkoAhuPoints(pts({ [name]: '70.00 %' }))
    assert.deepEqual([name, r.maDamper, r.maDamperOpen], [name, '70.00 %', 0.7])
    assert.deepEqual([r.eaDamper, r.oaDamper], ['—', '—'], 'the mixed air damper is neither the exhaust nor the outside one')
  }
  const cmd = readEkoAhuPoints(pts({ MixAirDamperCmd: '100', MixAirDamperPosSP: '50', MixAirDamperFault: 'true' }))
  assert.deepEqual([cmd.maDamper, cmd.maDamperOpen], ['—', null], 'a command, set-point or fault is not the position')
  assert.equal(readEkoAhuPoints(pts({ MixAirDamperCmd: '100', MixAirDamperPos: '70' })).maDamper, '70 %')
})

test('Eko AHU: EA and OA dampers are unchanged by the MA damper point being there', () => {
  const r = readEkoAhuPoints(pts({ ExhaustAirDamperPos: '30', OutsideAirDamperPos: '45', MixAirDamperPos: '70' }))
  assert.deepEqual([r.eaDamper, r.maDamper, r.oaDamper], ['30 %', '70 %', '45 %'])
  const abbr = readEkoAhuPoints(pts({ EA_DAMPER_POS: '31', OA_DAMPER_POS: '46' }))
  assert.deepEqual([abbr.eaDamper, abbr.maDamper, abbr.oaDamper], ['31 %', '—', '46 %'])
})

test('Eko FAHU: the AHU fan and damper rules did not move into the FAHU', () => {
  const r = readEkoFahuPoints(pts({ ReturnAirFanStatus: 'On', MixAirDamperPos: '70' }))
  assert.deepEqual([r.faDamper, r.eaDamper, r.efStatus, r.sfStatus], ['—', '—', '—', '—'])
})
