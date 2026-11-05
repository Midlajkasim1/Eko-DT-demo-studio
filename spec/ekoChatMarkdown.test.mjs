import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// Ask EKO shows the model's answers as Markdown (bold, headings, lists, tables, code). The text is model output, so it is DATA: escaped first, then turned into a
// fixed set of tags. These tests run the dashboard's real renderer (cut out of ai/ask.js) on ordinary answers and on hostile ones, with no browser.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const js = p => fs.readFileSync(path.join(root, 'static/dashboard/js', p), 'utf8')
const SRC = js('ai/ask.js')

// the dashboard's own escaper (components/charts.js): the renderer is given exactly this
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function renderer() {
  const a = SRC.indexOf('/* ---- safe Markdown')
  const b = SRC.indexOf('/* ---- end safe Markdown ---- */')
  assert.ok(a > 0 && b > a, 'the Markdown renderer is in ask.js')
  return new Function('esc', SRC.slice(a, b) + '\nreturn mdHtml')(esc)
}
const md = renderer()

const ALLOWED_TAGS = new Set(['p', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'code', 'strong', 'em'])
const ATTRS = /^(?: dir="(?:auto|ltr)")?(?: class="aimd[a-z]*")?$/

/** every tag in the output is a whitelisted one, with no attribute but our own dir and class; every '<' is a tag or was escaped */
function assertSafe(html, label) {
  const tags = [...html.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g)]
  for (const [, , name, attrs] of tags) {
    assert.ok(ALLOWED_TAGS.has(name.toLowerCase()), `${label}: tag <${name}> is not allowed in ${html}`)
    assert.match(attrs, ATTRS, `${label}: attributes on <${name}>: ${attrs}`)
  }
  assert.equal((html.match(/</g) || []).length, tags.length, `${label}: a '<' that is not one of ours: ${html}`)
  // (the TEXT "javascript:" may be shown, escaped; what must never exist is a tag that could carry it)
  assert.ok(!/<a[ >]|<img|<script|<iframe|<svg|<style|<link|<object|<embed|<form|<input|<button|<details|<math/i.test(html), `${label}: ${html}`)
  assert.ok(!/ href=| src=| on[a-z]+=| style=| srcdoc=/i.test(html.replace(/&[a-z#0-9]+;/gi, '').replace(/>[^<]*</g, '><')), `${label}: an attribute from the text: ${html}`)
}

test('plain text and one line per paragraph are as before, now with a direction of their own', () => {
  assert.equal(md('There are 3 equipment items.'), '<p dir="auto">There are 3 equipment items.</p>')
  assert.equal(md('first line\nsecond line\n\nthird'), '<p dir="auto">first line</p><p dir="auto">second line</p><p dir="auto">third</p>')
  assert.equal(md(''), '')
  assert.equal(md(null), '')
  assert.equal(md('Tom & "Jerry"'), '<p dir="auto">Tom &amp; &quot;Jerry&quot;</p>')
})

test('bold, italic and inline code', () => {
  assert.equal(md('**Assets:** 3 and *two* more and _one_ too'), '<p dir="auto"><strong>Assets:</strong> 3 and <em>two</em> more and <em>one</em> too</p>')
  assert.equal(md('use `avg_zone_temp` here'), '<p dir="auto">use <code>avg_zone_temp</code> here</p>')
  assert.equal(md('**not `bold` code**'), '<p dir="auto"><strong>not <code>bold</code> code</strong></p>')
})

test('names with underscores and a lone asterisk are left as written', () => {
  assert.equal(md('map avg_zone_temp and avg_zone_temp_sp under Live Points'), '<p dir="auto">map avg_zone_temp and avg_zone_temp_sp under Live Points</p>')
  assert.equal(md('snake_case_word and 5 * 3 * 2'), '<p dir="auto">snake_case_word and 5 * 3 * 2</p>')
  assert.equal(md('an unfinished **bold'), '<p dir="auto">an unfinished **bold</p>')
})

test('headings become h4 to h6, never h1', () => {
  assert.equal(md('# Title'), '<h4 dir="auto" class="aimdh">Title</h4>')
  assert.equal(md('### Third'), '<h5 dir="auto" class="aimdh">Third</h5>')
  assert.equal(md('###### Sixth'), '<h6 dir="auto" class="aimdh">Sixth</h6>')
  assert.equal(md('#not a heading'), '<p dir="auto">#not a heading</p>')
})

test('lists, bulleted and numbered', () => {
  assert.equal(md('- one\n- **two**\n* three'), '<ul class="aimdl"><li dir="auto">one</li><li dir="auto"><strong>two</strong></li><li dir="auto">three</li></ul>')
  assert.equal(md('1. first\n2) second'), '<ol class="aimdl"><li dir="auto">first</li><li dir="auto">second</li></ol>')
  assert.equal(md('**Assets:** 3'), '<p dir="auto"><strong>Assets:</strong> 3</p>')           // not a bullet
})

test('tables, as the model writes them', () => {
  const html = md('| Equipment | Floor | Open alarms |\n|-----------|-------|-------------|\n| AHU_01 | L3 | **2** |\n| FCU_07 | L3 | 0 |')
  assert.equal(html, '<table class="aimdtbl"><thead><tr><th dir="auto">Equipment</th><th dir="auto">Floor</th><th dir="auto">Open alarms</th></tr></thead><tbody>'
    + '<tr><td dir="auto">AHU_01</td><td dir="auto">L3</td><td dir="auto"><strong>2</strong></td></tr>'
    + '<tr><td dir="auto">FCU_07</td><td dir="auto">L3</td><td dir="auto">0</td></tr></tbody></table>')
  assert.equal(md('a | b\nno separator row'), '<p dir="auto">a | b</p><p dir="auto">no separator row</p>')
})

test('code blocks keep their text exactly, escaped', () => {
  assert.equal(md('```\nx = 1 < 2\nif a & b:\n```'), '<pre dir="ltr" class="aimdcode"><code>x = 1 &lt; 2\nif a &amp; b:</code></pre>')
  assert.equal(md('```python\nprint(1)'), '<pre dir="ltr" class="aimdcode"><code>print(1)</code></pre>')          // unfinished while streaming
  assert.equal(md('```\n**not bold**\n```'), '<pre dir="ltr" class="aimdcode"><code>**not bold**</code></pre>')
})

test('Arabic and mixed text keep their own direction and content', () => {
  const html = md('## الملخص\n- **المعدات:** 61 عنصرًا\n- AHU_01 لديه إنذارات\n\n| الاسم | الحالة |\n|---|---|\n| AHU_01 | معطّل |')
  assert.ok(html.includes('<h4 dir="auto" class="aimdh">الملخص</h4>'))
  assert.ok(html.includes('<li dir="auto"><strong>المعدات:</strong> 61 عنصرًا</li>'))
  assert.ok(html.includes('<td dir="auto">معطّل</td>'))
  assertSafe(html, 'arabic')
})

const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '[click me](javascript:alert(1))',
  '![x](javascript:alert(1))',
  '[a](https://evil.example/?x="onmouseover="alert(1))',
  '**<b onmouseover=alert(1)>bold</b>**',
  '`<script>alert(1)</script>`',
  '```\n</code></pre><script>alert(1)</script>\n```',
  '| <img src=x onerror=alert(1)> | b |\n|---|---|\n| <script>x</script> | **<i>y</i>** |',
  '# <script>alert(1)</script>',
  '- <a href="javascript:alert(1)">x</a>',
  '1. <img src=x onerror=alert(1)>',
  '<p dir="auto" onclick="alert(1)">x</p>',
  '" onmouseover="alert(1)" x="',
  "' onfocus='alert(1)' autofocus='",
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&#60;script&#62;alert(1)',
  '<style>*{display:none}</style>',
  '<form action=//evil><input name=password></form>',
  '<details open ontoggle=alert(1)>',
  '<math><mtext></mtext><script>alert(1)</script></math>',
  '<!--<script>alert(1)</script>-->',
  '<![CDATA[<script>alert(1)</script>]]>',
  'x<<script>alert(1)//<</script>',
  '\u0001' + '0' + '\u0001 `a` \u00010\u0001',          // a forged placeholder for an inline-code span
  '`a`\u00010\u0001`b`',
  '| a |\n|---|\n|' + '<'.repeat(50) + '|',
]

test('hostile model output never becomes markup: only our own tags survive, with no attribute of the text', () => {
  for (const input of HOSTILE) assertSafe(md(input), JSON.stringify(input))
})

test('hostile text is shown as text, not run', () => {
  const html = md('<script>alert(1)</script> and <img src=x onerror=alert(1)>')
  assert.equal(html, '<p dir="auto">&lt;script&gt;alert(1)&lt;/script&gt; and &lt;img src=x onerror=alert(1)&gt;</p>')
  assert.equal(md('[click me](javascript:alert(1))'), '<p dir="auto">[click me](javascript:alert(1))</p>')       // no link is made
  const table = md('| <img src=x onerror=alert(1)> |\n|---|\n| <script>x</script> |')
  assert.ok(table.includes('&lt;img src=x onerror=alert(1)&gt;') && table.includes('&lt;script&gt;x&lt;/script&gt;'))
  assert.equal(md('&lt;b&gt;'), '<p dir="auto">&amp;lt;b&amp;gt;</p>')                                          // an already-escaped entity is not unescaped
})

test('a forged placeholder cannot reach into the code spans, and control characters are dropped', () => {
  assert.equal(md('`a` \u00010\u0001'), '<p dir="auto"><code>a</code> 0</p>')
  assert.ok(!md('\u0000\u0001').includes('\u0001') && !md('\u0000x').includes('\u0000'))
})

test('a very long or deeply repeated input still renders (no runaway pattern)', () => {
  const long = ('**a** *b* `c` _d_ [e](f) | g\n').repeat(2000)
  const t0 = Date.now()
  assertSafe(md(long), 'long')
  assertSafe(md('*'.repeat(5000) + 'x' + '*'.repeat(5000)), 'asterisks')
  assertSafe(md('_a'.repeat(5000)), 'underscores')
  assertSafe(md('|'.repeat(5000) + '\n' + '|-'.repeat(2000)), 'pipes')
  assert.ok(Date.now() - t0 < 4000, 'rendering took ' + (Date.now() - t0) + ' ms')
})

test('the chat only ever puts the renderer\'s output (or escaped text) into the page', () => {
  assert.match(SRC, /const paras = mdHtml\(text\);/)
  assert.doesNotMatch(SRC, /const paras = text\.split/)
  const turn = SRC.slice(SRC.indexOf('function turnHtml('), SRC.indexOf('function msgsHtml('))
  assert.ok(/\$\{esc\(tr\.q\.text\)\}/.test(turn), 'the user\'s own text is still escaped')
  assert.ok(!/\$\{a\.text\}|\$\{text\}/.test(turn), 'the answer text is never inserted raw')
  const md_src = SRC.slice(SRC.indexOf('/* ---- safe Markdown'), SRC.indexOf('/* ---- end safe Markdown ---- */'))
  assert.ok(md_src.indexOf('esc(String(text') < md_src.indexOf('mdInline(m[2])'), 'the text is escaped before any parsing')
  assert.ok(!/innerHTML|document\.|insertAdjacentHTML|eval\(|new Function|href|src=/.test(md_src), 'the renderer builds strings only: no DOM, no links')
})

test('the module still exposes the renderer for other callers', () => {
  assert.match(SRC, /return \{ md: mdHtml, ACTS,/)
})

test('the new error codes and the incomplete-answer note have texts in both languages, and the client maps the codes', () => {
  const table = lang => { const w = { EKO_I18N: {} }; vm.runInNewContext(js(`i18n/${lang}.js`), { window: w }); return w.EKO_I18N[lang] }
  const win = {}
  vm.runInNewContext(js('llm/eko-chat.js'), { window: win, AbortController, TextDecoder, JSON, Object, String, Array, Promise })
  for (const lang of ['en', 'ar']) {
    const T = table(lang)
    for (const k of ['ai.err.project_changed', 'ai.err.request_timeout', 'ai.partial']) assert.ok(T[k] && T[k].length > 10, `${lang} ${k}`)
  }
  assert.match(table('ar')['ai.partial'], /[\u0600-\u06FF]/)
  assert.equal(win.EKO_CHAT.errorCode('project_changed', 409), 'project_changed')
  assert.equal(win.EKO_CHAT.errorCode('request_timeout', 504), 'request_timeout')
  assert.equal(win.EKO_CHAT.errorCode(null, 504), 'timeout')                        // as before
  assert.equal(win.EKO_CHAT.errorCode('project_mismatch', 409), 'project')           // as before
  assert.match(SRC, /turn\.a\.partial = d\.partial === true;/)
  assert.match(SRC, /a\.partial \? t\('ai\.partial'\)/)
})
