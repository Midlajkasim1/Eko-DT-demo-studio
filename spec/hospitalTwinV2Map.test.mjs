import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The client's V2 Live Twin design (72 drawn items, spec/fixtures/eko-hospital/v2-equipment.json) against the mapping in hospital-twin-map.js and the
// saved FIN equipment export of 6 Nov 2026. These prove agreement with the export only: no live FIN server was reachable.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const load = p => { const m = { exports: {} }; new Function('module', 'window', read(p))(m, undefined); return m.exports }
const M = load('static/dashboard/js/layouts/hospital-twin-map.js')
const V2 = JSON.parse(read('spec/fixtures/eko-hospital/v2-equipment.json')).equipment
const EQ = JSON.parse(read('spec/fixtures/eko-hospital/equipment.json')).equipment
const byName = Object.fromEntries(EQ.map(e => [e.name, e]))
const feed = (list = EQ) => list.map(e => ({ id: e.name, finId: e.finId, bimId: e.bimId, floor: e.floor, tags: e.tags, typeEn: String(e.type).toUpperCase(), st: 'ok', points: e.points }))
const status = Object.fromEntries(V2.map(e => [e.id, M.mapStatus(e)]))
const ids = cls => V2.filter(e => status[e.id].mapping === cls).map(e => e.id)

test('V2 equipment: 72 items on L1, L2, L3, RF and outside', () => {
  assert.equal(V2.length, 72)
  assert.deepEqual([...new Set(V2.map(e => e.level))].sort(), ['EXT', 'L1', 'L2', 'L3', 'RF'])
  assert.ok(V2.filter(e => e.level !== 'EXT').every(e => M.LEVELS[e.level]), 'every building level has its FIN floor')
})

test('V2 mapping classes: 60 confirmed, 3 provisional, 6 unmapped boards, 3 not FIN', () => {
  assert.equal(ids('confirmed').length, 60)
  assert.deepEqual(ids('provisional').sort(), ['DB_01', 'MCC_01', 'SMDB_01'])
  assert.deepEqual(ids('unmapped').sort(), ['DB_02', 'DB_03', 'MCC_02', 'MCC_03', 'MCC_04', 'SMDB_04'])
  assert.deepEqual(ids('not-fin').sort(), ['DEWA_SUPPLY', 'GENERATOR', 'WEATHER'])
  for (const id of ids('unmapped')) assert.deepEqual([status[id].fin, status[id].finId, status[id].points], [null, null, 0], id + ': nothing invented')
})

test('V2 mapped equipment: each is one exported equipment, used once, with its FIN id, floor and (where FIN tags it) type', () => {
  const mapped = V2.filter(e => status[e.id].fin)
  const names = mapped.map(e => status[e.id].fin)
  assert.equal(new Set(names).size, names.length, 'no FIN equipment is used twice')
  assert.ok(!names.includes('PMU_Main'), 'PMU_Main is not given to any drawn item')
  for (const e of mapped) {
    const s = status[e.id], x = byName[s.fin]
    assert.ok(x, e.id + ' is in the export')
    assert.equal(s.finId, x.finId, e.id + ' FIN id')
    assert.equal(x.floor, M.LEVELS[e.level], e.id + ' floor'); assert.equal(s.floorDiffers, false, e.id)
    if (x.tags.length) assert.ok(x.tags.includes(M.TYPE_TAG[e.type]), `${e.id}: FIN tags [${x.tags}] carry ${M.TYPE_TAG[e.type]}`)
    else assert.equal(x.type, 'other', e.id + ': only the untagged medical devices skip the type check')
  }
})

test('V2 against the exported feed: every mapped item resolves, nothing ambiguous or missing', () => {
  const idx = M.index(feed())
  const by = {}
  for (const e of V2) (by[M.resolve(e, idx, true).state] ||= []).push(e.id)
  assert.deepEqual([by.mapped.length, by.unmapped.length, by['not-fin'].length, by.ambiguous, by.missing], [63, 6, 3, undefined, undefined])
  const fc = M.floorCheck(V2.map(e => M.resolve(e, idx, true)))
  assert.deepEqual(Object.fromEntries(Object.entries(fc).map(([k, v]) => [k, v.conflict])), { L1: false, L2: false, L3: false, RF: false })
})

