import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The Eko Hospital Live Twin, Phase 1 (static/dashboard/js/layouts/hospital-twin.js): its building data, how it reads the dashboard's FIN feed,
// its strings in both languages and its place in the Systems menu. No browser, no FIN.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const T = (() => { const m = { exports: {} }; new Function('module', read('static/dashboard/js/layouts/hospital-twin.js'))(m); return m.exports })()

test('four floors, each with equipment; ids are unique', () => {
  assert.deepEqual(T.LEVELS, ['RF', 'L2', 'L1', 'GF'])
  for (const lv of T.LEVELS) assert.ok(T.EQUIP.some(e => e.level === lv), lv)
  const ids = T.EQUIP.map(e => e.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes('CHILLER_01') && ids.includes('AHU_03') && ids.includes('OXYGEN_PLANT_01'))
})

test('the camera frames: whole building and each floor fit the screen shape', () => {
  const w = T.worldBounds()
  for (const a of [0.4, 0.6, 1.8]) {
    const f = T.fit(w, a, 10)
    assert.ok(Math.abs(f.h / f.w - a) < 1e-9 && f.w >= w.w && f.h >= w.h)
  }
  const ys = T.LEVELS.map(lv => T.levelBounds(lv).y)
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, 'the roof is drawn above L2, above L1, above GF')
})

test('every string the twin uses is in English and Arabic', () => {
  const src = read('static/dashboard/js/layouts/hospital-twin.js')
  const keys = new Set([...src.matchAll(/'(twin[A-Z][A-Za-z]*)'/g)].map(m => m[1]).filter(k => !k.endsWith('.')))
  for (const t of new Set(T.EQUIP.map(e => e.type))) keys.add('twinT.' + t)
  for (const lv of [...T.LEVELS, 'EXT']) keys.add('twinLv.' + lv)
  for (const lv of ['ALL', ...T.LEVELS]) keys.add('twinBtn.' + lv)
  for (const l of T.LAYERS) keys.add('twinLayer.' + l)
  for (const k of Object.keys(T.SYSTEMS)) keys.add('twinSys.' + k)
  for (const s of ['mapped', 'stale', 'offline', 'unmapped', 'missing', 'ambiguous', 'not-fin']) keys.add('twinFin.' + s)
  for (const r of ['no-evidence', 'name-only', 'not-in-feed', 'duplicate', 'id-differs', 'type-differs']) keys.add('twinWhy.' + r)
  for (const s of ['missing', 'not-reporting', 'stale', 'unavailable', 'offline']) keys.add('twinPt.' + s)
  for (const s of ['fault', 'normal', 'unavailable']) keys.add('twinFdd.' + s)
  keys.add('sysLiveTwin')
  const E = read('static/dashboard/js/i18n/en.js'), A = read('static/dashboard/js/i18n/ar.js')
  for (const k of keys) {
    assert.ok(E.includes(JSON.stringify(k) + ':'), 'en ' + k)
    assert.ok(A.includes(JSON.stringify(k) + ':'), 'ar ' + k)
  }
})

test('Live Twin is a Systems entry, loaded by the dashboard, and only the Hospital project shows it', () => {
  const nav = read('static/dashboard/js/layouts/nav.js')
  assert.match(nav, /"id": "twin",\s+"label": "sysLiveTwin",\s+"pageId": "live-twin"/)
  const html = read('templates/index.html'), mapAt = html.indexOf('/static/dashboard/js/layouts/hospital-twin-map.js')
  assert.ok(mapAt > 0 && mapAt < html.indexOf('/static/dashboard/js/layouts/hospital-twin.js'), 'the map loads before the twin')
  assert.ok(read('static/dashboard/js/app.js').includes("states['systems.twin'] = cfg.hospitalHvac === true ? 'active' : 'hidden'"))
})

test('networks: the 14 reference systems in its colours and 6 layers, every pipe and riser tied to a drawn machine, none to an unmapped meter', () => {
  // EKO_Live_Twin.html SYSTEMS: colour and layer of each system
  assert.deepEqual(T.SYSTEMS, {
    chws: ['#3b8cff', 'chw'], chwr: ['#8fc2ff', 'chw'], cws: ['#19c2a8', 'cw'], cwr: ['#ff8a3d', 'cw'], hw: ['#ff5a5f', 'water'], dcw: ['#2fd4f0', 'water'],
    drn: ['#b08442', 'water'], sa: ['#b9a7ff', 'air'], fa: ['#7ee2a0', 'air'], ea: ['#94a3b8', 'air'], pwr: ['#ffd23f', 'power'], gen: ['#ff9f1c', 'power'],
    o2: ['#e8eef6', 'gas'], ma: ['#f29cf5', 'gas'] })
  assert.deepEqual(T.LAYERS, ['chw', 'cw', 'air', 'water', 'power', 'gas'])
  assert.equal(T.PIPES.length, 91)
  assert.equal(T.RISERS.length, 7)
  assert.equal(new Set(T.PIPES.map(p => p.id)).size, T.PIPES.length)
  for (const k of Object.keys(T.SYSTEMS)) assert.ok(T.PIPES.some(p => p.sys === k) || T.RISERS.some(r => r.sys === k), k + ' is drawn')
  const ids = new Set(T.EQUIP.map(e => e.id))
  for (const p of [...T.PIPES, ...T.RISERS]) assert.ok(ids.has(p.src), (p.id || p.sys) + ' is tied to ' + p.src)
  const srcs = new Set([...T.PIPES, ...T.RISERS].map(p => p.src))
  assert.ok(!['GF_ENERGY', '1F_ENERGY', '2F_ENERGY', 'RF_ENERGY', 'WEATHER'].some(id => srcs.has(id)), 'no network on an unmapped meter or the weather sensor')
  assert.deepEqual([...srcs].filter(id => T.EQUIP.find(e => e.id === id).nonFin).sort(), ['DEWA_SUPPLY', 'GENERATOR'])
  // a few of the reference's ties, verbatim
  const src = id => T.PIPES.find(p => p.id === id).src
  assert.deepEqual(['cws_ct_cwp', 'chws_fahu_L1', 'sa_main_L2', 'ea_04', 'dcw_GF', 'pwr_bus_L1', 'gen_ats', 'drn_out'].map(src),
    ['CONDENSER_WATER_PUMP_01', 'FAHU_02', 'AHU_03', 'EXHAUST_FAN_04', 'WATER_METER_01', 'SMDB_02', 'GENERATOR', 'SP_01'])
})
