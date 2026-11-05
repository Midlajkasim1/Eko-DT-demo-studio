import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// A message of several questions comes back from Eko-Chat as parts, in the order asked, each with its own status. These tests run the dashboard's real
// renderer (cut out of ai/ask.js: the safe Markdown, the parts and the turn view) over its real English and Arabic tables, with no browser and no backend.
// What the backend sends is checked by backend/tests/test_eko_chat_multi.py.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const js = p => fs.readFileSync(path.join(root, 'static/dashboard/js', p), 'utf8')
const SRC = js('ai/ask.js')

function tableOf(lang) {
  const win = { EKO_I18N: {} }
  vm.runInNewContext(js(`i18n/${lang}.js`), { window: win })
  return win.EKO_I18N[lang]
}
const TABLES = { en: tableOf('en'), ar: tableOf('ar') }

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** the turn view exactly as ai/ask.js has it, over a real translation table; S.streaming is the only state it reads for an answer */
function view(lang, streaming = null) {
  const table = TABLES[lang]
  const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (_, n) => (p && p[n] != null ? p[n] : `{${n}}`))
  const t = (k, p) => fill(table[k] ?? k, p)
  const tOr = (k, fb, p) => (k in table ? fill(table[k], p) : fb)
  const a = SRC.indexOf('function cardHeadline(')
  const b = SRC.indexOf('function msgsHtml(')
  assert.ok(a > 0 && b > a, 'the turn view is in ask.js')
  const S = { streaming, fbOpen: null }
  const env = {
    esc, t, tOr, S, icon: () => '', hhmm: iso => `T(${iso})`, figsHtml: () => '', evidenceHtml: () => '',
    cardText: x => String(x), cardCell: x => String(x), filtersText: () => '',
  }
  return new Function(...Object.keys(env), SRC.slice(a, b) + '\nreturn { partsHtml, turnHtml, mdHtml }')(...Object.values(env))
}

const PARTS = [
  { question: 'How many assets are there', status: 'answered', answer: 'Equipment items: 3.', as_of: '2026-11-04T10:00:00', card: { headline: 'CARD-ONE' } },
  { question: 'humidity', status: 'unavailable', reason: 'metric_unavailable', answer: 'Humidity: no point is mapped.', card: { headline: 'CARD-NEVER' } },
  { question: 'switch to dark mode', status: 'unsupported', reason: 'planned', answer: 'Not supported yet.' },
  { question: 'CO2', status: 'failed', reason: 'request_timeout', answer: 'Not answered: the time limit was reached.' },
]
const sections = html => [...html.matchAll(/<section class="aipart" data-status="([a-z]+)">/g)].map(m => m[1])

test('one section per part, in the order asked, numbered, with its own heading and answer', () => {
  const html = view('en').partsHtml(PARTS, 'ekoHospital')
  assert.deepEqual(sections(html), ['answered', 'unavailable', 'unsupported', 'failed'])
  const heads = [...html.matchAll(/<span class="aipartn">(\d+)<\/span><span class="aipartq">([^<]*)<\/span>/g)].map(m => [m[1], m[2]])
  assert.deepEqual(heads, [['1', 'How many assets are there'], ['2', 'humidity'], ['3', 'switch to dark mode'], ['4', 'CO2']])
  for (const answer of ['Equipment items: 3.', 'Humidity: no point is mapped.', 'Not supported yet.', 'Not answered: the time limit was reached.']) {
    assert.equal(html.split(answer).length - 1, 1, `${answer} appears once`)
  }
})

test('only a part that was not answered carries a status label, and only an answered part shows its card and its source', () => {
  const html = view('en').partsHtml(PARTS, 'ekoHospital')
  assert.deepEqual([...html.matchAll(/<span class="aipartst" data-status="([a-z]+)">([^<]*)<\/span>/g)].map(m => [m[1], m[2]]),
    [['unavailable', 'Unavailable'], ['unsupported', 'Not supported'], ['failed', 'Failed']])
  assert.ok(html.includes('CARD-ONE') && !html.includes('CARD-NEVER'), 'the card of an unavailable part is not shown')
  assert.equal((html.match(/class="aisrc"/g) || []).length, 1)
  assert.ok(html.includes('From live FIN data · ekoHospital · data as of T(2026-11-04T10:00:00)'))
})

test('the same in Arabic: the labels are Arabic, every line takes its own direction, the questions and answers are left as written', () => {
  const html = view('ar').partsHtml([
    { question: 'كم عدد الأصول؟', status: 'answered', answer: 'عدد المعدات: 3.' },
    { question: 'ما هي الرطوبة؟', status: 'unavailable', answer: 'الرطوبة غير متاحة: لم يتم ربط نقطة.' },
    { question: 'switch to dark mode', status: 'unsupported', answer: 'غير مدعوم بعد.' },
    { question: 'CO2', status: 'failed', answer: 'تعذّر.' },
  ], 'ekoHospital')
  const labels = [...html.matchAll(/<span class="aipartst" data-status="[a-z]+">([^<]*)<\/span>/g)].map(m => m[1])
  assert.deepEqual(labels, [TABLES.ar['ai.part.unavailable'], TABLES.ar['ai.part.unsupported'], TABLES.ar['ai.part.failed']])
  for (const l of labels) assert.match(l, /[؀-ۿ]/)
  assert.ok(html.includes('كم عدد الأصول؟') && html.includes('ما هي الرطوبة؟') && html.includes('عدد المعدات: 3.'))
  assert.equal((html.match(/<h5 class="aiparth" dir="auto">/g) || []).length, 4)
  assert.ok((html.match(/<p dir="auto">/g) || []).length >= 4)
})

