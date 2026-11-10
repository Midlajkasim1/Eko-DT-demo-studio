import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The EKO Hospital Live Twin's equipment, floor, point and alarm mapping (static/dashboard/js/layouts/hospital-twin-map.js), audited against the saved FIN
// exports in spec/fixtures/eko-hospital: equipment.json (primary), history-points.json and alarms.json. The exports are a snapshot of 6 Nov 2026: these tests
// prove the mapping agrees with them, not that FIN is reachable or still says the same.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const load = (p, win) => { const m = { exports: {} }; new Function('module', 'window', read(p))(m, win); return m.exports }
const MAP_JS = 'static/dashboard/js/layouts/hospital-twin-map.js'
const M = load(MAP_JS)
const T = load('static/dashboard/js/layouts/hospital-twin.js')
const EQ = JSON.parse(read('spec/fixtures/eko-hospital/equipment.json')).equipment
const HIST = JSON.parse(read('spec/fixtures/eko-hospital/history-points.json')).points
const ALARMS = JSON.parse(read('spec/fixtures/eko-hospital/alarms.json')).alarms
const byName = Object.fromEntries(EQ.map(e => [e.name, e]))
const drawn = id => T.EQUIP.find(e => e.id === id)
const fin = T.EQUIP.filter(e => !e.nonFin)

/* the equipment export as data-map.js turns it into E.data.assets (id = FIN navName); nothing added */
const feed = (list = EQ) => list.map(e => ({ id: e.name, finId: e.finId, bimId: e.bimId, floor: e.floor, tags: e.tags, typeEn: String(e.type).toUpperCase(), st: 'ok', points: e.points }))
/* the alarm export as data-map.js mapAlarm keeps it */
const dashAlarms = () => ALARMS.map(a => ({ id: a.id, sourceId: a.source_id, state: a.state, plainEn: a.message, sev: a.severity }))
const resolveAll = (assets, connected = true) => { const idx = M.index(assets); return Object.fromEntries(T.EQUIP.map(e => [e.id, M.resolve(e, idx, connected)])) }

test('equipment: 63 of the 69 FIN items mapped, each to one exported equipment whose FIN id, type tag and floor all agree', () => {
  const mapped = fin.filter(e => M.finName(e))
  assert.equal(T.EQUIP.length, 72)
  assert.equal(mapped.length, 63)
  const names = mapped.map(e => M.finName(e))
  assert.equal(new Set(names).size, names.length, 'no FIN equipment is used twice')
  for (const e of mapped) {
    const x = byName[M.finName(e)], r = M.REF[M.finName(e)]
    assert.ok(x, e.id + ' is in the equipment export')
    assert.equal(r.id, x.finId, e.id + ' FIN id')
    if (x.tags.length) assert.ok(x.tags.includes(M.TYPE_TAG[e.type]), `${e.id}: FIN tags [${x.tags}] carry ${M.TYPE_TAG[e.type]}`)
    else assert.equal(x.type, 'other', e.id + ': only the untagged medical devices skip the type check')
    assert.equal(x.floor, M.LEVELS[e.level], e.id + ' floor')
  }
})

/* the V1 id SP_01 is pinned to FIN's SUMP_PUMP; V2 draws it as SUMP_PUMP */
const drawnOrAlias = id => drawn(id === 'SP_01' ? 'SUMP_PUMP' : id)

test('pins: each pinned FIN name is the only exported equipment with that type tag on that floor', () => {
  assert.deepEqual(Object.keys(M.PIN).sort(), ['CHILLED_WATER_PUMP_01', 'CONDENSER_WATER_PUMP_01', 'DB_01', 'MCC_01', 'SMDB_01', 'SP_01'])
  const need = { CHILLED_WATER_PUMP_01: 'chilled', CONDENSER_WATER_PUMP_01: 'condenser', SP_01: 'sump', SMDB_01: 'smdb', MCC_01: 'mcc', DB_01: 'db' }
  for (const [id, name] of Object.entries(M.PIN)) {
    const e = drawnOrAlias(id), floor = M.LEVELS[e.level]
    const fits = EQ.filter(x => x.floor === floor && x.tags.includes(M.TYPE_TAG[e.type]) && x.tags.includes(need[id]))
    assert.deepEqual(fits.map(x => x.name), [name], id)
  }
})

