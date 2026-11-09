import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The EKO Hospital Live Twin's equipment intelligence (Phase 4, static/dashboard/js/layouts/hospital-twin-map.js): the reference's equipment relationships
// and their upstream / downstream traces, open FIN alarms on drawn equipment, FDD rules, and the root-cause / impact evidence, checked against the saved FIN
// exports in spec/fixtures/eko-hospital (a snapshot of 6 Nov 2026, not proof that FIN is reachable).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const load = (p, win) => { const m = { exports: {} }; new Function('module', 'window', read(p))(m, win); return m.exports }
const M = load('static/dashboard/js/layouts/hospital-twin-map.js')
const T = load('static/dashboard/js/layouts/hospital-twin.js')
const EQ = JSON.parse(read('spec/fixtures/eko-hospital/equipment.json')).equipment
const ALARMS = JSON.parse(read('spec/fixtures/eko-hospital/alarms.json')).alarms
const G = M.graph(T.EQUIP)
const ATS = 'AUTOMATIC_TRANSFER_SWITCH_01'
const level = id => T.EQUIP.find(e => e.id === id).level
const feed = (list = EQ) => list.map(e => ({ id: e.name, finId: e.finId, bimId: e.bimId, floor: e.floor, tags: e.tags, typeEn: String(e.type).toUpperCase(), st: 'ok', points: e.points }))
/* as data-map.js mapAlarm keeps an alarm: FIN's severity word and priority as sent, its earlier records as hist */
const dashAlarms = () => ALARMS.map(a => ({ id: a.id, sourceId: a.source_id, state: a.state, plainEn: a.message, techEn: a.detail, sev: a.severity,
  finSeverity: a.severity, priority: a.priority, locEn: a.source, hist: a.history.map(h => ({ open: h.open })) }))
const resolveAll = (assets, connected = true) => { const idx = M.index(assets); return Object.fromEntries(T.EQUIP.map(e => [e.id, M.resolve(e, idx, connected)])) }
const states = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.state + (v.weak ? '-weak' : '')]))

test('relationships: the reference LINKS on the drawn machines, two kinds, nothing invented, kept apart from the pipes', () => {
  assert.equal(G.links.length, 200)
  const ids = new Set(T.EQUIP.map(e => e.id))
  assert.ok(G.links.every(l => ids.has(l.from) && ids.has(l.to) && l.from !== l.to), 'every link joins two drawn machines')
  assert.deepEqual([...new Set(G.links.map(l => l.kind))].sort(), ['shift', 'stop'])
  assert.ok(G.links.filter(l => l.kind === 'stop').every(l => l.prop), 'a stop always spreads')
  assert.ok(G.links.every(l => typeof l.what === 'string' && l.what), 'each link says what passes, in the reference\'s words')
  const has = (from, to, kind, what) => G.links.some(l => l.from === from && l.to === to && l.kind === kind && l.what === what)
  assert.ok(has('CHILLER_01', 'CHILLED_WATER_PUMP_01', 'stop', 'EnableCmd, AlarmStatus'))
  assert.ok(has('CONDENSER_WATER_PUMP_01', 'COOLING_TOWER_01', 'stop', 'Condenser flow → fan enable'))
  assert.ok(has('AHU_01', 'VAV_03', 'stop', 'Supply air, fan status'))
  assert.ok(has('FAHU_02', 'EXHAUST_FAN_03', 'stop', 'Supply fan status (Auto)'))
  assert.ok(has('FCU_01', 'WATER_METER_01', 'shift', 'Occupancy → water use'))
  assert.ok(!G.links.some(l => l.from === 'AHU_01' && l.to === 'VAV_06'), 'VAV_06 hangs off AHU_02, not AHU_01')
  assert.equal(new Set(G.links.map(l => l.from + '>' + l.to + '>' + l.kind)).size, G.links.length, 'no link twice')
  // the graph is not derived from the pipe geometry: a relationship with no pipe between the two machines
  assert.ok(has('WEATHER', 'COOLING_TOWER_01', 'shift', 'Wet bulb') && !T.PIPES.some(p => p.src === 'WEATHER'))
  assert.deepEqual(G.direct('AHU_01').up.map(l => l.from + ' ' + l.kind), ['SMDB_01 stop', 'CHILLER_01 shift', 'CHILLED_WATER_PUMP_01 shift', 'FAHU_01 shift'])
})

