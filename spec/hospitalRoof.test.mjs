import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The Hospital roof HVAC graphic's logic (static/dashboard/js/layouts/hospital-roof.js), with no browser, no FIN and no model.
// The feed below is TEST INPUT shaped like the dashboard's equipment feed (asset id + points with navName / currentValue / reporting).
// It is not a FIN export: no roof equipment or point list is in this repository, so what is checked here is the RULES (a state is
// taken only from confirmed equipment and an exactly matching, reporting, well-formed point), not FIN's real names.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const source = read('static/dashboard/js/layouts/hospital-roof.js')
const mod = { exports: {} }
new Function('module', source)(mod)
const R = mod.exports

const pt = (navName, currentValue, extra = {}) => ({ navName, currentValue, text: currentValue, reporting: true, ...extra })
const asset = (id, points, extra = {}) => ({ id, typeEn: 'EQUIPMENT', points, ...extra })
const slots = (map = {}) => R.SLOTS.map(s => ({ ...s, equip: map[s.id] ?? null }))
const ALL = { coolingTower: 'T', condenserPumps: 'CP', chiller: 'C', chilledPumps: 'WP', boiler: 'B', btu: 'BT' }

/** A feed for all six confirmed equipment; `over` replaces points per asset id */
const feed = (over = {}) => ([
  asset('T', over.T ?? [pt('FAN_RUN_STATUS', 'On'), pt('FAN_SPEED', '82'), pt('CW_ENTERING_TEMP', '33.9'), pt('CW_LEAVING_TEMP', '30.4')]),
  asset('CP', over.CP ?? [pt('PUMP1_RUN_STATUS', 'On'), pt('PUMP2_RUN_STATUS', 'On'), pt('PUMP1_SPEED', '100')]),
  asset('C', over.C ?? [pt('RUN_STATUS', 'On'), pt('CHWS_TEMP', '8.8'), pt('CHWR_TEMP', '16.4'), pt('POWER', '94.3'), pt('OPERATING_HOURS', '1018')]),
  asset('WP', over.WP ?? [pt('PUMP1_RUN_STATUS', 'On'), pt('PUMP2_RUN_STATUS', 'Off')]),
  asset('B', over.B ?? [pt('RUN_STATUS', 'On'), pt('HWS_TEMP', '58.2')]),
  asset('BT', over.BT ?? [pt('CHW_FLOW', '11.8'), pt('COOLING_POWER', '172.3')]),
])
const run = (over, opts) => R.model(feed(over), slots(ALL), opts)

test('every slot starts unmapped: nothing is running, nothing flows, no value is read, however the feed is named', () => {
  const m = R.model(feed(), R.SLOTS)   // the shipped mapping: all `equip: null`
  assert.ok(R.SLOTS.every(s => s.equip === null), 'nothing is confirmed without FIN evidence')
  assert.ok(m.slots.every(s => s.state === 'unconfirmed'))
  assert.ok(Object.values(m.parts).every(s => s === 'unmapped'), JSON.stringify(m.parts))
  assert.deepEqual(m.loops, { condenser: 'unknown', chilled: 'unknown', hot: 'unknown' })
  assert.ok(Object.values(m.slotState).every(s => s === 'unmapped'))
  assert.ok(Object.values(m.reads).every(r => r.state === 'unconfirmed' && r.text === '—' && r.raw === null))
  assert.equal(m.mapped, 0)
  assert.equal(m.live, 0)
  const svg = R.svg(m)
  assert.ok(!svg.includes('data-run="on"'), 'no animation is switched on')
  assert.ok(!svg.includes('data-flow="on"'))
})

test('a part runs only when its own run-status point says so: running, stopped, fault, and anything else is unknown', () => {
  const cases = [['On', 'running'], ['Running', 'running'], ['Off', 'stopped'], ['Stopped', 'stopped'], ['Fault', 'fault'], ['Tripped', 'fault'], ['Standby', 'unknown'], ['Auto', 'unknown']]
  for (const [raw, want] of cases) {
    const m = run({ T: [pt('FAN_RUN_STATUS', raw)] })
    assert.equal(m.parts.fan, want, raw)
  }
  // a speed or a command is not a status: a fan with speed 80 and no status point is NOT running
  const noStatus = run({ T: [pt('FAN_SPEED', '80'), pt('FAN_ENABLE_CMD', 'Enable')] })
  assert.equal(noStatus.parts.fan, 'unknown')
  assert.equal(noStatus.slotState.coolingTower, 'unknown')
})

