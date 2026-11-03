import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The Hospital roof schematic's logic (static/dashboard/js/layouts/hospital-roof.js), with no browser, no FIN and no model.
// The feed below is TEST INPUT shaped like the dashboard's equipment feed (asset id + points with navName / currentValue /
// reporting). It is not a FIN export: no roof equipment or point list is in this repository, so what is checked here is the
// RULE (a value is shown only for confirmed equipment and an exactly matching, reporting, well-formed point), not FIN's names.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const source = read('static/dashboard/js/layouts/hospital-roof.js')
const mod = { exports: {} }
new Function('module', source)(mod)
const R = mod.exports

const pt = (navName, currentValue, extra = {}) => ({ navName, currentValue, text: currentValue, reporting: true, ...extra })
const asset = (id, points, typeEn = 'EQUIPMENT') => ({ id, typeEn, points })
const slots = (map = {}) => R.SLOTS.map(s => ({ ...s, equip: map[s.id] ?? null }))
const item = id => R.ITEMS.find(i => i.id === id) || R.PANELS.flatMap(p => p.rows).find(i => i.id === id)
const byId = m => Object.fromEntries([...m.items, ...m.panels.flatMap(p => p.rows)].map(i => [i.id, i]))

const TOWER = asset('CT-01', [pt('FAN_SPEED', '62.5'), pt('FanRunStatus', 'On'), pt('CW_ENTERING_TEMP', '33.9'), pt('CW_LEAVING_TEMP', '29.89 °C'), pt('FAN_TRIP', 'Normal')])
const CHILLER = asset('CH-01', [pt('RunStatus', 'Off'), pt('POWER', '94.3'), pt('ALARM_STATUS', 'Normal')])

test('every slot starts unconfirmed: no value is shown, however the feed is named', () => {
  // the feed carries points with exactly the expected names, on equipment that looks like the right kind: still nothing is shown
  const feed = [asset('COOLING_TOWER_01', TOWER.points, 'COOLINGTOWER'), asset('CHILLER_01', CHILLER.points, 'CHILLER')]
  const m = R.model(feed)
  assert.ok(m.slots.every(s => s.state === 'unconfirmed' && s.equip === null), 'no slot is confirmed in the shipped mapping')
  for (const i of [...m.items, ...m.panels.flatMap(p => p.rows)]) {
    assert.equal(i.state, 'unconfirmed', i.id)
    assert.equal(i.text, '—', i.id)
    assert.equal(i.raw, null, i.id)
  }
})

test('a confirmed slot shows its own equipment\'s exactly named points, formatted by kind', () => {
  const m = R.model([TOWER, CHILLER], slots({ coolingTower: 'CT-01', chiller: 'CH-01' }))
  const v = byId(m)
  assert.deepEqual([v.ctFanSpeed.state, v.ctFanSpeed.text], ['live', '62.5 %'])
  assert.deepEqual([v.ctCwEnter.state, v.ctCwEnter.text], ['live', '33.9 °C'])
  assert.equal(v.ctCwLeave.text, '29.9 °C', 'the unit FIN sent with the value is not doubled')
  assert.deepEqual([v.ctFanRun.state, v.ctFanRun.status, v.ctFanRun.text], ['live', 'on', 'On'])
  assert.deepEqual([v.chRun.state, v.chRun.status], ['live', 'off'])
  assert.equal(v.chPower.text, '94.3 kW')
  assert.equal(v.ctFanTrip.text, 'Normal', 'a text row shows FIN\'s own text')
})

test('matching is exact on the folded name, on the confirmed equipment only', () => {
  const feed = [asset('CT-01', [pt('FAN_SPEED_SP', '50'), pt('FanSpeedFeedback', '48')]), asset('CT-02', [pt('FAN_SPEED', '71')])]
  const v = byId(R.model(feed, slots({ coolingTower: 'CT-01' })))
  assert.equal(v.ctFanSpeed.state, 'no-point', 'a set-point or a similar name is not the value, and another equipment\'s point is not read')
  assert.equal(v.ctFanSpeed.text, '—')
  assert.equal(R.fold('FAN_SPEED'), R.fold('fan-speed'))
  assert.notEqual(R.fold('FAN_SPEED'), R.fold('FAN_SPEED_SP'))
})

