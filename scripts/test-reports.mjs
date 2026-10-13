// Reports: missing values, print view and PDF, with NO backend (every /api call fails).
// Serves the dashboard statically and drives it in Chromium. Run: node scripts/test-reports.mjs
import assert from 'node:assert'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }

/* embedded: the container is a <div> inside <body>, as DashboardOverlay.tsx mounts it —
   the print host then sits OUTSIDE the container (the bug this guards) */
function page(mode) {
  let html = fs.readFileSync(path.join(root, 'templates/index.html'), 'utf8')
  if (mode === 'embedded') html = html
    .replace('<html lang="en" class="dashboard-native-container" data-theme="dark" data-nav="full">', '<html lang="en">')
    .replace('<body>', '<body><div class="dashboard-native-container" data-theme="dark" data-nav="full" style="position:absolute;inset:0">')
    .replace('</body>', '</div></body>')
  return html
}
/* sample: real numbers, including a legitimate ZERO, patched onto the site data */
const SAMPLE = `;(function(d){ d.water.tankVolumeM3 = 0; d.water.avgDrawM3Day = 12.5; d.gas.mtdM3 = 0; d.gas.tariffAedM3 = 3.2; d.gas.avg7M3 = 41.7; })(window.EKO_DATA.marsa);`

let mode = 'standalone', sample = false
/* fin: null = backend down (503) · '401' = backend up, FIN not signed in · object = signed in, this live payload */
let fin = null, finHistory = null
const json = (res, o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0])
  if (u.startsWith('/api/fin/') && fin === '401') { res.writeHead(401); return res.end() }
  if (u === '/api/fin/power-live' && fin) return json(res, fin)
  if (u === '/api/fin/power-history' && fin) return json(res, finHistory || {})
  if (u.startsWith('/api')) { res.writeHead(503); return res.end() }                // backend unavailable
  if (u === '/' || u === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page(mode)) }
  const f = path.join(root, u)
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  let body = fs.readFileSync(f)
  if (sample && u.endsWith('/data/site.marsa.js')) body = Buffer.concat([body, Buffer.from(SAMPLE)])
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(body)
}).listen(0)
const base = 'http://127.0.0.1:' + server.address().port + '/'

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ' + name) }
const BAD = /\bnull\b|\bNaN\b|\bundefined\b|Infinity/
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }))   // no Playwright download: use installed Chrome
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'eko-reports-'))

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const p = await ctx.newPage()
  await p.addInitScript(() => { window.print = () => {} })                          // headless: no dialog
  const errors = []; p.on('pageerror', e => errors.push(String(e)))
  await p.goto(base)
  await p.waitForFunction(() => window.EKO_R && window.EKO_RX && document.querySelector('[data-act]'), null, { timeout: 30000 })
  return { p, errors, close: () => ctx.close() }
}
async function generate(p, id) {
  await p.evaluate(id => { document.querySelector('.rpwrap')?.remove()
    const b = document.createElement('button'); b.dataset.act = 'rpGen'; b.dataset.v = id; document.body.appendChild(b); b.click(); b.remove() }, id)
  await p.waitForFunction(id => { const d = document.querySelector('.rpwrap .rpdoc'); return d && window.EKO_R.store.get(d.dataset.id)?.templateId === id }, id, { timeout: 15000 })
  return p.evaluate(() => ({ text: document.querySelector('.rpwrap .rpdoc').innerText,
    figs: [...document.querySelectorAll('.rpwrap .rpfig')].map(f => ({ label: f.querySelector('.rpflbl').innerText, val: f.querySelector('.rpfval').innerText.replace(/\s+/g, '') })) }))
}

