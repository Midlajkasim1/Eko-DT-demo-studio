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
  assert.deepEqual(T.LEVELS, ['RF', 'L3', 'L2', 'L1'])
  for (const lv of T.LEVELS) assert.ok(T.EQUIP.some(e => e.level === lv), lv)
  const ids = T.EQUIP.map(e => e.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes('CHILLER_01') && ids.includes('AHU_03') && ids.includes('OXYGEN_PLANT_01'))
  assert.ok(!T.EQUIP.some(e => e.level === 'GF'), 'V2 level keys only')
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

test('networks: the 14 systems and 6 layers; air is green/cyan, water blue/orange, power yellow, medical gas pink/magenta; every pipe and riser tied to a drawn machine, none to the weather sensor', () => {
  // the client asked for these hue families (the reference file's lavender air, red hot water and white oxygen were changed on purpose)
  assert.deepEqual(T.SYSTEMS, {
    chws: ['#2f6bff', 'chw'], chwr: ['#8fc2ff', 'chw'], cws: ['#12a7c9', 'cw'], cwr: ['#ffb347', 'cw'], hw: ['#ff6a3d', 'water'], dcw: ['#4aa8ff', 'water'],
    drn: ['#c98b3a', 'water'], sa: ['#2de0b0', 'air'], fa: ['#8be26f', 'air'], ea: ['#7aa890', 'air'], pwr: ['#ffd23f', 'power'], gen: ['#ffb800', 'power'],
    o2: ['#ff5ccf', 'gas'], ma: ['#f4a6ff', 'gas'] })
  const hue = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60 }
  const band = { air: [80, 190], power: [40, 55], gas: [285, 330] }
  for (const [k, [col, layer]] of Object.entries(T.SYSTEMS)) if (band[layer]) assert.ok(hue(col) >= band[layer][0] && hue(col) <= band[layer][1], `${k} ${col} is in the ${layer} hue family`)
  const warm = ['hw', 'drn', 'cwr'].every(k => hue(T.SYSTEMS[k][0]) < 50), blue = ['chws', 'chwr', 'cws', 'dcw'].every(k => { const h = hue(T.SYSTEMS[k][0]); return h > 180 && h < 260 })
  assert.ok(warm && blue, 'water and drainage: blue and orange')
  assert.equal(new Set(Object.values(T.SYSTEMS).map(v => v[0])).size, 14, 'no two systems share a colour')
  assert.deepEqual(T.LAYERS, ['chw', 'cw', 'air', 'water', 'power', 'gas'])
  assert.equal(T.PIPES.length, 104)
  assert.equal(T.RISERS.length, 7)
  assert.equal(new Set(T.PIPES.map(p => p.id)).size, T.PIPES.length)
  for (const k of Object.keys(T.SYSTEMS)) assert.ok(T.PIPES.some(p => p.sys === k) || T.RISERS.some(r => r.sys === k), k + ' is drawn')
  const ids = new Set(T.EQUIP.map(e => e.id))
  for (const p of [...T.PIPES, ...T.RISERS]) assert.ok(ids.has(p.src), (p.id || p.sys) + ' is tied to ' + p.src)
  const srcs = new Set([...T.PIPES, ...T.RISERS].map(p => p.src))
  assert.ok(!srcs.has('WEATHER'), 'no network on the weather sensor')
  assert.deepEqual([...srcs].filter(id => T.EQUIP.find(e => e.id === id).nonFin).sort(), ['DEWA_SUPPLY', 'GENERATOR'])
  // a few of the reference's ties, verbatim
  const src = id => T.PIPES.find(p => p.id === id).src
  assert.deepEqual(['cws_ct_cwp', 'chws_fahu_L2', 'sa_main_L3', 'ea_04', 'dcw_L1', 'pwr_bus_DB_02', 'gen_ats', 'drn_out'].map(src),
    ['CONDENSER_WATER_PUMP_01', 'FAHU_02', 'AHU_03', 'EXHAUST_FAN_04', 'WATER_METER_01', 'DB_02', 'GENERATOR', 'SUMP_PUMP'])
})

test('Phase 3: the drawn list is the client\'s V2 design, item for item (72 items, ids, types, levels and feeding boards)', () => {
  const V2 = JSON.parse(read('spec/fixtures/eko-hospital/v2-equipment.json')).equipment
  assert.equal(T.EQUIP.length, 72)
  assert.deepEqual(T.EQUIP.map(e => [e.id, e.type, e.level, e.feed || null, !!e.nonFin]), V2.map(e => [e.id, e.type, e.level, e.feed || null, !!e.nonFin]))
  const by = t => T.EQUIP.filter(e => e.type === t).map(e => e.id)
  assert.deepEqual(by('SMDB'), ['SMDB_01', 'SMDB_02', 'SMDB_03', 'SMDB_04'])
  assert.deepEqual(by('MCC'), ['MCC_01', 'MCC_02', 'MCC_03', 'MCC_04'])
  assert.deepEqual(by('DB'), ['DB_01', 'DB_02', 'DB_03'], 'no DB_04: there is no DB on the roof')
  assert.equal(by('CCTV').length, 9); assert.equal(by('FCU').length, 6); assert.equal(by('VAV').length, 10)
  assert.deepEqual(['DIALYSIS', 'STRETCHER', 'LASER', 'FRIDGE', 'ULTRASOUND', 'SCALE'].map(t => by(t).length), [1, 1, 1, 1, 1, 1])
  assert.ok(!T.EQUIP.some(e => /PMU|ENERGY/.test(e.id)), 'PMU_Main and the V1 energy meters are not drawn')
})

test('Phase 3: every drawn type has a drawing function and a name in both languages; no drawing prints a reading', () => {
  const src = read('static/dashboard/js/layouts/hospital-twin.js')
  for (const t of new Set(T.EQUIP.map(e => e.type))) assert.match(src, new RegExp('DRAW\\.' + t + ' = function'), t)
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /textContent = .*(toFixed|currentValue)/, 'drawings carry no live text')
})