test('provisional pins: SMDB_01, MCC_01 and DB_01 resolve to FIN SMDB_GF, MCC_GF and DB_GF, are flagged provisional, and invent no point, value or BIM id', () => {
  assert.deepEqual(M.PROVISIONAL, { SMDB_01: 'SMDB_GF', MCC_01: 'MCC_GF', DB_01: 'DB_GF' })
  for (const id of Object.keys(M.PROVISIONAL)) assert.equal(M.PROVISIONAL[id], M.PIN[id], id + ' provisional agrees with its pin')
  const idx = M.index(feed())
  for (const [id, name] of Object.entries(M.PROVISIONAL)) {
    const r = M.resolve(drawnOrAlias(id), idx, true), x = byName[name]
    assert.equal(r.state, 'mapped', id)
    assert.equal(r.provisional, true, id)
    assert.equal(r.fin, name, id); assert.equal(r.finId, x.finId, id)
    assert.equal(r.bimId, null, id + ': FIN gives only its own record id, never a GlobalId')
    assert.deepEqual(r.expected.map(p => p.name), x.points.map(p => p.navName), id + ': expected points are exactly the exported ones')
  }
  assert.deepEqual(M.REF.MCC_GF.points, []); assert.deepEqual(M.REF.DB_GF.points, [])
  /* a confirmed pin is not flagged */
  assert.equal(M.resolve(drawn('SUMP_PUMP'), idx, true).provisional, false)
})

test('provisional pins: unavailable data is stated, never filled in (FIN offline, equipment missing from the feed, a different type under the name)', () => {
  const off = M.resolve(drawn('MCC_01'), M.index([]), false)
  assert.equal(off.state, 'offline'); assert.equal(off.provisional, true)
  const gone = M.resolve(drawn('DB_01'), M.index(feed(EQ.filter(x => x.name !== 'DB_GF'))), true)
  assert.equal(gone.state, 'missing'); assert.equal(gone.reason, 'not-in-feed')
  const wrong = M.resolve(drawn('MCC_01'), M.index(feed(EQ.map(x => x.name === 'MCC_GF' ? { ...x, tags: ['elecPanel', 'smdb'] } : x))), true)
  assert.equal(wrong.state, 'ambiguous'); assert.equal(wrong.reason, 'type-differs')
  assert.deepEqual(M.pointRows(M.resolve(drawn('MCC_01'), M.index(feed()), true), true), [], 'no points in FIN means no rows, not invented ones')
  /* a feed that gives the board a point it does not have in the export shows exactly that point */
  const withPt = feed().map(a => a.id === 'MCC_GF' ? { ...a, points: [{ navName: 'Incomer_ON_OFF_Status', currentValue: 'On', bool: true, text: 'ON', kind: 'Bool', pointKind: 'Bool', status: 'ok', reporting: true }] } : a)
  assert.deepEqual(M.pointRows(M.resolve(drawn('MCC_01'), M.index(withPt), true), true).map(r => r.name), ['Incomer_ON_OFF_Status'])
})

test('unmapped: the six V2 boards FIN does not list (no FIN id, type or floor, nothing in the history export); the three context items are not FIN', () => {
  const un = fin.filter(e => !M.finName(e)).map(e => e.id).sort()
  assert.deepEqual(un, ['DB_02', 'DB_03', 'MCC_02', 'MCC_03', 'MCC_04', 'SMDB_04'])
  for (const id of un) {
    assert.ok(!byName[id], id + ' is not in the equipment export')
    assert.ok(!HIST.some(p => p.equip === 'HOSPITAL ' + id), id + ' is not named by the history export')
    const r = M.resolve(drawn(id), M.index(feed()), true)
    assert.deepEqual([r.state, r.reason, r.candidate, r.finId], ['unmapped', 'no-evidence', null, null])
  }
  assert.deepEqual(T.EQUIP.filter(e => e.nonFin).map(e => e.id).sort(), ['DEWA_SUPPLY', 'GENERATOR', 'WEATHER'])
})