await test('value rules: missing is "—", zero and negatives are readings', async () => {
  const { p, close } = await open()
  const r = await p.evaluate(() => { const R = window.EKO_R
    return { f: [null, undefined, NaN, Infinity, -Infinity, '', 'abc', false, [], {}].map(v => R.fmt(v, 1)),
      zero: [R.fmt(0, 1), R.fmt('0', 0), R.fmt(0.0, 2)], neg: R.fmt(-3.25, 1), pos: R.fmt(1234.56, 1), str: R.fmt('12.5', 1),
      mul: [R.mul(null, 3.2), R.mul(0, 3.2), R.mul(10, undefined), R.mul(2, 3)], div: [R.div(5, 0), R.div(0, 5), R.div(5, null), R.div(null, 5)] } })
  assert.deepStrictEqual(r.f, Array(10).fill('—'))
  assert.deepStrictEqual(r.zero, ['0.0', '0', '0.00'])
  assert.strictEqual(r.neg, '-3.2'); assert.strictEqual(r.pos, '1,234.5'); assert.strictEqual(r.str, '12.5')
  assert.deepStrictEqual(r.mul, [null, 0, null, 6], 'missing × rate is missing, not 0')
  assert.deepStrictEqual(r.div, [null, 0, null, null])
  await close()
})

for (const m of ['standalone', 'embedded']) {
  await test(`${m}: every template renders without null/NaN/undefined; missing shows "—" with no unit`, async () => {
    mode = m; sample = false
    const { p, errors, close } = await open()
    const ids = await p.evaluate(() => Object.keys(window.EKO_R.templates()))
    assert.strictEqual(ids.length, 8, 'eight report templates')
    for (const id of ids) {
      const { text, figs } = await generate(p, id)
      assert.ok(!BAD.test(text), `${id}: ${text.match(BAD)?.[0]} in\n${text}`)
      const unitAfterMissing = /—\s*(kWh|MWh|kW|MW|m³|AED|t CO₂|d|h|%)(?![\w²³])/   // narration included
      assert.ok(!unitAfterMissing.test(text), `${id}: "${text.slice(Math.max(0, text.search(unitAfterMissing) - 120), text.search(unitAfterMissing) + 20)}"`)
      for (const f of figs) if (f.val.startsWith('—')) assert.strictEqual(f.val, '—', `${id} ${f.label}: unit after a missing value`)
      if (id === 'utilities-water-gas') {
        const cost = figs.find(f => /gas cost/i.test(f.label))
        assert.ok(cost && cost.val === '—', 'no gas reading: cost is missing, never 0 AED (' + (cost && cost.val) + ')')
      }
      const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.rpbar [data-act="rpXlsx"]')])
      const xl = fs.readFileSync(await dl.path()).toString('utf8')                   // stored (uncompressed) zip: XML is plain text
      assert.ok(!/>(NaN|null|undefined|-?Infinity)</.test(xl) && !/null null/.test(xl), id + ' xlsx has an invalid value')
    }
    assert.deepStrictEqual(errors, [])
    await close()
  })

  await test(`${m}: PDF button and Ctrl+P print the styled report, app hidden, multi-page PDF`, async () => {
    mode = m; sample = false
    const { p, errors, close } = await open()
    await generate(p, 'executive-monthly')
    await p.screenshot({ path: path.join(out, `${m}-screen.png`) })
    const styles = () => p.evaluate(() => {
      const host = document.getElementById('rpprint'), cs = el => getComputedStyle(el)
      const fig = host.querySelector('.rpfig'), others = [...document.body.children].filter(e => e !== host)
      return { host: cs(host).display, overflow: cs(host).overflow, others: others.every(e => cs(e).display === 'none'),
        figs: cs(host.querySelector('.rpfigs')).display, figBorder: cs(fig).borderTopStyle, font: cs(host.querySelector('.rpdoc')).fontFamily,
        bg: cs(host.querySelector('.rpdoc')).backgroundColor, h3: cs(host.querySelector('.rph3')).fontFamily, thead: cs(host.querySelector('.rptable thead')).display,
        foot: !!host.querySelector('.rpfoot'), head: !!host.querySelector('.rphead'), dq: !!host.querySelector('.rpdq'), bar: !!host.querySelector('.rpbar, button') }
    })
    /* the PDF button builds the print view; its print styles keep the report design */
    await p.click('.rpbar [data-act="rpPdf"]')
    await p.waitForSelector('#rpprint .rpdoc', { state: 'attached' })
    await p.emulateMedia({ media: 'print' })
    const s = await styles()
    assert.strictEqual(s.host, 'block'); assert.strictEqual(s.overflow, 'visible'); assert.ok(s.others, 'app shell hidden in print')
    assert.strictEqual(s.figs, 'grid', 'metric cards keep their grid'); assert.strictEqual(s.figBorder, 'solid', 'metric cards keep their border')
    assert.match(s.font, /DM Sans/, 'report fonts apply'); assert.match(s.h3, /Sora/)
    assert.strictEqual(s.bg, 'rgb(255, 255, 255)'); assert.strictEqual(s.thead, 'table-header-group')
    assert.ok(s.foot && s.head && s.dq && !s.bar, 'header, data quality and footer printed; no controls')
    await p.setViewportSize({ width: 718, height: 1000 })                             // ~A4 content width, for eyeballing
    await p.screenshot({ path: path.join(out, `${m}-print.png`), fullPage: true })
    await p.setViewportSize({ width: 1400, height: 900 })
    let pdf = await p.pdf({ format: 'A4', path: path.join(out, `${m}-button.pdf`) })  // fires afterprint: the view is removed
    const pages = b => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
    assert.ok(pages(pdf) >= 2, `long report paginates (${pages(pdf)} pages)`)
    assert.strictEqual(await p.$('#rpprint'), null, 'print view removed after printing')
    /* Ctrl+P: nothing pre-built — the browser's own beforeprint builds the same view */
    await p.evaluate(() => window.addEventListener('beforeprint', () => { window.__printedReport = !!document.querySelector('#rpprint .rpdoc') }))
    pdf = await p.pdf({ format: 'A4', path: path.join(out, `${m}-ctrlp.pdf`) })
    assert.ok(await p.evaluate(() => window.__printedReport), 'browser print renders the report document')
    assert.ok(pages(pdf) >= 2, `Ctrl+P output paginates (${pages(pdf)} pages)`)
    assert.strictEqual(await p.$('#rpprint'), null, 'print view removed after Ctrl+P')
    assert.deepStrictEqual(errors, [])
    await close()
  })
}