test('downstream: what a machine stopping reaches, as the reference computes it (stop, shift, measurement only)', () => {
  assert.deepEqual(states(G.downstream('AHU_01')), { AHU_01: 'fail', GF_ENERGY: 'warn-weak', CHILLED_WATER_PUMP_01: 'warn-weak',
    VAV_01: 'fail', VAV_02: 'fail', VAV_03: 'fail', VAV_04: 'fail', VAV_05: 'fail' })
  const ch = G.downstream('CHILLER_01')
  assert.equal(ch.CHILLED_WATER_PUMP_01.state, 'fail')
  assert.equal(ch.COOLING_TOWER_01.state, 'fail', 'the tower stops through the condenser pump, a stop beats the direct shift')
  assert.equal(ch.CONDENSER_WATER_PUMP_01.via.from, 'CHILLER_01')
  assert.deepEqual(G.downstream('WEATHER').COOLING_TOWER_01, { state: 'warn', step: 1, via: G.links.find(l => l.from === 'WEATHER' && l.to === 'COOLING_TOWER_01'), weak: true })
  assert.deepEqual(Object.keys(G.downstream('VAV_01')).sort(), ['GF_ENERGY', 'VAV_01'], 'a VAV box only shows on its floor meter')
  assert.strictEqual(G.downstream('AHU_01'), G.downstream('AHU_01'), 'computed once per machine')
})

test('upstream: exactly the machines whose downstream reaches it', () => {
  assert.deepEqual(states(G.upstream('VAV_02')), { DEWA_SUPPLY: 'warn', PMU_Main: 'warn', [ATS]: 'fail', SMDB_01: 'fail', FAHU_01: 'warn', AHU_01: 'fail',
    COOLING_TOWER_01: 'warn', CONDENSER_WATER_PUMP_01: 'warn', CHILLER_01: 'warn', CHILLED_WATER_PUMP_01: 'warn' })
  assert.deepEqual(G.upstream('WEATHER'), {})
  assert.deepEqual(G.upstream('DEWA_SUPPLY'), {})
  for (const a of T.EQUIP) for (const b of T.EQUIP) if (a.id !== b.id) assert.equal(!!G.upstream(b.id)[a.id], !!G.downstream(a.id)[b.id], a.id + ' -> ' + b.id)
})

test('cross-floor: traces leave the floor they start on', () => {
  const ats = G.downstream(ATS)
  assert.equal(Object.keys(ats).length - 1, 49)
  assert.deepEqual(states(ats)[ATS], 'fail')
  assert.deepEqual([...new Set(Object.keys(ats).map(level))].sort(), ['GF', 'L1', 'L2', 'RF'])
  assert.equal(G.downstream('CHILLER_01').FCU_01.state, 'warn', 'the roof chiller reaches a ground-floor FCU')
  assert.equal(level('CHILLER_01'), 'RF'); assert.equal(level('FCU_01'), 'GF')
  assert.ok(G.upstream('FCU_05').CHILLER_01 && level('FCU_05') === 'L2')
})

test('alarms: open FIN alarms by drawn machine, with FIN\'s message, severity, priority, source id and point; none unlinked; nothing by name', () => {
  const idx = M.alarmIndex(resolveAll(feed()), dashAlarms())
  assert.deepEqual(Object.keys(idx.by).sort(), ['AHU_01', 'AHU_02', 'AHU_03', 'FCU_01', 'FCU_03', 'FCU_05', 'VAV_02', 'VAV_03', 'VAV_04'])
  assert.deepEqual(idx.unlinked, [])
  const a = idx.by.AHU_01.find(x => x.message === 'Cooling Coil is Overcooling')
  assert.deepEqual([a.finSeverity, a.priority, a.sourceId, a.point, a.cleared], ['info', 150, 'p:ekoHospital:r:3260b5da-8173162b', 'FD&D_4_Overcooling', 2])
  assert.match(a.detail, /^Overcooling - Possible Faults/)
  // an alarm on FIN equipment the twin does not draw stays listed, unlinked
  const other = { id: 'z', sourceId: 'p:ekoHospital:r:0000', plainEn: 'Door open', locEn: 'HOSPITAL CCTV_01', finSeverity: 'alarm', priority: 7 }
  const idx2 = M.alarmIndex(resolveAll(feed()), [...dashAlarms(), other])
  assert.deepEqual(idx2.unlinked, [{ id: 'z', message: 'Door open', source: 'HOSPITAL CCTV_01', sourceId: 'p:ekoHospital:r:0000', finSeverity: 'alarm', priority: 7 }])
  // no severity is made up: absent in FIN, absent here
  const bare = dashAlarms().map(x => ({ ...x, finSeverity: undefined, priority: undefined }))
  assert.ok(Object.values(M.alarmIndex(resolveAll(feed()), bare).by).flat().every(x => x.finSeverity === null && x.priority === null))
  // FIN offline: no equipment is confirmed in the feed, so no alarm is pinned on one; every open alarm is still listed
  const off = M.alarmIndex(resolveAll(feed(), false), dashAlarms())
  assert.deepEqual([Object.keys(off.by).length, off.unlinked.length], [0, 10])
})

