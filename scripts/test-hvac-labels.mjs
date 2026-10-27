// Point labels on the equipment schematic (src/lib/hvacLabels.ts): the text and colour rules, the placement maths on a real THREE
// camera, the declutter, and the label layer's lifecycle on a minimal DOM (no browser, no model, no FIN).
// Run: npm run test:labels
import assert from 'node:assert'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src', import.meta.url))
const out = await build({
  stdin: { contents: "export * from '@/lib/hvacLabels'\nexport * as THREE from 'three'\nexport { readMauPoints, createMauSchematic } from '@/lib/mauSchematic'\nexport { createEcoSchematic } from '@/lib/ecoSchematic'\nexport { createFcuSchematic } from '@/lib/fcuSchematic'", resolveDir: src, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': src }, logLevel: 'silent',
})
const L = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
const { THREE, textOf, toneOf, declutter, projectAnchor, createHvacLabels, readMauPoints, createMauSchematic, createEcoSchematic, createFcuSchematic } = L

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('ok  ' + name) }

// ── a minimal DOM: enough for the layer, and it counts what is written ──
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.className = ''; this._text = ''; this.title = ''; this.parent = null; this.writes = 0; this.offsetWidth = 100; this.offsetHeight = 30 }
  get textContent() { return this._text }
  set textContent(v) { this._text = String(v); this.writes++ }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  toggleAttribute(k, force) { if (force) this.attrs[k] = ''; else delete this.attrs[k] }
  has(k) { return k in this.attrs }
  append(...n) { n.forEach(c => { c.parent = this; this.children.push(c) }) }
  appendChild(c) { this.append(c); return c }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 600 } }
}
const doc = { createElement: tag => new El(tag) }
const host = () => new El('div')

// ── a schematic-like object on a real THREE group ──
const makeSchematic = (anchors, at = [0, 0, 0]) => {
  const group = new THREE.Group()
  group.position.set(...at)
  group.updateMatrixWorld(true)
  return { group, anchors, apply: () => ({}), tick() {}, dispose() {} }
}
const A = (key, title, x, side = 'above', y = 0.5) => ({ key, title, position: new THREE.Vector3(x, y, 0), side })
const camera = () => {
  const c = new THREE.PerspectiveCamera(50, 1000 / 600, 0.1, 100)
  c.position.set(0, 0, 10); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); c.updateProjectionMatrix()
  return c
}
const canvas = { left: 0, top: 0, width: 1000, height: 600 }

test('the text of a label is the reading\'s own text, and "—" when FIN sent nothing', () => {
  assert.strictEqual(textOf({ sfStatus: 'On' }, 'sfStatus'), 'On')
  assert.strictEqual(textOf({ saTemp: ' 21.5 °C ' }, 'saTemp'), '21.5 °C')
  for (const reading of [{}, { a: '' }, { a: '   ' }, { a: null }, undefined, null, 'x', 7]) assert.strictEqual(textOf(reading, 'a'), '—')
  assert.strictEqual(textOf({ n: 0 }, 'n'), '0', 'zero is a value')
})

test('colour follows the text FIN gave: no value is grey, a fault-like state is red, anything else is the blue status', () => {
  assert.strictEqual(toneOf('—'), 'none')
  for (const t of ['Dirty', 'Trip', 'Alarm', 'fault', 'Trip (SF)']) assert.strictEqual(toneOf(t), 'warn', t)
  for (const t of ['On', 'Off', 'Open', 'Closed', 'Clean', 'Normal', '21.5 °C', '40 %']) assert.strictEqual(toneOf(t), 'ok', t)
})

test('declutter: the first label wins, an overlapping one is dropped, a gap keeps both, off-screen is never shown', () => {
  const r = (x, y = 0, on = true) => ({ x, y, w: 100, h: 30, on })
  assert.deepStrictEqual(declutter([r(0), r(50), r(200)]), [true, false, true])
  assert.deepStrictEqual(declutter([r(0), r(103)]), [true, false], 'closer than the 6px gap')
  assert.deepStrictEqual(declutter([r(0), r(110)]), [true, true], 'clear of the gap')
  assert.deepStrictEqual(declutter([r(0), r(0, 60)]), [true, true], 'above each other, clear of each other')
  assert.deepStrictEqual(declutter([r(0, 0, false), r(0)]), [false, true], 'an off-screen label takes no room')
  assert.deepStrictEqual(declutter([r(50), r(0)]), [true, false], 'the order given decides, not the position: no flicker as the camera moves')
})

