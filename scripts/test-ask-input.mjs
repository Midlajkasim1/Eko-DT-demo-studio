// The Ask EKO panel is rebuilt by every app render (live data, notifications, an answer arriving). Typing must survive that, a
// message is cleared from the input only when it is sent, and a reader who scrolled up must not be pulled back to the bottom.
// Runs the real static/dashboard/js/ai/ask.js against a tiny fake DOM that replaces the panel's elements on every render the way
// the app does (new input with no value, new message list at scrollTop 0). Plain node, no browser, no backend.
// Run: npm run test:askinput
import assert from 'node:assert'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const src = fs.readFileSync(fileURLToPath(new URL('../static/dashboard/js/ai/ask.js', import.meta.url)), 'utf8')
const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function harness() {
  const listeners = {}                       // type -> [{ fn, opts }]
  const dom = { input: null, box: null, panel: null, boxHeight: 1000 }
  const sent = []
  const document = {
    activeElement: null,
    documentElement: { toggleAttribute() {} },
    addEventListener(type, fn, opts) { (listeners[type] ||= []).push({ fn, opts }) },
    getElementById(id) { return id === 'aipanel' ? dom.panel : id === 'aiin' ? dom.input : null },
    querySelector(sel) { return sel === '#aipanel .aimsgs' ? dom.box : null },
    contains: el => el === dom.input
  }
  const win = {
    document, console, setTimeout, clearTimeout, setInterval, clearInterval, innerWidth: 1280, innerHeight: 800, EKO_LAYOUTS: {},
    localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null }, setItem(k, v) { this._m[k] = String(v) } },
    EKO_C: { esc, icon: () => '' },
    EKO_CHAT: { session: () => ({ send: (q, handlers) => { sent.push({ q, handlers }); return { promise: new Promise(() => {}), abort() {} } } }) }
  }
  win.window = win
  const E = { lang: 'en', state: {}, data: { features: { ask: 'eko-chat' } }, t: k => k, set() { render() } }
  const fire = (type, ev) => (listeners[type] || []).forEach(l => l.fn(ev))

  function newInput(value) {
    const el = { id: 'aiin', value, selectionStart: value.length, selectionEnd: value.length,
      focus() { document.activeElement = el }, blur() { if (document.activeElement === el) document.activeElement = null },
      setSelectionRange(a, b) { el.selectionStart = a; el.selectionEnd = b } }
    return el
  }
  function newBox() {
    let top = 0
    const box = { classList: { contains: c => c === 'aimsgs' }, clientHeight: 300, scrollHeight: dom.boxHeight,
      get scrollTop() { return top }, set scrollTop(v) { top = Math.max(0, Math.min(v, box.scrollHeight - box.clientHeight)) },
      set innerHTML(_) { top = 0; box.scrollHeight = dom.boxHeight } }   // worst case: replacing the content resets the position
    return box
  }
  // what the app does on every render: build the panel's HTML, then replace the elements it describes
  function render() {
    const html = win.EKO_AI.panel(E)
    if (!html) { dom.panel = dom.input = dom.box = null; return }
    const m = /<input id="aiin"[^>]*?value="([^"]*)"/.exec(html)
    const focused = document.activeElement === dom.input
    dom.input = newInput(m ? unesc(m[1]) : '')
    dom.box = newBox()
    dom.panel = { style: { setProperty() {} }, querySelector: s => (s === '.aimsgs' ? dom.box : s === '#aiin' ? dom.input : null) }
    if (focused) document.activeElement = null   // the old, focused element is gone
    win.EKO_AI.after()
  }
  vm.runInNewContext(src, win, { filename: 'ask.js' })
  const AI = win.EKO_AI
  AI.wire(E)
  AI.open(null)
  render()
  return {
    AI, E, dom, sent, listeners, render, fire, document,
    type(text) { for (const ch of text) { dom.input.value += ch; dom.input.selectionStart = dom.input.selectionEnd = dom.input.value.length; fire('input', { target: dom.input }) } },
    paste(text) { dom.input.value += text; fire('input', { target: dom.input }) },
    scrollTo(top) { dom.box.scrollTop = top; fire('scroll', { target: dom.box }) },
    enter(isComposing = false) { let prevented = false; fire('keydown', { key: 'Enter', isComposing, target: dom.input, preventDefault() { prevented = true } }); return prevented }
  }
}

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('ok  ' + name) }

test('typing is kept when the app re-renders in the middle of it, and the caret stays where it was', () => {
  const h = harness()
  assert.equal(document_active(h), h.dom.input, 'the opened panel focuses its input')
  h.type('show ')
  h.render()                                   // a live-data refresh
  assert.equal(h.dom.input.value, 'show ')
  assert.equal(h.document.activeElement, h.dom.input, 'focus is back on the new input')
  assert.equal(h.dom.input.selectionStart, 5)
  h.type('alarms')
  h.render(); h.render()
  assert.equal(h.dom.input.value, 'show alarms')
})
function document_active(h) { return h.document.activeElement }