await test('real readings: zero is kept (0.0 m³ → 0.0 AED, 0.0 d) and autonomy uses the mapped average draw', async () => {
  mode = 'standalone'; sample = true
  const { p, close } = await open()
  const { figs, text } = await generate(p, 'utilities-water-gas')
  const v = l => figs.find(f => l.test(f.label))?.val
  assert.strictEqual(v(/tank volume/i), '0.0m³')
  assert.strictEqual(v(/autonomy/i), '0.0d')
  assert.strictEqual(v(/gas.*month|month.*gas|gas mtd/i), '0.0m³')
  assert.strictEqual(v(/gas cost/i), '0.0AED')
  assert.ok(!BAD.test(text), text)
  await close()
  sample = false
})

/* FIN → data layer → dashboard cards → Morning Brief, with FIN-shaped responses. The backend keys
   /power-live by config.json live_point_ids and /power-history by power_endpoints; history comes as
   {year:{Month:{day:{hour:value}}}} (aggregate_and_restructure). FIN values often arrive as strings.
   CONSTRUCTED from the code's contract, not captured from the Marsa FIN server. */
const dubaiDay = (ms = 0) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', year: 'numeric', month: 'long', day: 'numeric' })
  .formatToParts(new Date(Date.now() + ms)).map(x => [x.type, x.value]))
const his = (pts) => { const o = {}; for (const [d, h, v] of pts) ((o[d.year] ??= {})[d.month] ??= {})[d.day] = { ...(((o[d.year] || {})[d.month] || {})[d.day]), [h]: v }; return o }
const cards = p => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ovk')].map(k => [k.querySelector('.ovklbl')?.innerText.trim(), k.querySelector('.ovknum')?.innerText.trim()])))
const metrics = p => p.evaluate(() => JSON.parse(JSON.stringify(window.EKO_DATA.marsa.metrics)))