test('the exported equipment the twin does not draw: only PMU_Main (its readings show on the MDB panel)', () => {
  const used = new Set(fin.map(e => M.finName(e)).filter(Boolean))
  const rest = EQ.filter(e => !used.has(e.name))
  assert.deepEqual(rest.map(e => e.name), ['PMU_Main'])
  assert.equal(rest[0].points.length, 6)
})

test('against the exported feed: all 63 mapped, with the export\'s FIN ids, types and floors; nothing ambiguous', () => {
  const r = resolveAll(feed())
  const by = {}
  for (const x of Object.values(r)) (by[x.state] ||= []).push(x.id)
  assert.deepEqual([by.mapped.length, by.unmapped.length, by['not-fin'].length, by.ambiguous, by.missing], [63, 6, 3, undefined, undefined])
  assert.equal(r.CHILLED_WATER_PUMP_01.asset.id, 'CHILLED_WATER_PUMP')
  assert.equal(r.SUMP_PUMP.finId, 'p:ekoHospital:r:3264826b-af1f8966')
  assert.equal(r.AHU_01.type, 'AHU')
  assert.ok(Object.values(r).every(x => !x.floorDiffers))
})

test('missing, duplicate, a FIN id or type that disagrees, stale and offline are their own states', () => {
  const all = feed()
  assert.deepEqual([M.resolve(drawn('AHU_01'), M.index(all.filter(a => a.id !== 'AHU_01')), true)].map(r => [r.state, r.reason]), [['missing', 'not-in-feed']])
  const dup = all.concat({ ...all.find(a => a.id === 'AHU_01'), id: 'ahu-01' })
  assert.deepEqual([M.resolve(drawn('AHU_01'), M.index(dup), true)].map(r => [r.state, r.reason]), [['ambiguous', 'duplicate']])
  const otherId = all.map(a => a.id === 'AHU_01' ? { ...a, finId: 'p:ekoHospital:r:00000000-00000000' } : a)
  const r1 = M.resolve(drawn('AHU_01'), M.index(otherId), true)
  assert.deepEqual([r1.state, r1.reason, r1.asset], ['ambiguous', 'id-differs', null])
  const atId = all.map(a => a.id === 'AHU_01' ? { ...a, finId: '@' + a.finId } : a)
  assert.equal(M.resolve(drawn('AHU_01'), M.index(atId), true).state, 'mapped', 'a leading @ is the same id')
  const otherType = all.map(a => a.id === 'AHU_01' ? { ...a, tags: ['fcu', 'hvac'] } : a)
  assert.deepEqual([M.resolve(drawn('AHU_01'), M.index(otherType), true)].map(r => [r.state, r.reason]), [['ambiguous', 'type-differs']])
  assert.equal(M.resolve(drawn('AHU_01'), M.index(all.map(a => ({ ...a, st: 'stale' }))), true).state, 'stale')
  assert.equal(M.resolve(drawn('AHU_01'), M.index(all), false).state, 'offline')
  const moved = all.map(a => a.id === 'AHU_01' ? { ...a, floor: 'LEVEL-02' } : a)
  assert.equal(M.resolve(drawn('AHU_01'), M.index(moved), true).floorDiffers, true)
})

