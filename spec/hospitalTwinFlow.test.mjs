import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The EKO Hospital Live Twin's live flow evidence, run status, cleared alarm records and frontend wording (hospital-twin-map.js, hospital-twin.js, i18n),
// against the saved exports in spec/fixtures/eko-hospital (a snapshot, not a live check).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const load = (p, win) => { const m = { exports: {} }; new Function('module', 'window', read(p))(m, win); return m.exports }
const M = load('static/dashboard/js/layouts/hospital-twin-map.js')
const T = load('static/dashboard/js/layouts/hospital-twin.js')
const EQX = JSON.parse(read('spec/fixtures/eko-hospital/equipment.json')).equipment
const ALARMS = JSON.parse(read('spec/fixtures/eko-hospital/alarms.json')).alarms
const EQ = Object.fromEntries(T.EQUIP.map(e => [e.id, e]))
const feed = (list = EQX) => list.map(e => ({ id: e.name, finId: e.finId, bimId: e.bimId, floor: e.floor, tags: e.tags, typeEn: String(e.type).toUpperCase(), st: 'ok', points: e.points }))
/* as the twin's resolveAll: the drawn items, plus PMU_Main (not drawn) for the mains cable's reading */
const resolveAll = (assets, connected = true) => { const idx = M.index(assets); return { ...Object.fromEntries(T.EQUIP.map(e => [e.id, M.resolve(e, idx, connected)])), PMU_Main: M.resolve({ id: 'PMU_Main', type: 'PMU', level: 'L1' }, idx, connected) } }
const pipe = id => T.PIPES.find(p => p.id === id)
const rule = id => M.flowRule(pipe(id), EQ)
/* the export with one point changed */
const withPoint = (eq, nav, patch) => feed(EQX.map(e => e.name !== eq ? e : { ...e, points: e.points.map(p => p.navName === nav ? { ...p, ...patch } : p) }))

test('flow evidence per network: meters where they exist, run status otherwise, nothing on the coil branches', () => {
  assert.deepEqual(rule('chws_hdr_L1'), { measure: [['BTU_01', 'CHWFlow']], run: [['CHILLED_WATER_PUMP_01', 'Pump01RunStatus'], ['CHILLED_WATER_PUMP_01', 'Pump02RunStatus']] })
  assert.deepEqual(rule('chws_ahu_L1'), { measure: [], run: [] }, 'a coil branch has no meter and the fan says nothing of the water')
  assert.deepEqual(rule('cws_ct_cwp'), { measure: [], run: [['CONDENSER_WATER_PUMP_01', 'Pump01RunStatus'], ['CONDENSER_WATER_PUMP_01', 'Pump02RunStatus']] })
  assert.deepEqual(rule('dcw_L2'), { measure: [['WATER_METER_02', 'FlowRate']], run: [] })
  assert.deepEqual(rule('sa_vav_06'), { measure: [['VAV_06', 'Airflow']], run: [] })
  assert.deepEqual(rule('sa_main_L1'), { measure: [], run: [['AHU_01', 'SA Fan Status']] })
  assert.deepEqual(rule('fa_in_L1'), { measure: [], run: [['FAHU_01', 'SupplyFanStatus']] })
  assert.deepEqual(rule('o2_L1'), { measure: [['OXYGEN_PLANT_01', 'Flow']], run: [] })
  assert.deepEqual(rule('ma_L1'), { measure: [['MEDICAL_AIR_COMPRESSOR_01', 'Flow']], run: [] })
  assert.deepEqual(rule('pwr_dewa_ats'), { measure: [['PMU_Main', 'ActivePower']], run: [] })
  assert.deepEqual(rule('gen_ats'), { measure: [], run: [['AUTOMATIC_TRANSFER_SWITCH_01', 'EmergencySupplySts']] })
  // every meter and status point named is a point of that equipment in the export
  const names = Object.fromEntries([...T.EQUIP.filter(e => M.finName(e)).map(e => [e.id, M.finName(e)]), ['PMU_Main', 'PMU_Main']].map(([id, n]) => [id, new Set(M.REF[n].points.map(p => M.fold(p[0])))]))
  for (const p of T.PIPES) { const r = M.flowRule(p, EQ); for (const [id, n] of r.measure.concat(r.run)) assert.ok(names[id] ? names[id].has(M.fold(n)) : !M.finName(EQ[id]), `${p.id}: ${id}.${n} (an unmapped item names a point that reads as unknown, never a value)`) }
})