test('alarm status: a "Return to normal" record is never active, open or listed, nor are earlier cleared records', () => {
  assert.equal(M.isActive({ plainEn: 'Return to normal' }), false)
  assert.equal(M.isActive({ plainEn: '  return to NORMAL ' }), false)
  assert.equal(M.isActive({ plainEn: 'Sensor Fault' }), true)
  const rtn = { ...dashAlarms()[0], id: 'rtn', plainEn: 'Return to normal' }
  const idx = M.alarmIndex(resolveAll(feed()), [rtn])
  assert.deepEqual([idx.by, idx.unlinked], [{}, []])
  const all = Object.values(M.alarmIndex(resolveAll(feed()), dashAlarms()).by).flat()
  assert.equal(all.length, 10)
  assert.ok(all.every(a => a.message !== 'Return to normal'))
  assert.equal(all.reduce((n, a) => n + a.cleared, 0), ALARMS.reduce((n, a) => n + a.history.length, 0), 'cleared records are counted, never shown as alarms')
})

test('FDD: a row per FD&D point, fault only from a live true bool, FIN\'s own message or none, missing values unavailable', () => {
  const r = resolveAll(feed()), al = dashAlarms()
  const rows = M.fddRows(r.AHU_01, al, true)
  assert.deepEqual(rows.map(x => [x.name, x.status, x.messageFrom]).sort(), [
    ['FD&D_1_Cooling_Performance', 'normal', null], ['FD&D_2_Sensor_Fault', 'fault', 'alarm'], ['FD&D_3_Fan_Command/Status_Mismatch', 'normal', 'point'],
    ['FD&D_4_Overcooling', 'fault', 'alarm'], ['FD&D_5_CO2_Level_High', 'normal', 'point']])
  assert.match(rows.find(x => x.name === 'FD&D_4_Overcooling').message, /^Overcooling - Possible Faults/)
  assert.equal(rows.find(x => x.name === 'FD&D_5_CO2_Level_High').message, 'CO2 Level High - Normal', 'the text point named as the rule')
  assert.equal(rows.find(x => x.name === 'FD&D_1_Cooling_Performance').message, null, 'no message is written for FIN')
  const fcu = M.fddRows(r.FCU_01, al, true).find(x => x.name === 'FD&D_1_Cooling_Performance')
  assert.deepEqual([fcu.status, fcu.messageFrom, !!fcu.alarm], ['fault', 'alarm', true])
  // the faults in the export are the FD&D points the alarms name
  const faults = T.EQUIP.flatMap(e => M.fddRows(r[e.id], al, true).filter(x => x.status === 'fault').map(x => e.id + ' ' + x.name)).sort()
  assert.equal(faults.length, 10)
  assert.ok(faults.every(f => M.fddRows(r[f.split(' ')[0]], al, true).find(x => x.name === f.slice(f.indexOf(' ') + 1)).alarm))
  // a value FIN lists but the feed lacks, an unreported value, or no FIN connection: unavailable, never normal
  const gone = feed().map(a => a.id === 'AHU_01' ? { ...a, points: a.points.filter(p => p.navName !== 'FD&D_4_Overcooling').map(p => p.navName === 'FD&D_2_Sensor_Fault' ? { ...p, reporting: false } : p) } : a)
  const g = M.fddRows(resolveAll(gone).AHU_01, al, true)
  assert.equal(g.find(x => x.name === 'FD&D_4_Overcooling').status, 'unavailable')
  assert.equal(g.find(x => x.name === 'FD&D_2_Sensor_Fault').status, 'unavailable')
  assert.ok(M.fddRows(resolveAll(feed(), false).AHU_01, al, false).every(x => x.status === 'unavailable'))
  assert.deepEqual(M.fddRows(r.GF_ENERGY, al, true), [], 'an unmapped meter has no FDD')
  assert.deepEqual(M.fddRows(r.WEATHER, al, true), [])
})