test('no duplicate FIN ids or names in the export; the one shared BIM id is flagged, a FIN id is never taken for a BIM id', () => {
  assert.equal(new Set(EQ.map(e => e.finId)).size, EQ.length)
  assert.equal(new Set(EQ.map(e => e.name)).size, EQ.length)
  const r = resolveAll(feed())
  assert.equal(r.VAV_07.bimId, '3K5$E6kNGqVKt9RN46SB4E', 'Zinc\'s \\$ escape is read as $')
  assert.ok(r.VAV_07.bimShared && r.VAV_10.bimShared, 'VAV_07 and VAV_10 carry the same BIM id in FIN')
  assert.equal(r.AHU_01.bimId, '2wLf9$IGsICFYFjFAcUnf2')
  assert.equal(r.CHILLER_01.bimId, '3m5IrqWH1JDH7hfYYN8kjc')
  assert.equal(M.resolve({ id: 'PMU_Main', type: 'PMU', level: 'L1' }, M.index(feed()), true).bimId, null, 'the feed sent the FIN id: no BIM id')
  const withBim = Object.values(r).filter(x => x.bimId).length, without = Object.values(r).filter(x => x.state === 'mapped' && !x.bimId).length
  assert.deepEqual([withBim, without], [42, 21])
})

test('points: the reference table is the equipment export, point for point, with kind, unit, history, alarm and setpoint flags and enums', () => {
  let n = 0
  for (const [name, ref] of Object.entries(M.REF)) {
    const x = byName[name]
    assert.deepEqual(M.refPoints(name).map(p => [p.name, p.unit, p.kind, p.his, p.alarm, p.sp, p.enumText]),
      x.points.map(p => [p.navName, p.unit || '', p.pointKind, p.his === true, p.alarmPoint === true, p.sp === true, typeof p.enum === 'string' ? p.enum : null]), name)
    assert.deepEqual([ref.floor, ref.type, ref.tags], [x.floor, x.type, x.tags], name)
    n += x.points.length
  }
  assert.equal(n, 557)
})

test('history: every historised point of a mapped equipment is a point of it in the equipment export, flagged historised', () => {
  for (const p of HIST) {
    const name = p.equip.replace(/^HOSPITAL /, '')
    if (!M.REF[name]) continue
    const q = M.refPoints(name).find(x => x.name === p.navName)
    assert.ok(q, name + ' ' + p.navName)
    assert.equal(q.his, true, name + ' ' + p.navName + ' historised')
  }
  // and the history export is not the point list: most live points are not historised
  const notHis = Object.keys(M.REF).flatMap(n => M.refPoints(n).filter(p => !p.his)).length
  assert.ok(notHis > 400, notHis + ' live points are not in the history export')
})

test('point reading: bool from the bool field, numbers by FIN\'s pointKind, text and enum words as FIN sends them, every gap a state', () => {
  const rd = (eq, n) => M.readPoint(byName[eq].points.find(p => p.navName === n), { connected: true })
  const pick = r => [r.state, r.type, r.value, r.text, r.unit]
  assert.deepEqual(pick(rd('CHILLER_01', 'RunStatus')), ['live', 'bool', true, null, ''])
  assert.deepEqual(pick(rd('CHILLER_01', 'AlarmStatus')), ['live', 'bool', false, 'Normal', ''])
  assert.deepEqual(pick(rd('CHILLER_01', 'CHWSTemp')), ['live', 'number', 6.9, '6.9', '°C'])
  assert.deepEqual(pick(rd('AHU_01', 'RA CO2 Sp')), ['live', 'number', 800, '800', 'ppm'], 'kind Str but FIN pointKind Number: a number')
  assert.deepEqual(pick(rd('WATER_METER_02', 'HourlyWaterConsumption')), ['live', 'number', 2.98, '2.98', 'm³'])
  assert.deepEqual(pick(rd('FCU_03', 'FanSpeed')), ['live', 'text', 'High', 'High', ''])
  assert.equal(rd('FCU_03', 'FanSpeed').enumText, 'Auto,Low,Medium,High')
  assert.deepEqual(pick(rd('FCU_03', 'Overcooling')).slice(0, 3), ['live', 'text', 'Overcooling - Normal'])
  assert.equal(rd('FCU_03', 'Overcooling').alarm, true)
  assert.equal(rd('AHU_02', 'OA Temp').state, 'not-reporting')
  assert.equal(rd('WATER_METER_03', 'HourlyWaterConsumption').state, 'not-reporting', 'no value and status unknown: no data')
  assert.equal(rd('AHU_01', 'SA Temp Sp').sp, true)
  // a status word is never read as a boolean
  assert.deepEqual(['type', 'value'].map(k => M.readPoint({ navName: 'X', currentValue: 'On', pointKind: 'Str', bool: null }, { connected: true })[k]), ['text', 'On'])
  assert.equal(M.readPoint({ navName: 'X', currentValue: '3', status: 'fault' }, { connected: true }).state, 'unavailable')
  assert.equal(M.readPoint({ navName: 'X', currentValue: '3', status: 'stale' }, { connected: true }).state, 'stale')
  assert.equal(M.readPoint({ navName: 'X', currentValue: '3' }, { connected: false }).state, 'offline')
  assert.equal(M.readPoint({ navName: 'X', currentValue: 'abc', pointKind: 'Number' }, { connected: true }).state, 'unavailable')
})