test('each pump is its own part: one can run while the other is stopped', () => {
  const m = run({ WP: [pt('PUMP1_RUN_STATUS', 'On'), pt('PUMP2_RUN_STATUS', 'Off')] })
  assert.deepEqual([m.parts.wp1, m.parts.wp2], ['running', 'stopped'])
  assert.equal(m.slotState.chilledPumps, 'running')
  const both = run({ WP: [pt('PUMP1_RUN_STATUS', 'Off'), pt('PUMP2_RUN_STATUS', 'Off')] })
  assert.equal(both.slotState.chilledPumps, 'stopped')
  const one = run({ WP: [pt('PUMP1_RUN_STATUS', 'Off'), pt('PUMP2_RUN_STATUS', 'Fault')] })
  assert.equal(one.slotState.chilledPumps, 'fault')
})

test('pipe flow follows the pumps: any running pump = flow, all stopped/faulted = none, anything unknown = unknown', () => {
  assert.equal(R.flowOf(['running', 'stopped']), 'on')
  assert.equal(R.flowOf(['stopped', 'stopped']), 'off')
  assert.equal(R.flowOf(['stopped', 'fault']), 'off')
  assert.equal(R.flowOf(['stopped', 'unknown']), 'unknown', 'one pump with no data: flow cannot be ruled out, so it is not drawn as stopped')
  assert.equal(R.flowOf(['stopped', 'unmapped']), 'unknown')
  assert.equal(R.flowOf([]), 'unknown')
  assert.equal(run({ CP: [pt('PUMP1_RUN_STATUS', 'On'), pt('PUMP2_RUN_STATUS', 'Off')] }).loops.condenser, 'on')
  assert.equal(run({ CP: [pt('PUMP1_RUN_STATUS', 'Off'), pt('PUMP2_RUN_STATUS', 'Off')] }).loops.condenser, 'off')
  assert.equal(run({ CP: [pt('PUMP1_RUN_STATUS', 'Off')] }).loops.condenser, 'unknown', 'pump 2 has no status')
})

test('chilled water: a measured flow is the evidence; otherwise the chilled pumps decide; the hot loop follows the boiler', () => {
  const stoppedPumps = [pt('PUMP1_RUN_STATUS', 'Off'), pt('PUMP2_RUN_STATUS', 'Off')]
  assert.equal(run({ WP: stoppedPumps, BT: [pt('CHW_FLOW', '11.8')] }).loops.chilled, 'on', 'measured flow above zero')
  assert.equal(run({ WP: [pt('PUMP1_RUN_STATUS', 'On')], BT: [pt('CHW_FLOW', '0')] }).loops.chilled, 'off', 'measured flow of zero')
  assert.equal(run({ WP: [pt('PUMP1_RUN_STATUS', 'On')], BT: [] }).loops.chilled, 'on', 'no flow point: the pumps decide')
  assert.equal(run({ WP: [], BT: [] }).loops.chilled, 'unknown')
  assert.equal(run({ B: [pt('RUN_STATUS', 'On')] }).loops.hot, 'on')
  assert.equal(run({ B: [pt('RUN_STATUS', 'Off')] }).loops.hot, 'off')
  assert.equal(run({ B: [pt('RUN_STATUS', 'Fault')] }).loops.hot, 'off')
  assert.equal(run({ B: [] }).loops.hot, 'unknown')
})

test('missing, not reporting, empty, invalid, stale and disconnected readings leave a part unknown and flow unknown, never running', () => {
  const unknownFan = over => { const m = run({ T: over }); return [m.parts.fan, m.reads.ctFanRun.state] }
  assert.deepEqual(unknownFan([]), ['unknown', 'no-point'])
  assert.deepEqual(unknownFan([pt('FAN_RUN_STATUS', 'On', { reporting: false })]), ['unknown', 'not-reporting'])
  assert.deepEqual(unknownFan([pt('FAN_RUN_STATUS', null)]), ['unknown', 'no-point'])
  assert.deepEqual(unknownFan([pt('FAN_RUN_STATUS', '--')]), ['unknown', 'no-point'])
  assert.deepEqual(unknownFan([pt('FAN_RUN_STATUS_SP', 'On'), pt('FAN_RUN_STATUS_2', 'On')]), ['unknown', 'no-point'])   // a similar name is not the point

  const stale = R.model(feed().map(a => ({ ...a, st: 'stale' })), slots(ALL))
  assert.equal(stale.parts.fan, 'unknown'); assert.equal(stale.reads.ctFanRun.state, 'stale')
  assert.deepEqual(stale.loops, { condenser: 'unknown', chilled: 'unknown', hot: 'unknown' })

  const off = run({}, { connected: false })
  assert.equal(off.connected, false)
  assert.ok(Object.values(off.reads).every(r => r.state === 'disconnected' && r.text === '—'))
  assert.ok(Object.values(off.parts).every(s => s === 'unknown'))
  assert.deepEqual(off.loops, { condenser: 'unknown', chilled: 'unknown', hot: 'unknown' })

  const gone = R.model([asset('OTHER', [])], slots(ALL))
  assert.ok(gone.slots.every(s => s.state === 'not-in-feed'))
  assert.ok(Object.values(gone.parts).every(s => s === 'unknown'))
})