test('an anchor lands where the camera sees it: the centre on the canvas centre, a moved group moves it, behind the camera is nothing', () => {
  const s = makeSchematic([])
  const c = camera()
  const mid = projectAnchor(c, s.group, new THREE.Vector3(0, 0, 0), canvas, { left: 0, top: 0 })
  assert.ok(Math.abs(mid.x - 500) < 0.5 && Math.abs(mid.y - 300) < 0.5, JSON.stringify(mid))
  const right = projectAnchor(c, s.group, new THREE.Vector3(2, 0, 0), canvas, { left: 0, top: 0 })
  assert.ok(right.x > 500 && Math.abs(right.y - 300) < 0.5, 'to the right of the centre')
  const up = projectAnchor(c, s.group, new THREE.Vector3(0, 1, 0), canvas, { left: 0, top: 0 })
  assert.ok(up.y < 300, 'screen y grows downward: higher in the world is higher on the page')
  s.group.position.set(2, 0, 0); s.group.updateMatrixWorld(true)
  const moved = projectAnchor(c, s.group, new THREE.Vector3(0, 0, 0), canvas, { left: 0, top: 0 })
  assert.ok(Math.abs(moved.x - right.x) < 0.5, 'the anchor is local to its group')
  assert.strictEqual(projectAnchor(c, s.group, new THREE.Vector3(0, 0, 20), canvas, { left: 0, top: 0 }), null, 'behind the camera')
  assert.strictEqual(projectAnchor(c, s.group, new THREE.Vector3(500, 0, 0), canvas, { left: 0, top: 0 }), null, 'far off screen')
  // the canvas not at the page's corner, the host somewhere else: pixels are the host's own
  const p = projectAnchor(c, makeSchematic([]).group, new THREE.Vector3(0, 0, 0), { left: 340, top: 52, width: 1000, height: 600 }, { left: 100, top: 20 })
  assert.ok(Math.abs(p.x - (500 + 240)) < 0.5 && Math.abs(p.y - (300 + 32)) < 0.5, JSON.stringify(p))
})

test('one label per anchor, titled with the FIN point, valued from the reading, and never doubled by showing again', () => {
  const h = host()
  const labels = createHvacLabels(() => h, '—', doc)
  const s = makeSchematic([A('sfStatus', 'SF_VFD_RUN_STS', -1, 'below'), A('saTemp', 'SA_TEMP', 1)])
  labels.show(s, { sfStatus: 'On', saTemp: '21.5 °C' })
  assert.strictEqual(labels.count, 2)
  assert.strictEqual(h.children.length, 2)
  const [fan, temp] = h.children
  assert.deepStrictEqual([fan.children[0].textContent, fan.children[1].textContent, fan.getAttribute('data-side')], ['SF_VFD_RUN_STS', 'On', 'below'])
  assert.deepStrictEqual([temp.children[0].textContent, temp.children[1].textContent], ['SA_TEMP', '21.5 °C'])
  assert.strictEqual(fan.children[1].getAttribute('data-tone'), 'ok')
  for (let i = 0; i < 5; i++) labels.show(s, { sfStatus: 'On' })                     // the same selection again, and again
  assert.strictEqual(h.children.length, 2, 'repeated show leaves two labels, not twelve')
  assert.strictEqual(h.children[1].children[1].textContent, '—', 'a point FIN did not send says so: no invented value')
  assert.strictEqual(h.children[1].children[1].getAttribute('data-tone'), 'none')
})

test('a changed reading rewrites only the text that changed', () => {
  const h = host()
  const labels = createHvacLabels(() => h, '—', doc)
  labels.show(makeSchematic([A('a', 'A', -1), A('b', 'B', 1)]), { a: 'Off', b: 'Clean' })
  const [a, b] = h.children.map(e => e.children[1])
  const before = [a.writes, b.writes]
  labels.setReading({ a: 'Off', b: 'Clean' })
  assert.deepStrictEqual([a.writes, b.writes], before, 'the same reading writes nothing')
  labels.setReading({ a: 'On', b: 'Clean' })
  assert.deepStrictEqual([a.textContent, a.writes - before[0], b.writes - before[1]], ['On', 1, 0])
  labels.setReading({ a: 'On', b: 'Dirty' })
  assert.strictEqual(b.getAttribute('data-tone'), 'warn', 'a fault-like state turns red')
  assert.ok(h.children[1].title.includes('Dirty'))
})

