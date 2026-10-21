// Alarm deduplication in the browser half: FIN direct mode (static/js/fin-direct.js, the copy of the
// backend pipeline) and the dashboard's alarm list (static/js/data-map.js). The backend half is in
// backend/tests/test_alarm_pipeline.py (AlarmDedupTests). Zinc grids are SYNTHETIC, in the columns the
// pipeline reads; no real FIN alarm grid has been captured. Run: node scripts/test-alarm-dedup.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import vm from 'node:vm'
// loaded as the browser loads it (a script setting window.FinDirect): the package is ESM, so require() gets no exports
const load = (file, sandbox) => vm.runInContext(fs.readFileSync(new URL('../static/js/' + file, import.meta.url), 'utf8'), vm.createContext(sandbox))
const FD = (() => { const window = {}; load('fin-direct.js', { window }); return window.FinDirect })()

let passed = 0, failed = 0
// values made inside the vm sandboxes are another realm's arrays/objects: compare plain copies
const plain = v => JSON.parse(JSON.stringify(v))
const eq = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), ...(msg ? [msg] : []))
const test = (name, fn) => {
  try { fn(); passed++; console.log('ok  ' + name) } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]) }
}

const BANDS = { order: 'desc', critical: 250, warning: 150 }
const T1 = '2026-10-20T08:00:00+04:00 Dubai', T2 = '2026-10-20T08:30:00+04:00 Dubai', T3 = '2026-10-20T09:00:00+04:00 Dubai'
const rec = (id, { src = 'e1', message = 'Supply temp high', when = T1, priority = 250, active = 'M', dispatcher = 'CONTROL' } = {}) =>
  `@${id} "Alarm ${id}",M,${active},"${message}",${priority},${src ? `@${src} "AHU-${src}"` : ''},"${dispatcher}",${when}`
const grid = (...rows) => 'ver:"3.0"\nid,alarm,active,message,priority,sourceRef,dispatcher,occurred\n' + rows.join('\n') + '\n'
const EQUIP = 'ver:"3.0"\nid,navName,equip,floorRef\n@e1 "AHU-e1","AHU-e1",M,@f1 "Basement"\n@e2 "AHU-e2","AHU-e2",M,@f1 "Basement"\n'

const flatten = text => FD.flattenAlarms(FD.parseZincCsv(text), BANDS)
const equipCounts = text => {
  const floors = FD.buildRealtime('', EQUIP, text).floors, out = {}
  Object.values(floors).forEach(f => Object.values(f).forEach(list => Array.isArray(list) && list.forEach(eq => { out[eq.name] = (eq.alarms || []).length })))
  return out
}

// --- FIN direct mode: the same answers as the backend --------------------------------------
test('direct: the reported case, a re-issued record is not a second alarm (list and equipment count)', () => {
  const later = grid(rec('a1', { active: '' }), rec('a2', { message: 'Return to normal' }), rec('a3', { when: T2 }), rec('a4', { when: T3 }))
  const out = flatten(later)
  eq(out.alarms.map(a => [a.id, a.source]), [['@a3', 'AHU-e1']])
  assert.strictEqual(out.counts.total, 1)
  eq(equipCounts(later), { 'AHU-e1': 1, 'AHU-e2': 0 })
})

test('direct: the same payload again and again gives the same alarms', () => {
  const text = grid(rec('a1'), rec('a1'), rec('a2', { message: 'Filter dirty' }))
  const ids = [1, 2, 3].map(() => flatten(text).alarms.map(a => a.id).sort().join())
  eq(ids, ['@a1,@a2', '@a1,@a2', '@a1,@a2'])
})

test('direct: distinct alarms on one AHU and the same alarm on two AHUs stay separate', () => {
  assert.strictEqual(flatten(grid(rec('a1'), rec('a2', { message: 'Filter dirty' }), rec('a3', { message: 'Filter dirty', dispatcher: 'CONNECTOR' }))).counts.total, 3)
  eq(equipCounts(grid(rec('a1', { src: 'e1' }), rec('a2', { src: 'e2' }))), { 'AHU-e1': 1, 'AHU-e2': 1 })
  eq(flatten(grid(rec('a1', { src: '' }), rec('a2', { src: '' }))).alarms.map(a => a.id).sort(), ['@a1', '@a2'], 'no source: never merged by message')
})