test('pasted text is kept the same way', () => {
  const h = harness()
  h.paste('List all equipment in the currently selected project.')
  h.render()
  assert.equal(h.dom.input.value, 'List all equipment in the currently selected project.')
})

test('quotes and angle brackets in the draft survive a render without being interpreted', () => {
  const h = harness()
  h.type('say "hi" <b>& \'x\'')
  h.render()
  assert.equal(h.dom.input.value, 'say "hi" <b>& \'x\'')
})

test('the next question typed while an answer is still arriving is not wiped when the answer finishes', () => {
  const h = harness()
  h.type('first'); h.enter()
  assert.equal(h.sent.length, 1)
  h.type('second qu')                           // typing during the stream
  h.E.set({})                                   // the render that ends the stream
  assert.equal(h.dom.input.value, 'second qu')
})

test('the input is emptied when a message is sent, and only then', () => {
  const h = harness()
  h.type('   ')
  h.AI.ACTS.aiSend()
  assert.equal(h.sent.length, 0, 'blank text is not sent')
  assert.equal(h.dom.input.value, '   ', 'and is not cleared')
  h.dom.input.value = ''; h.type('how many alarms')
  h.render()
  assert.equal(h.dom.input.value, 'how many alarms', 'a render does not send or clear it')
  h.AI.ACTS.aiSend()
  assert.deepEqual(h.sent.map(s => s.q), ['how many alarms'])
  assert.equal(h.dom.input.value, '')
  h.render()
  assert.equal(h.dom.input.value, '', 'and it stays empty after the next render')
})

test('Enter sends once; a second Enter, or the button after it, sends nothing more', () => {
  const h = harness()
  h.type('list all equipment')
  assert.equal(h.enter(), true)
  assert.equal(h.enter(), false)
  h.AI.ACTS.aiSend()
  assert.equal(h.sent.length, 1)
})

test('Enter while an input method is composing does not send', () => {
  const h = harness()
  h.type('مرحبا')
  h.enter(true)
  assert.equal(h.sent.length, 0)
  assert.equal(h.dom.input.value, 'مرحبا')
})

test('wiring twice adds no second set of listeners', () => {
  const h = harness()
  const counts = () => Object.fromEntries(Object.entries(h.listeners).map(([k, v]) => [k, v.length]))
  const before = counts()
  h.AI.wire(h.E); h.AI.wire(h.E)
  assert.deepEqual(counts(), before)
  assert.equal(before.scroll, 1)
  assert.ok(h.listeners.scroll[0].opts && h.listeners.scroll[0].opts.capture, 'scroll does not bubble: it is heard in the capture phase')
  h.type('x'); h.enter()
  assert.equal(h.sent.length, 1, 'one Enter, one message')
})

// ── the message list ──
const openWithMessages = () => {
  const h = harness()
  h.dom.boxHeight = 1000
  h.type('hello'); h.enter()                    // the first turn; the list now has content taller than its box
  h.render()
  return h
}

test('a list at the bottom follows the newest content when it grows', () => {
  const h = openWithMessages()
  assert.equal(h.dom.box.scrollTop, 700)       // 1000 - 300: the bottom
  h.dom.boxHeight = 1400                       // the answer streams in and the list gets taller
  h.sent[0].handlers.tool({ tool: 'find_equipment', status: 'running' })
  assert.equal(h.dom.box.scrollTop, 1100, 'still at the bottom')
})

test('scrolled up, the reader keeps their place through renders and streamed updates', () => {
  const h = openWithMessages()
  h.scrollTo(200)
  h.render(); h.render()                       // polling and unrelated renders
  assert.equal(h.dom.box.scrollTop, 200)
  h.dom.boxHeight = 1400
  h.sent[0].handlers.token({ text: 'more ' })  // an answer streaming in
  h.sent[0].handlers.tool({ tool: 'get_alarms', status: 'running' })
  assert.equal(h.dom.box.scrollTop, 200)
})

test('scrolling back down to the bottom resumes following', () => {
  const h = openWithMessages()
  h.scrollTo(200)
  h.scrollTo(700)
  h.dom.boxHeight = 1300
  h.sent[0].handlers.token({ text: 'x' })
  assert.equal(h.dom.box.scrollTop, 1000)
})

test('sending a message brings the reader to the bottom even if they had scrolled up', () => {
  const h = openWithMessages()
  h.scrollTo(100)
  h.type('and now'); h.enter()
  h.dom.boxHeight = 1200
  h.render()
  assert.equal(h.dom.box.scrollTop, 900)
})

test('opening a conversation, or a new one, starts at the newest turn', () => {
  const h = openWithMessages()
  h.scrollTo(50)
  h.AI.ACTS.aiNew()
  h.dom.boxHeight = 800
  h.render()
  assert.equal(h.dom.box.scrollTop, 500)
})

console.log(`\n${passed} passed`)