test('root cause and impact: four kinds of evidence, never mixed; a possible cause needs its own FIN alarm or FDD fault', () => {
  const r = resolveAll(feed()), al = dashAlarms(), idx = M.alarmIndex(r, al)
  const faults = {}
  for (const e of T.EQUIP) { const f = M.fddRows(r[e.id], al, true).filter(x => x.status === 'fault').map(x => x.name); if (f.length) faults[e.id] = f }
  const v = M.evidence(G, 'VAV_02', r, idx, faults)
  assert.deepEqual(v.alarms.map(a => a.message), ['Airflow Performance'], 'confirmed: its own open FIN alarm')
  assert.deepEqual(v.faults, ['FD&D_1_Airflow_Performance'])
  assert.equal(v.upstream.length, 10, 'reference relationships: everything upstream')
  assert.deepEqual(v.possible.map(u => [u.id, u.state, u.alarms.length, u.faults.length]), [['AHU_01', 'fail', 2, 2]], 'possible cause: only upstream machines with their own FIN evidence')
  assert.deepEqual(v.impacts.map(x => x.id), ['GF_ENERGY'])
  const a = M.evidence(G, 'AHU_01', r, idx, faults)
  assert.deepEqual(a.possible, [], 'nothing upstream of AHU_01 is in alarm')
  assert.deepEqual(a.impacts.filter(x => x.state === 'fail').map(x => x.id), ['VAV_01', 'VAV_02', 'VAV_03', 'VAV_04', 'VAV_05'])
  // no FIN evidence anywhere: nothing confirmed, nothing possible; the relationships stay
  const none = M.evidence(G, 'VAV_02', r, { by: {}, unlinked: [] }, {})
  assert.deepEqual([none.alarms, none.faults, none.possible], [[], [], []])
  assert.equal(none.upstream.length, 10)
  // the evidence has no word for cause, fix or action
  assert.deepEqual(Object.keys(v).sort(), ['alarms', 'faults', 'impacts', 'possible', 'upstream'])
  const view = read('static/dashboard/js/layouts/hospital-twin.js')
  for (const k of ['twinEvAlarm', 'twinEvRel', 'twinEvPossible', 'twinEvImpact']) assert.ok(view.includes("'" + k + "'"), k)
  const en = read('static/dashboard/js/i18n/en.js')
  assert.match(en, /"twinEvPossible": "Possible upstream causes \(not proven\)"/)
  assert.match(en, /"twinEvImpact": "Potential downstream impact \(not observed\)"/)
})

test('no FIN writes and no second connection from the twin; data-map keeps FIN\'s severity word and priority as sent', () => {
  for (const f of ['hospital-twin.js', 'hospital-twin-map.js']) {
    const src = read('static/dashboard/js/layouts/' + f)
    assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|WebSocket|EventSource|pointWrite|invokeAction/, f)
  }
  const dm = read('static/js/data-map.js')
  assert.ok(dm.includes("finSeverity: a.severity ? String(a.severity) : null"))
  assert.ok(dm.includes("priority: typeof a.priority === 'number' ? a.priority : null"))
})

test('project isolation: the twin and its relationships are published only on the Hospital project', () => {
  const win = h => ({ document: {}, INJECTED_PROJECT_CONFIG: h === undefined ? undefined : { hospitalHvac: h } })
  const eko = win(true); load('static/dashboard/js/layouts/hospital-twin-map.js', eko); load('static/dashboard/js/layouts/hospital-twin.js', eko)
  assert.ok(eko.EKO_TWIN && eko.EKO_TWIN.trace && eko.EKO_TWIN_MAP.graph)
  for (const h of [false, undefined, 'true', 1]) {
    const w = win(h); w.EKO_TWIN = { stale: true }; w.EKO_TWIN_MAP = { stale: true }
    load('static/dashboard/js/layouts/hospital-twin-map.js', w); load('static/dashboard/js/layouts/hospital-twin.js', w)
    assert.equal(w.EKO_TWIN, undefined, String(h)); assert.equal(w.EKO_TWIN_MAP, undefined, String(h))
  }
})
