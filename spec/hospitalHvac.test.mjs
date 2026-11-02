import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Hospital HVAC graphics are an opt-in of the open project (apiSettings.hospitalHvacGraphics). These tests run the real
// schematic, link and settings code on a real THREE scene, with no browser, model or FIN:
//   - which projects have the feature (Eko Hospital on; Marsa, other projects and a project with no setting off),
//   - what the AHU and FCU draw when it is on, and that with it off they draw exactly what they drew before it existed.
// "Before it existed" is the commit the Hospital work started from, read from git and built beside the current code.
// The point lists are made-up inputs that look like the Hospital screenshots, not readings from its FIN project.

const repo = fileURLToPath(new URL('..', import.meta.url))
const src = fileURLToPath(new URL('../src', import.meta.url))
const BASELINE = 'c81ed55'

const baselineSource = path => {
  try { return execFileSync('git', ['show', `${BASELINE}:${path}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null }
}
const baseAhu = baselineSource('src/lib/ahuSchematic.ts')
const baseFcu = baselineSource('src/lib/fcuSchematic.ts')
const haveBaseline = !!(baseAhu && baseFcu)

const contents = [
  "export * as THREE from 'three'",
  "export { createAhuSchematic, readAhuPoints } from '@/lib/ahuSchematic'",
  "export { createFcuSchematic, readFcuPoints } from '@/lib/fcuSchematic'",
  "export { NO_DATA } from '@/lib/hvacGeometry'",
  "export { defaultType, parseLinks, suggest, prepareElements } from '@/lib/assetLinks'",
  "export { hospitalHvacEnabled, isLiveSchematic } from '@/lib/hospitalHvac'",
  "export { dashboardProjectInfo } from '@/lib/finSettings'",
  haveBaseline ? "export { createAhuSchematic as baselineAhu } from 'baseline:ahu'" : '',
  haveBaseline ? "export { createFcuSchematic as baselineFcu } from 'baseline:fcu'" : '',
].join('\n')

const baselinePlugin = {
  name: 'baseline',
  setup(b) {
    b.onResolve({ filter: /^baseline:/ }, a => ({ path: a.path.slice(9), namespace: 'baseline' }))
    b.onLoad({ filter: /.*/, namespace: 'baseline' }, a => ({ contents: a.path === 'ahu' ? baseAhu : baseFcu, loader: 'ts', resolveDir: src }))
  },
}
const out = await build({
  stdin: { contents, resolveDir: src, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': src }, logLevel: 'silent', plugins: [baselinePlugin],
})
const L = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
const {
  THREE, createAhuSchematic, readAhuPoints, createFcuSchematic, NO_DATA, defaultType, parseLinks, suggest, prepareElements,
  hospitalHvacEnabled, isLiveSchematic, dashboardProjectInfo, baselineAhu, baselineFcu,
} = L

// ── the projects ──
const eko = { projectId: 'p-eko', name: 'Eko Hospital', apiSettings: { finProjectName: 'ekoHospital', hospitalHvacGraphics: true } }
const marsa = { projectId: 'p-marsa', name: 'Marsa Al Arab', apiSettings: { finProjectName: 'marsaAlArab', dashboardDemo: true } }
const other = { projectId: 'p-other', name: 'ANC09 Tower', apiSettings: { finProjectName: 'anc09' } }
const noSettings = { projectId: 'p-bare', name: 'Bare project' }

test('feature on: only the project that set it', () => {
  assert.equal(hospitalHvacEnabled(eko), true)
  assert.equal(dashboardProjectInfo(eko).hospitalHvac, true)
})

test('feature off: Marsa, other projects and a project with no setting', () => {
  for (const p of [marsa, other, noSettings]) {
    assert.equal(hospitalHvacEnabled(p), false, p.name)
    assert.equal(dashboardProjectInfo(p).hospitalHvac, false, p.name)
  }
})

test('missing feature configuration is off, never an error', () => {
  for (const p of [undefined, null, {}, { apiSettings: undefined }, { apiSettings: {} }, { apiSettings: { hospitalHvacGraphics: undefined } }]) {
    assert.equal(hospitalHvacEnabled(p), false)
  }
  assert.equal(dashboardProjectInfo({ projectId: 'x', name: 'x' }).hospitalHvac, false)
})

test('only an explicit true turns it on: no truthy look-alike does', () => {
  for (const v of [false, 'true', 1, 'yes', null, {}, []]) assert.equal(hospitalHvacEnabled({ apiSettings: { hospitalHvacGraphics: v } }), false, JSON.stringify(v))
})

test('the setting is the only authority: a name or FIN project never turns it on or off', () => {
  assert.equal(hospitalHvacEnabled({ projectId: 'a', name: 'Eko Hospital', apiSettings: {} }), false, 'named like the Hospital, no setting')
  assert.equal(hospitalHvacEnabled({ projectId: 'b', name: 'Eko Hospital', apiSettings: { finProjectName: 'ekoHospital' } }), false)
  assert.equal(hospitalHvacEnabled({ projectId: 'c', name: 'Marsa Al Arab', apiSettings: { finProjectName: 'marsaAlArab', hospitalHvacGraphics: true } }), true, 'whoever sets it has it')
})

test('switching projects: each project is read on its own, nothing is carried over', () => {
  const seen = [eko, marsa, eko, other, marsa, noSettings, eko].map(hospitalHvacEnabled)
  assert.deepEqual(seen, [true, false, true, false, false, false, true])
})

test('the AHU is live only with the feature on; the types that always were live still are', () => {
  assert.equal(isLiveSchematic('AHU', true), true)
  assert.equal(isLiveSchematic('AHU', false), false, 'AHU keeps its default look elsewhere')
  for (const t of ['FCU', 'MAHU', 'ECO', 'FAHU']) for (const on of [true, false]) assert.equal(isLiveSchematic(t, on), true, `${t} ${on}`)
  for (const t of ['VAV', 'EF', 'PUMP', 'METER', 'LIFT']) for (const on of [true, false]) assert.equal(isLiveSchematic(t, on), false, `${t} ${on}`)
})

// ── equipment links ──
test('typing by the word in the name: off unless the project has the feature', () => {
  const eq = { name: 'HOSPITAL_AHU_01', type: '' }
  assert.equal(defaultType(eq, true), 'AHU')
  assert.equal(defaultType({ name: 'HOSPITAL_FCU_03', type: 'OTHER' }, true), 'FCU')
  assert.equal(defaultType(eq), 'HOSPITAL', 'off by default: the first letters, as before')
  assert.equal(defaultType(eq, false), 'HOSPITAL')
  assert.equal(defaultType({ name: 'L1_FCU_02', type: 'OTHER' }), 'L')
})

test('typing by name never overrides the prefix, FIN\'s own type or a meter, with the feature on or off', () => {
  for (const on of [true, false]) {
    assert.equal(defaultType({ name: 'AHU-L3-01' }, on), 'AHU')
    assert.equal(defaultType({ name: 'FCU-GF-01' }, on), 'FCU')
    assert.equal(defaultType({ name: 'MAHU-ANC09-BF-01' }, on), 'MAHU')
    assert.equal(defaultType({ name: 'HOSPITAL_AHU_01', type: 'ahu' }, on), 'AHU')
    assert.equal(defaultType({ name: 'PMU03_MAHU_FEED', type: 'meter' }, on), 'METER')
  }
  assert.equal(defaultType({ name: 'PMU03_MAHU_FEED' }, true), 'PMU')
})

test('importing links: an untyped Hospital row is typed by its name only with the feature on; a typed or saved link is never changed', () => {
  const guid = 'abcdefghijklmnopqrstuv'
  const csv = `equip,guid,type\nHOSPITAL_AHU_01,${guid},\nAHU-L3-01,${guid},\nFCU-GF-01,${guid},VAV\n`
  assert.deepEqual(parseLinks(csv, true).links.map(l => l.type), ['AHU', 'AHU', 'VAV'])
  assert.deepEqual(parseLinks(csv).links.map(l => l.type), ['HOSPITAL', 'AHU', 'VAV'], 'off: as before')
  const saved = JSON.stringify([{ equip: 'HOSPITAL_AHU_01', guid, type: 'CUSTOM' }])
  for (const on of [true, false]) assert.equal(parseLinks(saved, on).links[0].type, 'CUSTOM')
})

test('suggestions: the name word only steers them with the feature on', () => {
  const el = (name, guid) => ({ guid, name, objectType: name, tag: '', category: 'Mechanical Equipment', modelName: 'm' })
  const prepared = prepareElements([el('AHU 01', 'aaaaaaaaaaaaaaaaaaaaaa'), el('Chiller 01', 'bbbbbbbbbbbbbbbbbbbbbb')])
  const eq = { name: 'HOSPITAL_AHU_01', type: '' }
  const on = suggest(eq, prepared, 3, 0.1, true)
  const off = suggest(eq, prepared, 3, 0.1)
  assert.equal(on[0].guid, 'aaaaaaaaaaaaaaaaaaaaaa')
  assert.deepEqual(suggest(eq, prepared, 3, 0.1, false), off)
  assert.ok(on[0].score >= off[0].score, 'the type word can only add to the match')
})

// ── what the graphics draw ──
const pts = obj => Object.entries(obj).map(([navName, currentValue]) => ({ navName, currentValue }))
const box = () => new THREE.Box3(new THREE.Vector3(-3, -0.6, -0.8), new THREE.Vector3(3, 0.6, 0.8))
const ahuPoints = pts({ RA_TEMP: '23.4', RA_HUMIDITY: '50.1', RA_CO2: '586.64', SA_TEMP: '16', SA_HUMIDITY: '95', SA_PRESSURE: '259.93', PREFILTER: 'Clean', BAGFILTER: 'Clean', SA_FAN_STATUS: 'On' })
const fcuPoints = pts({ ZONETEMP: '21.2', ZONETEMPSP: '20.5', ZONEHUMIDITY: '53.5', FILTER: 'Clean', FANSPEED: 'Medium', FANRUNSTATUS: 'On', COOLINGDEMAND: '52.63' })

const colours = s => {
  const out = []
  s.group.traverse(o => { for (const m of [].concat(o.material ?? [])) if (m.color) out.push(m.color.getHex()) })
  return out
}
const AHU_SENSORS = ['raHum', 'raCo2', 'raTemp', 'saHum', 'saPressure', 'saTemp']
const AHU_BASE = ['faDamperPos', 'preFilter', 'bagFilter', 'coolingValveCmd', 'sfFanStatus']
const FCU_BASE = ['zoneTemp', 'valvePos', 'valveCmd', 'fanSpeed', 'fanRun']

test('Hospital AHU (feature on): the five parts plus six optional sensor labels, no-data grey for what FIN does not send', () => {
  const s = createAhuSchematic(box(), new THREE.Matrix4(), undefined, { hospitalHvac: true })
  assert.deepEqual(s.anchors.map(a => a.key), [...AHU_BASE, ...AHU_SENSORS])
  for (const a of s.anchors) assert.equal(!!a.optional, AHU_SENSORS.includes(a.key), a.key)
  assert.ok(colours(s).includes(NO_DATA.getHex()), 'nothing read yet: grey, not an assumed clean/off')
  assert.equal(s.apply(ahuPoints).sfFanStatus, 'On')
  assert.equal(s.apply(ahuPoints).raTemp, '23.4 °C')
  assert.equal(s.apply([]).sfFanStatus, '—')
  assert.equal(readAhuPoints([]).sfFanOn, null)
  s.dispose()
})

test('Hospital FCU (feature on): filter and humidity probe are built, optional, and shown only while FIN sends the point', () => {
  const s = createFcuSchematic(box(), new THREE.Matrix4(), undefined, { hospitalHvac: true })
  const a = Object.fromEntries(s.anchors.map(x => [x.key, x]))
  assert.deepEqual(s.anchors.map(x => x.key), [...FCU_BASE, 'filter', 'zoneHum'])
  assert.equal(a.filter.optional, true)
  assert.equal(a.zoneHum.optional, true)
  const filterPart = s.group.getObjectByName('ekoFcuFilter')
  const humPart = s.group.getObjectByName('ekoFcuZoneHum')
  assert.ok(filterPart && humPart)
  s.apply([])
  assert.deepEqual([filterPart.visible, humPart.visible], [false, false])
  assert.equal(s.apply(fcuPoints).filter, 'Clean')
  assert.deepEqual([filterPart.visible, humPart.visible], [true, true])
  s.dispose()
})

test('AHU, feature off: no sensor labels, and the clean/off look it always had', () => {
  const s = createAhuSchematic(box(), new THREE.Matrix4(), undefined, { hospitalHvac: false })
  assert.deepEqual(s.anchors.map(a => a.key), AHU_BASE)
  assert.ok(!colours(s).includes(NO_DATA.getHex()), 'no grey anywhere')
  s.apply(ahuPoints)
  assert.ok(!colours(s).includes(NO_DATA.getHex()))
  s.apply([])
  assert.ok(!colours(s).includes(NO_DATA.getHex()))
  s.dispose()
})

test('FCU, feature off: no filter, no humidity probe, no labels for them, whatever FIN sends', () => {
  const s = createFcuSchematic(box(), new THREE.Matrix4(), undefined, { hospitalHvac: false })
  assert.deepEqual(s.anchors.map(x => x.key), FCU_BASE)
  assert.equal(s.group.getObjectByName('ekoFcuFilter'), undefined)
  assert.equal(s.group.getObjectByName('ekoFcuZoneHum'), undefined)
  s.apply(fcuPoints)
  assert.equal(s.group.getObjectByName('ekoFcuFilter'), undefined)
  s.dispose()
})

test('no option at all is the feature off: a caller that knows nothing about it gets the old graphics', () => {
  assert.deepEqual(createAhuSchematic(box(), new THREE.Matrix4()).anchors.map(a => a.key), AHU_BASE)
  assert.deepEqual(createFcuSchematic(box(), new THREE.Matrix4()).anchors.map(a => a.key), FCU_BASE)
  assert.deepEqual(createAhuSchematic(box(), new THREE.Matrix4(), undefined, {}).anchors.map(a => a.key), AHU_BASE)
})

// ── feature off is what the code drew before the Hospital work, compared mesh for mesh ──
const r5 = n => Math.round(n * 1e5) / 1e5
function snapshot(s) {
  s.group.updateMatrixWorld(true)
  const rows = []
  s.group.traverse(o => {
    const row = { type: o.type, name: o.name, visible: o.visible, m: o.matrixWorld.elements.map(r5) }
    if (o.geometry) {
      o.geometry.computeBoundingBox()
      row.geom = [o.geometry.type, o.geometry.attributes.position?.count, ...o.geometry.boundingBox.min.toArray().map(r5), ...o.geometry.boundingBox.max.toArray().map(r5)]
    }
    row.colours = [].concat(o.material ?? []).map(m => m.color?.getHex())
    rows.push(row)
  })
  return { rows, anchors: s.anchors.map(a => [a.key, a.title, a.side, ...a.position.toArray().map(r5)]) }
}
const skipBaseline = haveBaseline ? false : `baseline ${BASELINE} is not in this checkout`

test('AHU, feature off, matches the baseline AHU mesh for mesh: as built and after a reading', { skip: skipBaseline }, () => {
  const now = createAhuSchematic(box(), new THREE.Matrix4(), undefined, { hospitalHvac: false })
  const was = baselineAhu(box(), new THREE.Matrix4())
  assert.deepEqual(snapshot(now), snapshot(was), 'as built')
  now.apply(ahuPoints); was.apply(ahuPoints)
  assert.deepEqual(snapshot(now), snapshot(was), 'after the Hospital points')
  now.apply([]); was.apply([])
  assert.deepEqual(snapshot(now), snapshot(was), 'after no points')
  now.dispose(); was.dispose()
})

test('FCU, feature off, matches the baseline FCU mesh for mesh: as built and after a reading', { skip: skipBaseline }, () => {
  const now = createFcuSchematic(box(), new THREE.Matrix4(), undefined, { hospitalHvac: false })
  const was = baselineFcu(box(), new THREE.Matrix4())
  assert.deepEqual(snapshot(now), snapshot(was), 'as built')
  now.apply(fcuPoints); was.apply(fcuPoints)
  assert.deepEqual(snapshot(now), snapshot(was), 'after the Hospital points')
  now.apply([]); was.apply([])
  assert.deepEqual(snapshot(now), snapshot(was), 'after no points')
  now.dispose(); was.dispose()
})

test('the baseline comparison can fail: the feature on is different from the baseline', { skip: skipBaseline }, () => {
  const on = createAhuSchematic(box(), new THREE.Matrix4(), undefined, { hospitalHvac: true })
  const was = baselineAhu(box(), new THREE.Matrix4())
  assert.notDeepEqual(snapshot(on), snapshot(was))
  const fcuOn = createFcuSchematic(box(), new THREE.Matrix4(), undefined, { hospitalHvac: true })
  assert.notDeepEqual(snapshot(fcuOn), snapshot(baselineFcu(box(), new THREE.Matrix4())))
})