test('the equipment id is matched whole: a longer or similar id is not the equipment', () => {
  const feed = [asset('CT-011', TOWER.points), asset('ct-01', TOWER.points)]
  const s = R.resolveSlots(feed, slots({ coolingTower: 'CT-01' })).find(x => x.id === 'coolingTower')
  assert.equal(s.state, 'not-in-feed')
  assert.equal(s.asset, null)
  const v = byId(R.model(feed, slots({ coolingTower: 'CT-01' })))
  assert.equal(v.ctFanSpeed.state, 'not-in-feed')
  assert.equal(v.ctFanSpeed.text, '—')
})

test('missing, not reporting, empty and invalid readings are "—", never a fake value', () => {
  const eqp = asset('CT-01', [
    pt('FAN_SPEED', '62.5', { reporting: false }),
    pt('FANRUNSTATUS', null),
    pt('CW_ENTERING_TEMP', 'On'),
    pt('CW_LEAVING_TEMP', '999'),
    pt('FAN_TRIP', 'null'),
    pt('HOA', '--'),
  ])
  const v = byId(R.model([eqp], slots({ coolingTower: 'CT-01' })))
  assert.equal(v.ctFanSpeed.state, 'not-reporting')
  assert.equal(v.ctFanRun.state, 'no-point', 'no value is no point')
  assert.equal(v.ctCwEnter.state, 'invalid', 'text where a temperature belongs')
  assert.equal(v.ctCwLeave.state, 'invalid', 'a temperature out of range')
  assert.equal(v.ctFanTrip.state, 'no-point')
  assert.equal(v.ctHoa.state, 'no-point')
  for (const id of ['ctFanSpeed', 'ctFanRun', 'ctCwEnter', 'ctCwLeave', 'ctFanTrip', 'ctHoa', 'ctFanEnable']) assert.equal(v[id].text, '—', id)
  const pct = byId(R.model([asset('CT-01', [pt('FAN_SPEED', '150')])], slots({ coolingTower: 'CT-01' })))
  assert.equal(pct.ctFanSpeed.state, 'invalid', 'a percentage above 100')
  assert.equal(R.readItem(item('ctFanSpeed'), { state: 'ok', asset: { points: undefined } }).state, 'no-point', 'an asset with no points list does not throw')
  assert.equal(R.readItem(item('ctFanSpeed'), undefined).state, 'unconfirmed')
})

test('the status of a unit follows FIN\'s text', () => {
  for (const [raw, st] of [['On', 'on'], ['Running', 'on'], ['true', 'on'], ['Off', 'off'], ['Stopped', 'off'], ['Fault', 'fault'], ['Tripped', 'fault'], ['Standby', 'unknown'], ['', 'unknown']]) {
    assert.equal(R.statusOf(raw), st, raw)
  }
  const run = (raw) => byId(R.model([asset('CT-01', [pt('FANRUNSTATUS', raw)])], slots({ coolingTower: 'CT-01' }))).ctFanRun
  assert.equal(run('Off').status, 'off')
  assert.equal(run('On').status, 'on', 'a later reading replaces the earlier one: nothing is carried over')
  assert.equal(run('Fault').status, 'fault')
})

test('candidates are suggestions for whoever confirms: they never confirm a slot or give a value', () => {
  const feed = [asset('CHILLER_01', CHILLER.points, 'CHILLER'), asset('AHU_01', [], 'AHU')]
  const chiller = R.SLOTS.find(s => s.id === 'chiller')
  assert.deepEqual(R.candidates(feed, chiller), ['CHILLER_01'])
  assert.deepEqual(R.candidates(feed, R.SLOTS.find(s => s.id === 'boiler')), [])
  assert.ok(R.model(feed).slots.every(s => s.state === 'unconfirmed'))
  assert.deepEqual(R.candidates(undefined, chiller), [])
})