await test('FIN not signed in (401): no reading is fabricated', async () => {
  fin = '401'; mode = 'embedded'                                                  // data-map.js runs only embedded (overlay-boot.js)
  const { p, close } = await open()
  await p.reload(); await p.waitForFunction(() => window.EKO_R && document.querySelector('[data-act]'))
  await p.waitForTimeout(800)                                                    // the first live poll has answered 401
  const m = await metrics(p)
  for (const k of ['energyTodayKwh', 'loadNowMw', 'waterTodayM3', 'gasTodayM3', 'comfortIndex', 'iaq']) assert.strictEqual(m[k], null, k)
  const { figs } = await generate(p, 'morning-brief')
  for (const l of [/energy today/i, /load now|current load/i, /comfort/i, /iaq/i, /water today/i, /gas today/i]) { const f = figs.find(x => l.test(x.label)); if (f) assert.strictEqual(f.val, '—', f.label) }
  await close()
})

await test('FIN signed in: IAQ 90.5 and the other metrics reach the cards and the Morning Brief, which agree', async () => {
  const today = dubaiDay(); mode = 'embedded'
  /* the cards read live total_water / total_gas as served (standard config.json keys) */
  fin = { hourly_energy: '742.6', peak_demand: '910', iaq_index: '90.5', comfort_compliance: 92.1, total_water: '0', total_gas: '12.5', current_month: '18234.7', energy_performance: '96', carbon: '0.4' }
  finHistory = { Hourly_Energy_Consumption_his: his([[today, 0, '100.5']]) }
  const { p, errors, close } = await open()
  await p.waitForFunction(() => { const m = window.EKO_DATA.marsa.metrics; return m.iaq != null && m.energyTodayKwh != null && m.gasTodayM3 != null }, null, { timeout: 15000 })
    .catch(async () => { throw new Error('values did not arrive: ' + JSON.stringify(await metrics(p)).slice(0, 200) + ' | errors: ' + errors.join(' | ')) })
  const m = await metrics(p)
  assert.strictEqual(m.iaq, 90.5, 'IAQ string "90.5" is read as the FIN value'); assert.strictEqual(m.comfortIndex, 92.1)
  assert.strictEqual(m.waterTodayM3, 0, 'string "0" is a zero reading, not missing')
  assert.strictEqual(m.gasTodayM3, 12.5)
  assert.strictEqual(m.loadNowMw, 0.7); assert.strictEqual(m.energyTodayKwh, 100.5)
  const c = await cards(p)
  const card = re => Object.entries(c).find(([k]) => re.test(k))?.[1]
  assert.strictEqual(card(/water today/i), '0.0', JSON.stringify(c)); assert.strictEqual(card(/gas today/i), '12.5'); assert.strictEqual(card(/iaq/i), '90.5')
  const { figs, text } = await generate(p, 'morning-brief')
  const fig = re => figs.find(f => re.test(f.label))?.val
  assert.strictEqual(fig(/iaq/i), '90.5', 'report agrees with the card'); assert.strictEqual(fig(/comfort/i), '92.1')
  assert.strictEqual(fig(/gas today/i), '12.5m³', 'report gas = card gas')
  assert.strictEqual(fig(/energy today/i), '100.5kWh'); assert.strictEqual(fig(/load now|current load/i), '0.7MW')
  assert.ok(!BAD.test(text), text)
  /* a partial payload (iaq gone, comfort and gas unreadable) keeps the last valid readings */
  fin = { ...fin, comfort_compliance: 'NA', iaq_index: undefined, total_gas: 'NA' }
  await p.waitForTimeout(6000)                                                   // one 5 s live poll
  const m2 = await metrics(p)
  assert.strictEqual(m2.iaq, 90.5, 'missing key does not erase the last valid reading')
  assert.strictEqual(m2.comfortIndex, 92.1, 'unreadable value does not erase the last valid reading')
  assert.strictEqual(m2.gasTodayM3, 12.5); assert.strictEqual(m2.waterTodayM3, 0)
  assert.strictEqual(await p.evaluate(() => window.EKO_DATA.marsa.gas.todayM3), 12.5, 'gas page keeps its last valid reading on "NA"')
  /* a genuine zero IAQ reading stays zero */
  fin = { ...fin, iaq_index: '0' }
  await p.waitForFunction(() => window.EKO_DATA.marsa.metrics.iaq === 0, null, { timeout: 8000 })
  assert.deepStrictEqual(errors, [])
  await close()
  fin = null; finHistory = null; mode = 'standalone'
})

await browser.close(); server.close()
console.log(`\n${passed} passed · PDFs and screenshots in ${out}`)