test('point rows: a point FIN lists but the feed lacks is missing, never dropped; the feed\'s extra points follow', () => {
  const ahu = feed().find(a => a.id === 'AHU_01')
  const thin = { ...ahu, points: ahu.points.filter(p => p.navName !== 'SA Temp').concat({ navName: 'NewPoint', currentValue: '1', pointKind: 'Number' }) }
  const rows = M.pointRows(M.resolve(drawn('AHU_01'), M.index([thin]), true), true)
  assert.equal(rows.length, ahu.points.length + 1)
  assert.equal(rows.find(r => r.name === 'SA Temp').state, 'missing')
  assert.equal(rows.find(r => r.name === 'SA Temp').his, true, 'what FIN said of it is kept')
  assert.equal(rows[rows.length - 1].name, 'NewPoint')
})

test('alarms: each open alarm is on one mapped equipment by FIN id, on the alarm point its state names, in fault in the equipment export', () => {
  assert.equal(new Set(ALARMS.map(a => a.id)).size, ALARMS.length, 'no duplicate alarm records')
  const r = resolveAll(feed()), all = dashAlarms()
  const linked = Object.values(r).flatMap(x => M.alarmsFor(x, all).map(a => ({ eq: x.id, ...a })))
  assert.equal(linked.length, ALARMS.length, 'every open alarm, once')
  const point = Object.fromEntries(linked.map(a => [a.eq + ' ' + a.message, a.point]))
  assert.deepEqual(point, {
    'AHU_01 Cooling Coil is Overcooling': 'FD&D_4_Overcooling', 'AHU_01 Sensor Fault': 'FD&D_2_Sensor_Fault', 'AHU_02 Sensor Fault': 'FD&D_2_Sensor_Fault',
    'AHU_03 Sensor Fault': 'FD&D_2_Sensor_Fault', 'FCU_01 Cooling Performance Fault': 'FD&D_1_Cooling_Performance',
    'FCU_03 Cooling Performance Fault': 'FD&D_1_Cooling_Performance', 'FCU_05 Cooling Performance Fault': 'FD&D_1_Cooling_Performance',
    'VAV_02 Airflow Performance': 'FD&D_1_Airflow_Performance', 'VAV_03 Airflow Performance': 'FD&D_1_Airflow_Performance', 'VAV_04 Airflow Performance': 'FD&D_1_Airflow_Performance' })
  for (const a of linked) {
    const p = byName[a.eq].points.find(q => q.navName === a.point)
    assert.deepEqual([p.alarmPoint, p.bool, p.text], [true, true, 'Fault'], a.eq + ' ' + a.point)
  }
  assert.ok(linked.every(a => a.sev === 'info'), 'the severity is FIN\'s, as given')
  // equipment in alarm in the equipment export = equipment with an open alarm
  assert.deepEqual([...new Set(linked.map(a => a.eq))].sort(), EQ.filter(e => e.inAlarm).map(e => e.name).sort())
})