test('the mapping tables are well formed: unique ids, known slots and kinds, folded names, uncertain reads flagged', () => {
  const rows = [...R.ITEMS, ...R.PANELS.flatMap(p => p.rows)]
  const ids = rows.map(r => r.id)
  assert.equal(new Set(ids).size, ids.length, 'item ids are unique')
  const slotIds = R.SLOTS.map(s => s.id)
  assert.equal(new Set(slotIds).size, slotIds.length)
  for (const it of R.ITEMS) assert.ok(slotIds.includes(it.slot), it.id)
  for (const p of R.PANELS) assert.ok(slotIds.includes(p.slot), p.id)
  for (const r of rows) {
    assert.ok(['temp', 'pct', 'num', 'status', 'text'].includes(r.kind), r.id)
    assert.ok(r.names.length && r.names.every(n => n === R.fold(n)), `${r.id}: names are already folded`)
  }
  assert.ok(rows.filter(r => r.read === 'uncertain').length > 0, 'names that could not be read with confidence from the photo are marked')
  assert.ok(R.SLOTS.every(s => s.equip === null), 'nothing is confirmed without FIN evidence')
})

// ── the drawing ──
const model = R.model([TOWER, CHILLER], slots({ coolingTower: 'CT-01', chiller: 'CH-01' }))
const markup = R.svg(model)

test('the SVG is one connected schematic: pipes in the three colours, all six equipment, every value', () => {
  assert.equal((markup.match(/<svg /g) || []).length, 1)
  assert.ok(markup.includes(`viewBox="0 0 ${R.VB.w} ${R.VB.h}"`))
  for (const c of ['#3fae49', '#2b8cee', '#e53030']) assert.ok(markup.includes(`stroke="${c}"`), `a ${c} pipe`)
  assert.ok((markup.match(/<path d="M[^"]+" fill="none" stroke=/g) || []).length >= 8, 'a connected pipe network, not loose cards')
  for (const s of R.SLOTS) assert.ok(markup.includes(`data-slot="${s.id}"`), s.id)
  for (const r of [...R.ITEMS, ...R.PANELS.flatMap(p => p.rows)]) assert.ok(markup.includes(`data-item="${r.id}"`), r.id)
  for (const p of R.PANELS) assert.ok(markup.includes(p.title), p.title)
  assert.ok(markup.includes('HOSPITAL ROOF') && markup.includes('BUILDING CHILLED') && markup.includes('BUILDING HOT WATER'))
})

test('only confirmed equipment in the feed is clickable, and it opens that asset by its existing id', () => {
  const g = id => markup.match(new RegExp(`<g class="rf-eq" data-slot="${id}"[^>]*>`))[0]
  assert.ok(g('coolingTower').includes('data-act="roofAsset"') && g('coolingTower').includes('data-asset="CT-01"'))
  assert.ok(g('chiller').includes('data-asset="CH-01"'))
  for (const id of ['condenserPumps', 'chilledPumps', 'boiler', 'btu']) {
    assert.ok(!g(id).includes('data-act'), `${id} is not confirmed, so it is not a link`)
    assert.ok(g(id).includes('requires confirmation'), id)
  }
  assert.ok(!/data-asset="(?!CT-01|CH-01)/.test(markup), 'no other asset id appears')
})

test('markup escapes what FIN sends', () => {
  const evil = R.svg(R.model([asset('CT-01', [pt('FANRUNSTATUS', '<img src=x onerror=alert(1)>')])], slots({ coolingTower: 'CT-01' })))
  assert.ok(!evil.includes('<img'), 'FIN text is escaped')
  assert.ok(evil.includes('&lt;img'))
  const quote = R.svg(R.model([asset('CT"><script>', TOWER.points)], slots({ coolingTower: 'CT"><script>' })))
  assert.ok(!quote.includes('<script>'), 'an asset id cannot break out of its attribute')
})

const rect = i => ({ x: i.x, y: i.y, w: i.w, h: 13 + 18 })
const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('layout: every value box and panel is inside the drawing, and none overlap', () => {
  const boxes = R.ITEMS.map(i => ({ id: i.id, ...rect(i) }))
  const panels = R.PANELS.map(p => ({ id: 'panel ' + p.id, x: p.x, y: 200, w: p.w, h: 24 + p.rows.length * 17 }))
  for (const b of [...boxes, ...panels]) {
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= R.VB.w && b.y + b.h <= R.VB.h, `${b.id} is inside ${R.VB.w}x${R.VB.h}`)
  }
  const all = [...boxes, ...panels]
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!meets(all[i], all[j]), `${all[i].id} overlaps ${all[j].id}`)
})

test('layout follows the FIN screen: tower left, chiller below centre, boiler right, panels across the top', () => {
  const at = id => R.ITEMS.find(i => i.id === id)
  assert.ok(at('ctFanSpeed').x < at('chRun').x && at('chRun').x < at('blRun').x, 'left to right: tower, chiller, boiler')
  assert.ok(at('wpP1Speed').y < at('chRun').y, 'the chilled-water pumps sit above the chiller')
  const xs = R.PANELS.map(p => p.x)
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'the overview panels run left to right in the FIN order')
  assert.deepEqual(R.PANELS.map(p => p.id), ['ct', 'cp', 'ch', 'wp', 'bl', 'bt'])
})

