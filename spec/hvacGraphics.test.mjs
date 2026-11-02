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
      "export { createHvacLabels } from '@/lib/hvacLabels'",
      "export { defaultType } from '@/lib/assetLinks'",
    ].join('\n'),
    resolveDir: src, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': src }, logLevel: 'silent',
})
const L = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
const { THREE, createAhuSchematic, readAhuPoints, createFcuSchematic, readFcuPoints, createHvacLabels, defaultType } = L

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

test('FCU: the filter and the humidity probe are optional parts, so a unit without those points looks as before', () => {
  const s = createFcuSchematic(box(), new THREE.Matrix4(), undefined, { hospitalHvac: true })
  const a = Object.fromEntries(s.anchors.map(x => [x.key, x]))
  assert.equal(a.filter.optional, true)
  assert.equal(a.zoneHum.optional, true)
  for (const k of ['zoneTemp', 'valvePos', 'valveCmd', 'fanSpeed', 'fanRun']) assert.ok(a[k] && !a[k].optional, k)
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