test('alarms: cleared history records are never active; an alarm is never matched by name; an unmapped item has none', () => {
  assert.ok(ALARMS.flatMap(a => a.history).every(h => h.open === false && h.message === 'Return to normal'))
  const r = resolveAll(feed())
  const byNameOnly = [{ id: 'x', sourceId: 'p:ekoHospital:r:not-this', state: 'ahu_FD&D_2_Sensor_Fault', plainEn: 'AHU_01 Sensor Fault', sev: 'info' }]
  assert.deepEqual(M.alarmsFor(r.AHU_01, byNameOnly), [])
  assert.deepEqual(M.alarmsFor(r.GF_ENERGY, dashAlarms()), [])
  assert.equal(M.alarmPointOf('ahu_valSim_FD&D_4_Overcooling', [{ navName: 'Overcooling', alarmPoint: true }, { navName: 'FD&D_4_Overcooling', alarmPoint: true }]), 'FD&D_4_Overcooling')
  assert.equal(M.alarmPointOf('x_D_4_Overcooling', [{ navName: 'FD&D_4_Overcooling', alarmPoint: true }]), null)
  assert.equal(M.alarmPointOf('ahu_RunStatus', [{ navName: 'RunStatus', alarmPoint: false }]), null, 'only alarm points')
})

test('floors: each drawn level is one FIN floor, and every mapped equipment of it reports that floor', () => {
  assert.deepEqual(M.LEVELS, { L1: 'LEVEL-01', L2: 'LEVEL-02', L3: 'LEVEL-03', RF: 'ROOF' })
  assert.deepEqual(Object.fromEntries(Object.entries(M.LEGACY_LEVELS).map(([v1, v2]) => [v1, M.LEVELS[v2]])),
    { GF: 'LEVEL-01', L1: 'LEVEL-02', L2: 'LEVEL-03', RF: 'ROOF' }, 'each V1 key still reaches the FIN floor it always meant')
  assert.deepEqual([...new Set(EQ.map(e => e.floor))].sort(), ['LEVEL-01', 'LEVEL-02', 'LEVEL-03', 'ROOF'])
  const fc = M.floorCheck(Object.values(resolveAll(feed())))
  assert.deepEqual(Object.fromEntries(Object.entries(fc).map(([k, v]) => [k, [v.floors, v.conflict]])), {
    L1: [{ 'LEVEL-01': 26 }, false], L2: [{ 'LEVEL-02': 19 }, false], L3: [{ 'LEVEL-03': 12 }, false], RF: [{ ROOF: 6 }, false] })
  // FIN's own floor tags on the water meters agree: LEVEL-01 is the ground floor
  assert.deepEqual(['WATER_METER_01', 'WATER_METER_02', 'WATER_METER_03'].map(n => [byName[n].floor, byName[n].tags.find(t => /Floor$/.test(t))]),
    [['LEVEL-01', 'groundFloor'], ['LEVEL-02', 'firstFloor'], ['LEVEL-03', 'secondFloor']])
  const moved = feed().map(a => a.id === 'VAV_01' ? { ...a, floor: 'LEVEL-02' } : a)
  assert.equal(M.floorCheck(Object.values(resolveAll(moved))).L1.conflict, true)
})

test('project isolation: the mapping is published only when the project has the Hospital graphics, and is withdrawn otherwise', () => {
  const win = h => ({ document: {}, INJECTED_PROJECT_CONFIG: h === undefined ? undefined : { hospitalHvac: h } })
  const eko = win(true); load(MAP_JS, eko); assert.ok(eko.EKO_TWIN_MAP && eko.EKO_TWIN_MAP.REF.AHU_01)
  for (const h of [false, undefined, 'true', 1]) { const w = win(h); w.EKO_TWIN_MAP = { stale: true }; load(MAP_JS, w); assert.equal(w.EKO_TWIN_MAP, undefined, String(h)) }
  assert.ok(read('static/dashboard/js/app.js').includes("pageId === 'live-twin' && window.EKO_TWIN && window.EKO_TWIN_MAP"))
})