test('update puts "above" labels over their anchor and "below" labels under it, centred, and keeps them there as the camera moves', () => {
  const h = host()
  const labels = createHvacLabels(() => h, '—', doc)
  labels.show(makeSchematic([A('u', 'UP', -3, 'above'), A('d', 'DOWN', 3, 'below')]), { u: 'On', d: 'Off' })
  const c = camera()
  labels.update(c, canvas)
  const [up, down] = h.children
  const pos = el => { const m = el.style.transform.match(/translate\((-?\d+)px, (-?\d+)px\)/); return { x: +m[1], y: +m[2] } }
  const anchorUp = projectAnchor(c, new THREE.Group(), new THREE.Vector3(-3, 0.5, 0), canvas, { left: 0, top: 0 })
  const anchorDown = projectAnchor(c, new THREE.Group(), new THREE.Vector3(3, 0.5, 0), canvas, { left: 0, top: 0 })
  assert.strictEqual(up.getAttribute('data-shown'), '1')
  assert.ok(pos(up).y + 30 < anchorUp.y, 'the above label ends over its anchor')
  assert.ok(Math.abs(pos(up).x + 50 - anchorUp.x) <= 1, 'centred on it')
  assert.ok(pos(down).y > anchorDown.y, 'the below label starts under its anchor')
  // zoom out: everything moves toward the centre, still on its anchor
  c.position.set(0, 0, 20); c.updateMatrixWorld(true)
  labels.update(c, canvas)
  const zoomedOut = projectAnchor(c, new THREE.Group(), new THREE.Vector3(-3, 0.5, 0), canvas, { left: 0, top: 0 })
  assert.ok(Math.abs(pos(up).x + 50 - zoomedOut.x) <= 1, 'still centred on its anchor')
  assert.ok(Math.abs(zoomedOut.x - 500) < Math.abs(anchorUp.x - 500), 'and the anchor is nearer the centre than before')
})

test('labels that would cover each other are not all drawn, and come back when there is room', () => {
  const h = host()
  const labels = createHvacLabels(() => h, '—', doc)
  labels.show(makeSchematic([A('a', 'A', 0), A('b', 'B', 0.3), A('c', 'C', 4)]), { a: '1', b: '2', c: '3' })
  const c = camera()
  labels.update(c, canvas)
  assert.deepStrictEqual(h.children.map(e => e.getAttribute('data-shown')), ['1', '0', '1'], 'the near-identical pair shows one')
  c.position.set(0, 0, 1.3); c.updateMatrixWorld(true)
  labels.update(c, canvas)
  assert.deepStrictEqual(h.children.slice(0, 2).map(e => e.getAttribute('data-shown')), ['1', '1'], 'zoomed in, both fit')
})

test('an anchor behind the camera or off screen has no label drawn', () => {
  const h = host()
  const labels = createHvacLabels(() => h, '—', doc)
  labels.show(makeSchematic([A('a', 'A', 0), A('b', 'B', 900)]), { a: 'x', b: 'y' })
  labels.update(camera(), canvas)
  assert.deepStrictEqual(h.children.map(e => e.getAttribute('data-shown')), ['1', '0'])
  const behind = camera(); behind.position.set(0, 0, -10); behind.lookAt(0, 0, -20); behind.updateMatrixWorld(true); behind.updateProjectionMatrix()
  labels.update(behind, canvas)
  assert.deepStrictEqual(h.children.map(e => e.getAttribute('data-shown')), ['0', '0'], 'looking away from the equipment')
})

test('hiding the labels hides only the layer; showing again restores them with nothing duplicated; clear removes them', () => {
  const h = host()
  const labels = createHvacLabels(() => h, '—', doc)
  const s = makeSchematic([A('a', 'A', -1), A('b', 'B', 1)])
  labels.show(s, { a: 'On', b: 'Off' })
  labels.setVisible(false)
  assert.ok(h.has('data-off'), 'the layer is switched off')
  assert.strictEqual(h.children.length, 2, 'the labels and their text are kept')
  labels.update(camera(), canvas)                                    // nothing is positioned while hidden
  assert.strictEqual(h.children[0].getAttribute('data-shown'), null)
  for (let i = 0; i < 6; i++) { labels.setVisible(false); labels.setVisible(true) }
  assert.ok(!h.has('data-off'))
  assert.strictEqual(h.children.length, 2, 'toggling six times makes no extra labels')
  labels.update(camera(), canvas)
  assert.strictEqual(h.children[0].getAttribute('data-shown'), '1')
  // shown while hidden: still off until switched on
  labels.setVisible(false)
  labels.show(s, { a: 'On', b: 'Off' })
  assert.ok(h.has('data-off') && h.children.length === 2)
  labels.clear()
  assert.deepStrictEqual([labels.count, h.children.length], [0, 0])
})