test('flow states from the export: measured only with a live meter above 0; running only from run status; meter at 0 is stopped', () => {
  const res = resolveAll(feed())
  const st = id => M.flowState(rule(id), res, true)
  assert.equal(st('chws_hdr_L1'), 'measured', 'BTU_01 CHWFlow 17 L/s')
  assert.equal(st('cws_ct_cwp'), 'running', 'condenser pump running, no flow meter: running, never measured')
  assert.equal(st('fa_in_L1'), 'running', 'FAHU fan running, no airflow meter')
  assert.equal(st('sa_main_L1'), 'running')
  assert.equal(st('o2_L1'), 'measured')
  assert.equal(st('chws_ahu_L1'), 'unknown', 'no data: static')
  assert.equal(st('gen_ats'), 'stopped', 'on mains: the generator feed is off')
  // a meter reading 0 wins over a running pump
  const zero = resolveAll(withPoint('BTU_01', 'CHWFlow', { currentValue: '0L/s' }))
  assert.equal(M.flowState(rule('chws_hdr_L1'), zero, true), 'stopped')
  // the meter not reporting: back to the pumps' run status
  const silent = resolveAll(withPoint('BTU_01', 'CHWFlow', { reporting: false, currentValue: '—' }))
  assert.equal(M.flowState(rule('chws_hdr_L1'), silent, true), 'running')
  // pumps off, no meter
  const off = resolveAll(withPoint('CONDENSER_WATER_PUMP', 'Pump01RunStatus', { bool: false, currentValue: 'Off', text: 'Off' }))
  assert.equal(M.flowState(rule('cws_ct_cwp'), off, true), 'stopped')
})

test('flow states when the data cannot be trusted: disconnected, stale or missing is unknown, never flowing', () => {
  assert.equal(M.flowState(rule('chws_hdr_L1'), resolveAll(feed(), false), false), 'unknown')
  const res = resolveAll(feed())
  const stale = Object.fromEntries(Object.entries(res).map(([k, r]) => [k, { ...r, state: r.state === 'mapped' ? 'stale' : r.state }]))
  assert.ok(T.PIPES.every(p => M.flowState(M.flowRule(p, EQ), stale, true) === 'unknown'))
  assert.equal(M.flowState(rule('chws_hdr_L1'), resolveAll([]), true), 'unknown', 'nothing in the feed')
  assert.equal(M.flowState(rule('cws_ct_cwp'), resolveAll(withPoint('CONDENSER_WATER_PUMP', 'Pump01RunStatus', { status: 'fault' })), true), 'unknown',
    'one of two statuses unreadable and the other off: not called stopped')
})

test('run status of a machine: its own status points only', () => {
  const res = resolveAll(feed())
  assert.equal(M.runState('AHU_01', 'AHU', res, true), 'on')
  assert.equal(M.runState('MEDICAL_AIR_COMPRESSOR_01', 'MAC', res, true), 'off')
  assert.equal(M.runState('BTU_01', 'BTU', res, true), null, 'a meter has no run status')
  assert.equal(M.runState('AHU_01', 'AHU', res, false), null)
})

test('alarms keep their time and their cleared records as sent; a cleared record is never active', () => {
  const al = ALARMS.map(a => ({ id: a.id, sourceId: a.source_id, state: a.state, plainEn: a.message, raisedAt: 1700000000000,
    hist: a.history.map(h => ({ id: h.id, msg: h.message, tech: h.detail, open: h.open, at: 1690000000000, state: h.state })) }))
  const a = M.alarmsFor(resolveAll(feed()).AHU_01, al).find(x => x.message === 'Cooling Coil is Overcooling')
  assert.equal(a.at, 1700000000000)
  assert.equal(a.clearedRecs.length, 2)
  assert.deepEqual(a.clearedRecs.map(c => [c.message, c.point, c.at]).sort(), [['Return to normal', null, 1690000000000], ['Return to normal', 'FD&D_3_Fan_Command/Status_Mismatch', 1690000000000]])
  assert.equal(M.alarmsFor(resolveAll(feed()).AHU_01, al.map(x => ({ ...x, raisedAt: undefined })))[0].at, null, 'no time is made up')
})

test('the frontend never shows the word FIN: every Live Twin string, in English and Arabic', () => {
  for (const l of ['en', 'ar']) {
    const src = read(`static/dashboard/js/i18n/${l}.js`)
    const bad = [...src.matchAll(/"(twin[^"]*)": ("(?:[^"\\]|\\.)*")/g)].filter(m => /FIN/.test(JSON.parse(m[2]))).map(m => m[1])
    assert.deepEqual(bad, [], l)
  }
  // no string literal in the view's code says it either (comments may)
  const code = read('static/dashboard/js/layouts/hospital-twin.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.deepEqual([...code.matchAll(/'[^'\n]*\bFIN\b[^'\n]*'/g)].map(m => m[0]), [])
  const en = read('static/dashboard/js/i18n/en.js')
  assert.match(en, /"twinBimSharedPair": "Shared BIM ID: \{names\}\. These assets cannot be linked to the model because they share the same identifier\."/)
  assert.match(en, /"twinFddNoMsg": "No fault description is available\."/)
  assert.match(en, /"twinLayoutNote": "Building layout and service routes are illustrative and require engineering verification\."/)
})