test('values: formatted by kind, exact names on the confirmed equipment only, ranges enforced', () => {
  const m = run()
  assert.equal(m.reads.ctCwEnter.text, '33.9 °C')
  assert.equal(m.reads.chPower.text, '94.3 kW')
  assert.equal(m.reads.chHours.text, '1018 h')
  assert.equal(m.reads.cpP1Speed.text, '100 %')
  assert.equal(R.fold('FAN_RUN_STATUS'), R.fold('fan-run-status'))
  const bad = run({ T: [pt('CW_ENTERING_TEMP', 'On'), pt('CW_LEAVING_TEMP', '999'), pt('FAN_SPEED', '150')] })
  assert.deepEqual(['ctCwEnter', 'ctCwLeave', 'ctFanSpeed'].map(i => bad.reads[i].state), ['invalid', 'invalid', 'invalid'])
  // another equipment's point of the same name is never read
  const other = R.model([asset('T', []), asset('X', [pt('FAN_RUN_STATUS', 'On')])], slots({ coolingTower: 'T' }))
  assert.equal(other.parts.fan, 'unknown')
  // the confirmed id is matched whole
  const near = R.model([asset('T-011', [pt('FAN_RUN_STATUS', 'On')]), asset('t', [pt('FAN_RUN_STATUS', 'On')])], slots({ coolingTower: 'T-01' }))
  assert.equal(near.slots.find(s => s.id === 'coolingTower').state, 'not-in-feed')
})

test('the BTU meter has no run status: it is online only while one of its own points is live', () => {
  assert.equal(run().parts.btu, 'online')
  assert.equal(run({ BT: [] }).parts.btu, 'unknown')
  assert.equal(R.model(feed(), R.SLOTS).parts.btu, 'unmapped')
})

test('the selected equipment lists only live points, in a useful order; an unmapped one says what is still needed', () => {
  const m = run()
  const html = R.details(m, 'chiller')
  const order = [...html.matchAll(/data-item="(\w+)"/g)].map(x => x[1])
  assert.deepEqual(order, ['chRun', 'chChwsTemp', 'chChwrTemp', 'chHours', 'chPower'], 'status, temperatures, hours, power; absent points are not listed')
  assert.ok(html.includes('data-act="roofAsset"') && html.includes('data-asset="C"'), 'the confirmed equipment links to its asset panel')
  assert.ok(!html.includes('Not mapped'))
  assert.ok(!/ENABLECMD|ALARMSTATUS/.test(html), 'points FIN does not report are not shown as "—" rows')

  const un = R.details(R.model(feed(), R.SLOTS), 'boiler')
  assert.ok(un.includes('Not mapped to a FIN equipment record yet.'))
  for (const cap of ['RUNSTATUS', 'HWSTEMP', 'POWER']) assert.ok(un.includes(cap), cap + ' is named as needed')
  assert.ok(!un.includes('data-act="roofAsset"') && !un.includes('rd-row'), 'no link and no values for an unmapped equipment')

  assert.ok(R.details(R.model([], slots(ALL)), 'chiller').includes('not in the live FIN feed'))
  assert.ok(R.details(run({}, { connected: false }), 'chiller').includes('FIN is disconnected'))
  assert.ok(R.details(run({ C: [] }), 'chiller').includes('none of this equipment'))
  assert.equal(R.details(run(), 'nope'), '')
  // pressure and flow appear only where a point exists and is mapped
  assert.ok(!/pressure/i.test(R.details(run(), 'chiller')))
  assert.ok(R.details(run(), 'btu').includes('Chilled water flow') && R.details(run(), 'btu').includes('11.8 L/s'))
})