test('no host, or a schematic with no anchors, is simply no labels', () => {
  const none = createHvacLabels(() => null, '—', doc)
  none.show(makeSchematic([A('a', 'A', 0)]), {})
  assert.strictEqual(none.count, 0)
  none.update(camera(), canvas); none.setReading({}); none.setVisible(false); none.clear()
  const h = host()
  const labels = createHvacLabels(() => h, '—', doc)
  labels.show({ group: new THREE.Group(), apply: () => ({}), tick() {}, dispose() {} }, {})
  assert.strictEqual(labels.count, 0)
})

test('real MAHU readings: the label text comes from FIN\'s points, a missing point reads "—", never a guessed value', () => {
  const pts = [
    { navName: 'SF_VFD_RUN_STS', currentValue: 'T' }, { navName: 'SA_TEMP', currentValue: '21.5' },
    { navName: 'BAG_FILTER', currentValue: 'F' }, { navName: 'PRE_FILTER', currentValue: 'T' },
  ]
  const r = readMauPoints(pts)
  assert.deepStrictEqual([r.sfStatus, r.saTemp, r.bagFilter, r.preFilter], ['On', '21.5 °C', 'Clean', 'Dirty'])
  const none = readMauPoints([])
  assert.deepStrictEqual([textOf(none, 'sfStatus'), textOf(none, 'saTemp'), textOf(none, 'faDamper')], ['—', '—', '—'])
})

// ── ECO (FIN: ECO-ANC09-BF-01) and the other types, on the real schematics with synthetic FIN points ──
const ecoBox = () => new THREE.Box3(new THREE.Vector3(-2, 0, -0.9), new THREE.Vector3(2, 1.6, 0.9))
const eco = () => createEcoSchematic(ecoBox(), new THREE.Matrix4())
const P = (navName, currentValue) => ({ navName, currentValue, reporting: true })
const ecoPts = (over = {}) => Object.entries({ PRE_FILTER: 'F', BAG_FILTER: 'F', BOX_FILTER: 'F', '1ST_STAGE_UV_ALARM': 'F', '2ND_STAGE_UV_ALARM': 'F', KEF_ON_STS: 'T', KEF_TRIP_STS: 'F', ...over }).map(([k, v]) => P(k, v))
const bodyOf = h => Object.fromEntries(h.children.map(l => [l.children[0].textContent, { val: l.children[1].textContent, tone: l.children[1].getAttribute('data-tone') }]))

test('ECO: a label for each filter, both UV stages and the fan, titled with its FIN point, anchored inside the unit in airflow order', () => {
  const s = eco(), a = Object.fromEntries(s.anchors.map(x => [x.key, x]))
  assert.deepStrictEqual(s.anchors.map(x => x.title).sort(), ['1ST_STAGE_UV_ALARM', '2ND_STAGE_UV_ALARM', 'BAG_FILTER', 'BOX_FILTER', 'KEF_ON_STS', 'PRE_FILTER'])
  s.group.updateMatrixWorld(true)
  for (const x of s.anchors) {
    const w = x.position.clone().applyMatrix4(s.group.matrixWorld)
    assert.ok(w.x >= -2 && w.x <= 2 && w.y >= -1.6 && w.y <= 1.6 && Math.abs(w.z) <= 0.9, x.key + ' is on the unit: ' + JSON.stringify(w))
  }
  assert.ok(a.preFilter.position.x < a.bagFilter.position.x && a.bagFilter.position.x < a.boxFilter.position.x, 'filters follow the airflow')
  assert.ok(a.preFilter.side === 'above' && a.bagFilter.side === 'above' && a.boxFilter.side === 'above')
  assert.ok(a.kefStatus.position.x > a.boxFilter.position.x, 'the fan is downstream of the filters')
  assert.strictEqual(new Set(s.anchors.map(x => x.position.x.toFixed(3) + x.side)).size, s.anchors.length, 'no two labels share a spot')
})