test('direct: the first record keeps the id and time, the newest its priority; a reactivation is new', () => {
  const [a] = flatten(grid(rec('a4', { when: T3, priority: 250 }), rec('a1', { when: T1, priority: 150 }))).alarms
  eq([a.id, String(a.occurred).slice(0, 19), a.severity], ['@a1', '2026-10-20T08:00:00', 'critical'])
  eq(flatten(grid(rec('a1', { active: '' }), rec('a2', { when: T3 }))).alarms.map(x => x.id), ['@a2'])
})

// --- the dashboard's alarm list (data-map.js), fed the way the overlay feeds it -------------
function dashboard() {
  const listeners = {}
  const window = {
    DASHBOARD_OVERLAY: true, EKO_DATA: { marsa: { assets: [{ id: 'AHU-ANC09-GF-01', bimId: 'b1' }, { id: 'AHU-ANC09-GF-02', bimId: 'b2' }], alarms: [] } },
    addEventListener: (t, f) => (listeners[t] ||= []).push(f), removeEventListener() {}, dispatchEvent() {},
  }
  const doc = { addEventListener() {}, querySelector: () => null, getElementById: () => null }
  load('data-map.js', { window, document: doc, console, setTimeout, clearTimeout })
  const site = window.EKO_DATA.marsa
  return { site, poll: alarms => listeners['dashboard-data'].forEach(f => f({ detail: { type: 'alarms', data: { alarms } } })) }
}
const al = (id, source, message, occurred = '2026-10-20T08:00:00') => ({ id, source, message, severity: 'critical', occurred })

test('dashboard: an alarm keeps its id when FIN adds or drops other records (no list position in it)', () => {
  const d = dashboard()
  d.poll([al('@a1', 'AHU-ANC09-GF-01', 'Supply temp high'), al('@b1', 'AHU-ANC09-GF-02', 'Filter dirty')])
  const before = d.site.alarms.find(a => a.plainEn === 'Filter dirty').id
  d.poll([al('@c1', 'AHU-ANC09-GF-01', 'Fan trip', '2026-10-20T09:00:00'), al('@a1', 'AHU-ANC09-GF-01', 'Supply temp high'), al('@b1', 'AHU-ANC09-GF-02', 'Filter dirty')])
  assert.strictEqual(d.site.alarms.find(a => a.plainEn === 'Filter dirty').id, before)
  assert.strictEqual(new Set(d.site.alarms.map(a => a.id)).size, 3, 'distinct alarms, distinct ids')
  eq(d.site.assets.map(a => a.alarms.length), [2, 1])
})

test('dashboard: an acknowledgement survives the next polls, and stays on its own alarm', () => {
  const d = dashboard()
  const payload = [al('@a1', 'AHU-ANC09-GF-01', 'Supply temp high'), al('@a2', 'AHU-ANC09-GF-01', 'Filter dirty')]
  d.poll(payload)
  d.site.alarms[0].ack = { time: '08:05', who: 'MK' }
  const acked = d.site.alarms[0].id
  for (let i = 0; i < 3; i++) d.poll([...payload].reverse())
  eq(d.site.alarms.filter(a => a.ack).map(a => a.id), [acked])
  assert.strictEqual(d.site.alarms.length, 2, 'repeated polls do not add alarms')
})

test('dashboard: an alarm FIN sent no id for gets a stable id from what it is', () => {
  const d = dashboard()
  const x = al(null, 'AHU-ANC09-GF-01', 'Supply temp high')
  d.poll([al('@z', 'AHU-ANC09-GF-02', 'Other'), x])
  const id = d.site.alarms.find(a => a.plainEn === 'Supply temp high').id
  d.poll([x])
  assert.strictEqual(d.site.alarms[0].id, id)
})

console.log(`\n${passed} alarm dedup tests passed` + (failed ? `, ${failed} FAILED` : ''))
if (failed) process.exit(1)