test('V2 mapped with no points: the MDB, MCC_01, DB_01, the nine cameras and six medical devices; they get no rows', () => {
  const none = V2.filter(e => status[e.id].noPoints).map(e => e.id)
  assert.equal(none.length, 18)
  assert.ok(['MDB', 'MCC_01', 'DB_01', 'CCTV_01', 'CCTV_09', 'Dialysis Machine', 'Scale Clinical Bariatric'].every(id => none.includes(id)))
  assert.ok(!none.includes('SMDB_01'), 'SMDB_GF has its two incomer points')
  const idx = M.index(feed())
  for (const id of none) assert.deepEqual(M.pointRows(M.resolve(V2.find(e => e.id === id), idx, true), true), [], id)
})

test('V2 BIM: a GlobalId only where FIN gives one, never the FIN id; none is checked against an Eko Hospital model', () => {
  const withGuid = V2.filter(e => status[e.id].bim === 'unverified')
  for (const e of withGuid) {
    const s = status[e.id], x = byName[s.fin]
    assert.equal(M.REF[s.fin].bim, M.bimOf({ id: x.name, bimId: x.bimId }), e.id + ': REF keeps FIN\'s own GlobalId')
  }
  for (const id of ['MDB', 'SMDB_01', 'MCC_01', 'DB_01', 'AUTOMATIC_TRANSFER_SWITCH_01']) assert.equal(status[id].bim, 'none', id + ': FIN has only its record id')
  assert.equal(M.REF['Laser System'].bim, '2RYeQGW$H2LvFkemIHa9aU', 'Zinc\'s \\$ read as $')
  assert.ok(V2.every(e => ['unverified', 'none'].includes(status[e.id].bim)), 'no class says verified')
})

test('PMU_Main on the MDB panel: its six readings, each labelled PMU_Main, read from PMU_Main, never stored as MDB points', () => {
  assert.deepEqual(M.REF.MDB.points, [])
  const rows = M.borrowedRows('MDB', M.index(feed()), true)
  assert.deepEqual(rows.map(r => r.name), ['Voltage', 'Frequency', 'Current', 'ActivePower', 'TotalEnergy', 'DEWA_SupplyLost'])
  assert.ok(rows.every(r => r.source === 'PMU_Main'))
  assert.deepEqual(rows.map(r => r.unit), ['V', 'Hz', 'A', 'kW', 'kWh', ''])
  const pmu = Object.fromEntries(byName.PMU_Main.points.map(p => [p.navName, p]))
  for (const r of rows) assert.equal(r.id, pmu[r.name].id, r.name + ': the PMU_Main point id')
  const dewa = rows.find(r => r.name === 'DEWA_SupplyLost')
  if (dewa.state === 'live') assert.equal(dewa.type, 'bool', 'a boolean from FIN\'s bool field, not its text')
  assert.deepEqual(M.borrowedRows('SMDB_01', M.index(feed()), true), [], 'only the MDB borrows')
})

test('PMU_Main on the MDB panel: unavailable when PMU_Main is not in the feed, offline when FIN is', () => {
  const gone = M.borrowedRows('MDB', M.index(feed(EQ.filter(x => x.name !== 'PMU_Main'))), true)
  assert.equal(gone.length, 6)
  assert.ok(gone.every(r => r.state === 'unavailable' && r.value === null && r.source === 'PMU_Main'))
  const off = M.borrowedRows('MDB', M.index([]), false)
  assert.ok(off.length === 6 && off.every(r => r.state === 'offline' && r.value === null))
})

test('legacy floor keys: V1 GF/L1/L2 reach V2 L1/L2/L3; the twin draws only V2 keys', () => {
  assert.deepEqual(M.LEGACY_LEVELS, { GF: 'L1', L1: 'L2', L2: 'L3', RF: 'RF' })
  const T = load('static/dashboard/js/layouts/hospital-twin.js')
  assert.deepEqual(T.LEVELS, ['RF', 'L3', 'L2', 'L1'])
  assert.ok(T.EQUIP.every(e => e.level === 'EXT' || M.LEVELS[e.level]), 'no GF key left')
})