test('ECO alarm transitions: normal -> alarm -> cleared, from the FIN points alone; an acknowledgement is not a FIN point and changes nothing', () => {
  const s = eco(), h = host(), labels = createHvacLabels(() => h, '—', doc)
  labels.show(s, s.apply(ecoPts()))
  let b = bodyOf(h)
  assert.deepStrictEqual([b.BAG_FILTER, b['1ST_STAGE_UV_ALARM'], b.KEF_ON_STS].map(x => x.val + '/' + x.tone), ['Clean/ok', 'Normal/ok', 'On/ok'])
  const alarm = { BAG_FILTER: 'T', '1ST_STAGE_UV_ALARM': 'T', PRE_FILTER: 'T' }
  labels.setReading(s.apply(ecoPts(alarm)))
  b = bodyOf(h)
  assert.deepStrictEqual([b.BAG_FILTER, b['1ST_STAGE_UV_ALARM'], b.PRE_FILTER, b.BOX_FILTER].map(x => x.val + '/' + x.tone), ['Dirty/warn', 'Alarm/warn', 'Dirty/warn', 'Clean/ok'], 'only the components in alarm turn red')
  const before = h.children.map(l => l.children[1].writes)
  labels.setReading(s.apply(ecoPts(alarm)))   // acknowledged: FIN still reports the same
  assert.deepStrictEqual(h.children.map(l => l.children[1].writes), before, 'still active: nothing rewritten')
  labels.setReading(s.apply(ecoPts()))
  b = bodyOf(h)
  assert.ok(Object.values(b).every(x => x.tone === 'ok') && h.children.length === 6, 'cleared: back to normal, still six labels')
})

test('ECO: a missing point reads "—" on its own label only; the rest keep their values', () => {
  const s = eco(), h = host(), labels = createHvacLabels(() => h, '—', doc)
  labels.show(s, s.apply(ecoPts().filter(p => p.navName !== 'BOX_FILTER')))
  const b = bodyOf(h)
  assert.deepStrictEqual([b.BOX_FILTER.val, b.BOX_FILTER.tone, b.BAG_FILTER.val], ['—', 'none', 'Clean'])
  labels.show(s, s.apply([]))   // no live data at all
  assert.ok(h.children.length === 6 && Object.values(bodyOf(h)).every(x => x.val === '—'), 'no data: six "—" labels, nothing invented, no throw')
})

test('other types keep their own labels: ECO\'s components are not applied to the MAHU or the FCU', () => {
  const mau = createMauSchematic(ecoBox(), new THREE.Matrix4()), fcu = createFcuSchematic(new THREE.Box3(new THREE.Vector3(-0.6, 0, -0.3), new THREE.Vector3(0.6, 0.3, 0.3)), new THREE.Matrix4())
  const only = ['BOX_FILTER', 'KEF_ON_STS', '1ST_STAGE_UV_ALARM', '2ND_STAGE_UV_ALARM']
  for (const [name, s] of [['MAHU', mau], ['FCU', fcu]]) {
    const titles = s.anchors.map(x => x.title)
    assert.ok(titles.length > 0 && !titles.some(t => only.includes(t)), name + ': ' + titles.join(','))
  }
  assert.ok(fcu.anchors.map(x => x.title).includes('ZONE_TEMP') && mau.anchors.map(x => x.title).includes('SF_VFD_RUN_STS'))
})

test('two units at once: each has its own layer and labels; hiding or clearing one leaves the other', () => {
  const s1 = eco(), s2 = createMauSchematic(ecoBox(), new THREE.Matrix4()), h1 = host(), h2 = host()
  const l1 = createHvacLabels(() => h1, '—', doc), l2 = createHvacLabels(() => h2, '—', doc)
  l1.show(s1, s1.apply(ecoPts())); l2.show(s2, s2.apply([]))
  const n2 = h2.children.length
  assert.ok(h1.children.length === 6 && n2 > 0 && h1.children.length !== n2)
  l1.setVisible(false); assert.ok(h1.has('data-off') && !h2.has('data-off'))
  l1.clear(); assert.ok(h1.children.length === 0 && h2.children.length === n2)
})

test('a schematic with fewer components than the type usually has gets only those labels', () => {
  const s = createEcoSchematic(ecoBox(), new THREE.Matrix4(), undefined, { filters: ['PRE_FILTER'] }), h = host(), labels = createHvacLabels(() => h, '—', doc)
  labels.show(s, s.apply(ecoPts()))
  const t = h.children.map(l => l.children[0].textContent)
  assert.ok(t.includes('PRE_FILTER') && !t.includes('BAG_FILTER') && !t.includes('BOX_FILTER'), t.join(','))
})

console.log(`\n${passed} hvac-label tests passed`)