test('the module is isolated: no iframe, no network call, no FIN address or record id, no hardcoded value', () => {
  assert.ok(!/iframe|foreignObject|fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/i.test(source), 'it draws from the feed the dashboard already has')
  assert.ok(!/https?:\/\//.test(source.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '')), 'no URL')
  assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(source), 'no IP address')
  assert.ok(!/@p:|finMobile|fin5|targetRef/.test(source), 'no FIN record or screen reference')
  assert.ok(!/localStorage|sessionStorage|document\.cookie|authToken|Authorization/i.test(source), 'no credentials or storage')
})

test('the old Hospital roof iframe is gone from the Studio and the dashboard', () => {
  assert.ok(!/HOSPITAL_ROOF_GRAPHIC_PATH|hospitalGraphic|finServerOrigin|DashboardGraphic/.test(read('src/lib/hospitalHvac.ts')))
  assert.ok(!/hospitalGraphics|\.graphics\b/.test(read('src/components/viewer/DashboardOverlay.tsx')))
  const app = read('static/dashboard/js/app.js')
  assert.ok(!/graphicOpen|FRAME_TIMEOUT_MS|docstate|gfx[A-Z]/.test(app))
  assert.ok(/docOpen\(el\)/.test(app) && /function openFramePopup/.test(app), 'the O&M / warranty popup is still there')
  for (const f of ['static/dashboard/js/i18n/en.js', 'static/dashboard/js/i18n/ar.js', 'static/dashboard/js/layouts/grids.js', 'static/dashboard/css/components.css']) {
    assert.ok(!/gfx[A-Z]|graphicOpen|dgfinb|dgfinw|docstate|docerr/.test(read(f)), f)
  }
  assert.ok(!fs.existsSync(path.join(root, 'spec/hospitalGraphics.test.mjs')) && !fs.existsSync(path.join(root, 'spec/hospitalGraphics.browser.test.mjs')))
  const pkg = JSON.parse(read('package.json'))
  assert.ok(!/hospitalGraphics/.test(pkg.scripts['test:hospital-hvac'] + pkg.scripts['test:hospital-hvac:browser']))
  assert.ok(pkg.scripts['test:hospital-hvac'].includes('spec/hospitalRoof.test.mjs'))
  assert.ok(pkg.scripts['test:hospital-hvac:browser'].includes('spec/hospitalRoof.browser.test.mjs'))
})