test('markup escapes what FIN sends', () => {
  const evil = run({ C: [pt('RUN_STATUS', 'On'), pt('POWER', '<img src=x onerror=alert(1)>'), pt('ENABLE_CMD', '<img src=x onerror=alert(1)>')] })
  assert.ok(!R.details(evil, 'chiller').includes('<img'))
  const quote = R.model([asset('C"><script>', [pt('RUN_STATUS', 'On')])], slots({ chiller: 'C"><script>' }))
  assert.ok(!R.details(quote, 'chiller').includes('<script>'))
  assert.ok(!R.svg(quote).includes('<script>'))
})

test('the drawing is a connected plant, not point tables: six equipment, three coloured loops, rotating parts, flow dashes', () => {
  const svg = R.svg(run())
  assert.equal((svg.match(/<svg /g) || []).length, 1)
  for (const s of R.SLOTS) assert.ok(svg.includes(`data-slot="${s.id}"`), s.id)
  for (const c of ['#2b7fdc', '#35a853', '#e0453a']) assert.ok(svg.includes(`stroke="${c}"`), `a ${c} pipe`)
  for (const l of ['condenser', 'chilled', 'hot']) assert.ok(svg.includes(`data-loop="${l}"`), l)
  assert.ok((svg.match(/class="rf-flow"/g) || []).length >= 7, 'every pipe carries a flow overlay')
  // what turns: the tower fan, four pump impellers and the chiller motor fan; what burns: the boiler flame
  for (const part of ['fan', 'cp1', 'cp2', 'wp1', 'wp2', 'chiller']) {
    const g = svg.match(new RegExp(`<g data-part="${part}" data-run="\\w+">([\\s\\S]*?)(?=<g data-part=|<rect class="rf-hit")`))
    assert.ok(g && g[1].includes('class="rf-rot"'), `${part} has a rotating element`)
  }
  assert.ok(svg.includes('class="rf-flame"'))
  // running parts are drawn running from the first paint
  assert.ok(svg.includes('data-part="fan" data-run="on"') && svg.includes('data-part="cp1" data-run="on"'))
  assert.ok(svg.includes('data-part="wp2" data-run="off"'), 'a stopped pump is drawn stopped')
  // no equipment point tables, point names or mapping section in the main view
  assert.ok(!/FANRUNSTATUS|PUMP1RUNSTATUS|OPERATINGHOURS|COOLINGDEMAND|CWLEAVINGTEMP/.test(svg), 'point names are not on the schematic')
  assert.ok(!/rf-panel|rf-val|roofmap|Mapping status|Candidates|suggestion/i.test(svg))
  assert.ok(!/<foreignObject|<iframe/i.test(svg))
})

test('the drawing shows state, not numbers: chips say RUNNING / STOPPED / FAULT / NO DATA / UNMAPPED / ONLINE, and nothing else per equipment', () => {
  const svg = R.svg(run({ T: [pt('FAN_RUN_STATUS', 'Fault')], WP: [pt('PUMP1_RUN_STATUS', 'On'), pt('PUMP2_RUN_STATUS', 'Off')], B: [] }))
  const chips = Object.fromEntries([...svg.matchAll(/data-chip="(\w+)" data-state="(\w+)"[\s\S]*?<text[^>]*>([^<]*)<\/text>/g)].map(x => [x[1], [x[2], x[3]]]))
  assert.deepEqual(chips.fan, ['fault', 'Fan FAULT'])
  assert.deepEqual(chips.wp1, ['running', 'P1 RUNNING'])
  assert.deepEqual(chips.wp2, ['stopped', 'P2 STOPPED'])
  assert.deepEqual(chips.boiler, ['unknown', 'NO DATA'])
  assert.deepEqual(chips.btu, ['online', 'ONLINE'])
  assert.deepEqual(chips.chiller, ['running', 'RUNNING'])
  assert.equal(Object.keys(chips).length, R.PARTS.length)
  assert.ok(!/\d+(\.\d+)? ?(°C|kW|%|L\/s)/.test(svg.replace(/<text[^>]*>[^<]*(Live|FIN)[^<]*<\/text>/g, '')), 'no measured value is printed on the schematic')
})