test('every status the backend sends has a label in both languages, and an unknown one is shown as failed', () => {
  for (const lang of ['en', 'ar']) for (const s of ['unavailable', 'unsupported', 'failed']) assert.ok(TABLES[lang][`ai.part.${s}`], `${lang} ${s}`)
  const html = view('en').partsHtml([{ question: 'q', status: '"><script>alert(1)</script>', answer: 'a' }], '')
  assert.deepEqual(sections(html), ['failed'])
  assert.ok(!html.includes('<script'))
})

test('hostile text in a question or an answer is escaped, never rendered', () => {
  const html = view('en').partsHtml([{ question: '<img src=x onerror=alert(1)> & <b>', status: 'answered', answer: '<script>alert(1)</script> [x](javascript:alert(1)) **bold**' }], '<i>')
  assert.ok(!/<img|<script|<b>|<a[ >]/i.test(html), html)
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &lt;b&gt;'))
  assert.ok(html.includes('<strong>bold</strong>'))
  assert.ok(!/ href=| onerror=(?!alert)/.test(html))
})

test('nothing is drawn for a message that is not several questions, and junk parts are skipped, not thrown on', () => {
  const { partsHtml } = view('en')
  for (const bad of [null, undefined, [], 'x', 5, {}]) assert.equal(partsHtml(bad, ''), '')
  const html = partsHtml([null, 7, 'x', { question: 'only valid', status: 'answered', answer: 'ok' }], '')
  assert.deepEqual(sections(html), ['answered'])
})

const turn = (a, status = 'ok') => ({ q: { text: 'two things', at: '2026-11-04T10:00:00' }, a: Object.assign({ status, at: '2026-11-04T10:00:01', text: '**1. composed** text', card: null, sources: '' }, a) })

test('a turn with parts shows the parts instead of the flat text: the answers are not repeated', () => {
  const { turnHtml } = view('en')
  const html = turnHtml(turn({ parts: PARTS, project: 'ekoHospital', text: '**1. How many assets are there**\n\nEquipment items: 3.' }), 0)
  assert.equal((html.match(/<section class="aipart"/g) || []).length, 4)
  assert.equal(html.split('Equipment items: 3.').length - 1, 1, 'the composed text is not drawn next to the parts')
  assert.ok(!html.includes('composed'))
  assert.ok(html.includes('class="aitext"') && html.includes('aiturnacts'), 'the usual turn chrome (copy, regenerate, feedback) is kept')
})

test('a turn without parts is drawn as before, and an error or a pending turn never shows parts', () => {
  const { turnHtml, mdHtml } = view('en')
  const single = turnHtml(turn({ parts: null, text: 'There are 3 equipment items.' }), 0)
  assert.ok(single.includes('<div class="aitext"><p dir="auto">There are 3 equipment items.</p></div>'))
  assert.ok(!single.includes('aiparts'))
  const err = turnHtml(turn({ parts: PARTS, errCode: 'request_timeout' }, 'error'), 0)
  assert.ok(err.includes('aierr') && !err.includes('aiparts'))
  assert.equal(mdHtml('**1. x**'), '<p dir="auto"><strong>1. x</strong></p>')
})

test('while streaming the text so far is shown as before, and the parts replace it only once the answer is complete', () => {
  const t0 = turn({ parts: null, shown: 'partial words', status: 'streaming' }, 'streaming')
  const { turnHtml } = view('en', { turn: t0 })
  const live = turnHtml(t0, 0)
  assert.ok(live.includes('partial words') && live.includes('aicaret') && !live.includes('aiparts'))
  Object.assign(t0.a, { parts: PARTS, status: 'ok' })
  assert.ok(view('en').turnHtml(t0, 0).includes('aiparts'))
})

test('the chat client hands the parts of a multi answer to Ask EKO whole, and the dashboard keeps them for the turn', async () => {
  const win = {}
  vm.runInNewContext(js('llm/eko-chat.js'), { window: win, AbortController, TextDecoder, JSON, Object, String, Array, Promise })
  const done = { answer: '**1. q**', grounded: true, route: 'multi', parts: [{ question: 'q', status: 'answered', answer: 'a' }, { question: 'r', status: 'unsupported', answer: 'b' }],
    multi: { count: 2, answered: 1, status: 'partial', needs_planner: false }, project: { id: 'p', name: 'ekoHospital' } }
  const sse = `event: start\ndata: {"model":null,"project":{"id":"p","name":"ekoHospital"}}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close() } })
  let got = null
  const res = await win.EKO_CHAT.ask('q', { done: d => { got = d } }, { fetch: async () => ({ ok: true, status: 200, body }) })
  assert.equal(res.status, 'done')
  assert.deepEqual(JSON.parse(JSON.stringify(got.parts)), done.parts)
  assert.match(SRC, /turn\.a\.parts = Array\.isArray\(d\.parts\) && d\.parts\.length \? d\.parts : null/)
})