test('the mapping tables are well formed: unique ids, known slots, folded names, uncertain reads flagged, nothing confirmed', () => {
  const ids = R.ITEMS.map(r => r.id)
  assert.equal(new Set(ids).size, ids.length)
  const slotIds = R.SLOTS.map(s => s.id)
  for (const it of R.ITEMS) {
    assert.ok(slotIds.includes(it.slot), it.id)
    assert.ok(['temp', 'pct', 'num', 'status', 'text'].includes(it.kind), it.id)
    assert.ok(it.names.length && it.names.every(n => n === R.fold(n)), `${it.id}: names are already folded`)
    assert.ok(it.label && it.cap && it.role, it.id)
  }
  for (const p of R.PARTS) { assert.ok(slotIds.includes(p.slot), p.id); assert.ok(!p.run || ids.includes(p.run), p.id) }
  assert.ok(R.ITEMS.filter(r => r.read === 'uncertain').length > 0, 'names that could not be read with confidence from the photo are marked')
  assert.ok(R.SLOTS.every(s => s.equip === null))
  assert.ok(!('candidates' in R), 'no candidate suggestions in the module')
})

test('the animations are CSS, are paused when a part is not running, and respect reduced motion', () => {
  const css = read('static/dashboard/css/components.css')
  assert.ok(/@keyframes rf-rot[\s\S]*?rotate\(360deg\)/.test(css))
  assert.ok(/\[data-part\]\[data-run="on"\] \.rf-rot \{\s*animation:rf-rot/.test(css), 'rotation only while data-run is on')
  assert.ok(/\.rf-loop\[data-flow="on"\] \.rf-flow \{[^}]*animation:rf-flow/.test(css), 'flow only while the loop is flowing')
  assert.ok(/\.rf-flow \{\s*display:none/.test(css), 'no flow dashes by default')
  assert.ok(/\[data-part="boiler"\]\[data-run="on"\] \.rf-flame/.test(css))
  assert.ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation:none !important/.test(css))
})

test('the module is isolated: no iframe, no network call, no FIN address or record id, no storage, no credentials', () => {
  assert.ok(!/iframe|foreignObject|fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/i.test(source), 'it draws from the feed the dashboard already has')
  assert.ok(!/https?:\/\//.test(source.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '')), 'no URL')
  assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(source), 'no IP address')
  assert.ok(!/@p:|finMobile|fin5|targetRef/.test(source), 'no FIN record or screen reference')
  assert.ok(!/localStorage|sessionStorage|document\.cookie|authToken|Authorization/i.test(source))
  assert.ok(!/Mapping status|roofmap|candidates\(/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')), 'the dashboard-style mapping section is gone')
})

test('the old Hospital roof iframe is gone from the Studio and the dashboard', () => {
  assert.ok(!/HOSPITAL_ROOF_GRAPHIC_PATH|hospitalGraphic|finServerOrigin|DashboardGraphic/.test(read('src/lib/hospitalHvac.ts')))
  assert.ok(!/hospitalGraphics|\.graphics\b/.test(read('src/components/viewer/DashboardOverlay.tsx')))
  const app = read('static/dashboard/js/app.js')
  assert.ok(!/graphicOpen|FRAME_TIMEOUT_MS|docstate|gfx[A-Z]/.test(app))
  assert.ok(/docOpen\(el\)/.test(app) && /function openFramePopup/.test(app), 'the O&M / warranty popup is still there')
  for (const f of ['static/dashboard/js/i18n/en.js', 'static/dashboard/js/i18n/ar.js', 'static/dashboard/js/layouts/grids.js', 'static/dashboard/css/components.css']) {
    assert.ok(!/gfx[A-Z]|graphicOpen|dgfinb|dgfinw|docstate|docerr|roofmap/.test(read(f)), f)
  }
  assert.ok(!fs.existsSync(path.join(root, 'spec/hospitalGraphics.test.mjs')) && !fs.existsSync(path.join(root, 'spec/hospitalGraphics.browser.test.mjs')))
  const pkg = JSON.parse(read('package.json'))
  assert.ok(!/hospitalGraphics/.test(pkg.scripts['test:hospital-hvac'] + pkg.scripts['test:hospital-hvac:browser']))
  assert.ok(pkg.scripts['test:hospital-hvac'].includes('spec/hospitalRoof.test.mjs'))
  assert.ok(pkg.scripts['test:hospital-hvac:browser'].includes('spec/hospitalRoof.browser.test.mjs'))
})
