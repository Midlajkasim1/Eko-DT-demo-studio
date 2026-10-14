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
/* stamp: the X-Eko-Project the backend sends (null = an older backend, no stamp) · slowLive: the next
   /power-live answer is this payload, held back this many ms (a reply that outlives a project switch) */
let stamp = null, slowLive = null
/* finEquip: the /equip-live payload · pointHist: one {v, hold} per /point-history request, in order (daily average v;
   hold: a promise the reply waits for) */
let finEquip = null, pointHist = []
/* finMeters: the /pmu-live payload (meters the project's meter profile matched) */
let finMeters = null
const json = (res, o) => { res.writeHead(200, { 'content-type': 'application/json', ...(stamp !== null ? { 'x-eko-project': encodeURIComponent(stamp) } : {}) }); res.end(JSON.stringify(o)) }
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0])
  if (u.startsWith('/api/fin/') && fin === '401') { res.writeHead(401); return res.end() }
  if (u === '/api/fin/power-live' && slowLive) { const { payload, ms } = slowLive; slowLive = null; return setTimeout(() => json(res, payload), ms) }
  if (u === '/api/fin/power-live' && fin) return json(res, fin)
  if (u === '/api/fin/equip-live' && finEquip) return json(res, finEquip)
  if (u === '/api/fin/pmu-live' && finMeters) return json(res, finMeters)
  if (u === '/api/fin/point-history' && pointHist.length) {
    const { v, hold } = pointHist.length > 1 ? pointHist.shift() : pointHist[0]
    return Promise.resolve(hold).then(() => json(res, { unit: '°C', history: his([[dubaiDay(), 0, v]]) }))
  }
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

/* project: what DashboardOverlay.tsx injects for the open project (INJECTED_PROJECT_CONFIG), or none */
async function open(project) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const p = await ctx.newPage()
  await p.addInitScript(() => { window.print = () => {} })                          // headless: no dialog
  if (project) await p.addInitScript(cfg => { window.INJECTED_PROJECT_CONFIG = cfg }, project)
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

/* ── the open project's saved settings drive the dashboard and the reports ── */
const PROJECT = (projectId, finProject, displayName = '') => ({
  projectId, site: { name: projectId + ' studio name', displayName, finProject, timezone: 'Asia/Dubai' },
  fin: { baseUrl: 'https://localhost', project: finProject, interval: 5000, directMode: false },
})
const KHAZNA = PROJECT('proj-K', 'khaznaDataCenter', 'Khazna DC')

await test('project switch: an answer the backend still stamps for the previous project is dropped', async () => {
  mode = 'embedded'; stamp = 'proj-M'                                              // backend not switched yet
  fin = { iaq_index: '55.5', hourly_energy: '7.5', total_water: '9' }
  const { p, errors, close } = await open(KHAZNA)
  await p.waitForTimeout(2500)                                                   // first polls answered, and one catch-up
  const m = await metrics(p)
  for (const k of ['iaq', 'loadNowMw', 'waterTodayM3']) assert.strictEqual(m[k], null, k + ' came from the previous project')
  stamp = 'proj-K'; fin = { iaq_index: '66.6' }                                   // the backend now serves this project
  await p.waitForFunction(() => window.EKO_DATA.marsa.metrics.iaq === 66.6, null, { timeout: 8000 })
  assert.strictEqual((await metrics(p)).loadNowMw, null, 'an unmapped metric stays unavailable, not borrowed')
  assert.deepStrictEqual(errors, [])
  await close()
})

await test('project switch: a late reply to the previous dashboard\'s poll never reaches the next one', async () => {
  mode = 'embedded'; stamp = 'proj-K'; fin = { hourly_energy: '3.2' }
  slowLive = { payload: { hourly_energy: '7.5' }, ms: 6000 }                     // the first live poll hangs
  const { p, errors, close } = await open(KHAZNA)
  await p.evaluate(() => {
    window.__seen = []
    window.addEventListener('dashboard-data', e => { if (e.detail.type === 'power') window.__seen.push(e.detail.data.hourly_energy) })
    window.DashboardData.stop(); window.DashboardData.start()                    // what a project switch does
  })
  await p.waitForFunction(() => window.EKO_DATA.marsa.metrics.loadNowMw === 3.2, null, { timeout: 8000 })
  await p.waitForTimeout(6500)                                                   // the hung reply has now landed
  assert.ok(!(await p.evaluate(() => window.__seen)).includes('7.5'), 'stopped poller handed over its late reply')
  assert.strictEqual((await metrics(p)).loadNowMw, 3.2)
  assert.deepStrictEqual(errors, [])
  await close()
})

await test('dashboard reload: the previous copy\'s late history reply does not overwrite the new copy\'s', async () => {
  mode = 'embedded'; stamp = 'proj-K'; fin = { iaq_index: '50' }
  /* same equipment name in both projects, different FIN point: the previous project's history request is held back */
  const fcu = id => ({ equipment: [{ name: 'FCU-1', type: 'fcu', points: [{ id, navName: 'Zone Temp', currentValue: '22', reporting: true, his: true }] }] })
  finEquip = fcu('@p:prev:r:1')
  let release; const held = new Promise(r => { release = r })
  pointHist = [{ v: '99.9', hold: held }, { v: '11.1' }]
  const { p, errors, close } = await open(KHAZNA)
  await p.waitForFunction(() => window.EKO_DATA.marsa.assets.some(a => a.id === 'FCU-1'), null, { timeout: 15000 })
  finEquip = fcu('@p:next:r:2')
  await p.evaluate(async () => {                                                  // what a dashboard reload runs again, in template order
    for (const src of ['/static/js/data-provider.js?v=2', '/static/js/data-map.js?v=2']) {
      await new Promise(r => { const s = document.createElement('script'); s.src = src; s.onload = r; document.body.appendChild(s) })
    }
  })
  const day = () => p.evaluate(() => { const a = window.EKO_DATA.marsa.assets.find(x => x.id === 'FCU-1'); return a && a.compare && a.compare.days[0] && a.compare.days[0].actual })
  await p.waitForFunction(() => { const a = window.EKO_DATA.marsa.assets.find(x => x.id === 'FCU-1'); return a?.compare?.days?.[0]?.actual === 11.1 }, null, { timeout: 8000 })
  release(); await p.waitForTimeout(1000)                                        // the first copy's reply lands now
  assert.strictEqual(await day(), 11.1, 'the superseded copy wrote its history into the site data')
  assert.deepStrictEqual(errors, [])
  await close()
  finEquip = null; pointHist = []
})

await test('reports name the open project and do not borrow Marsa\'s contract figures', async () => {
  mode = 'embedded'; stamp = 'proj-K'; fin = { iaq_index: '71.2' }
  const { p, errors, close } = await open(KHAZNA)
  await p.waitForFunction(() => window.EKO_DATA.marsa.metrics.iaq === 71.2, null, { timeout: 15000 })
  const brief = await generate(p, 'morning-brief')
  assert.ok(brief.text.includes('Khazna DC') && !brief.text.includes('Marsa Al Arab'), brief.text.slice(0, 300))
  assert.strictEqual(brief.figs.find(f => /iaq/i.test(f.label))?.val, '71.2', 'report carries the project\'s own reading')
  const exec = await generate(p, 'executive-monthly')
  assert.strictEqual(exec.figs.find(f => /contract/i.test(f.label))?.val, '—', 'Marsa\'s 125 kW is not this site\'s contract')
  /* every template: none of Marsa's fixture readings, alarms, assets or work orders (FIN has sent no equipment or alarms here) */
  for (const id of await p.evaluate(() => Object.keys(window.EKO_R.templates()))) {
    const { text, figs } = await generate(p, id)
    assert.ok(!BAD.test(text), `${id}: ${text.match(BAD)?.[0]}`)
    assert.ok(!text.includes('Marsa Al Arab') && !text.includes('61,204'), `${id} shows a Marsa figure`)
    for (const f of figs) {
      if (/previous month|alarm|work order|assets/i.test(f.label)) assert.ok(f.val === '—' || /^0(\.0)?(%|h)?$/.test(f.val), `${id} ${f.label} = ${f.val}`)
    }
  }
  /* no display name set: the Eko-DT project's own name, never the fixture's */
  await close()
  const plain = await open(PROJECT('proj-E', 'ellisdonDemo'))
  const t = (await generate(plain.p, 'morning-brief')).text
  assert.ok(t.includes('proj-E studio name') && !t.includes('Marsa Al Arab'), t.slice(0, 300))
  assert.deepStrictEqual([...errors, ...plain.errors], [])
  await plain.close()
})

/* ── real mode (the default) vs demo figures, reporting basis, Power page ── */
const MARSA = PROJECT('proj-site', 'marsaAlArab')
const withBasis = (proj, basis) => ({ ...proj, basis: { currency: 'AED', energyTariff: null, tariffName: '', gasTariff: null, co2Factor: null, co2FactorName: '', ...basis } })
const hiddenSubs = p => p.evaluate(() => (window.EKO.nav.modules.find(m => m.id === 'energy').subs || []).filter(s => s.hidden).map(s => s.id).sort())
const siteClock = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
const goPower = async (p, page = 'power') => { await p.evaluate(pg => window.EKO.go(pg, 'energy', 'power'), page); await p.waitForTimeout(300) }
const dbRows = p => p.evaluate(() => [...document.querySelectorAll('.dbrow')].map(r => [r.querySelector('.dbid').innerText.trim(), r.querySelector('.dbkw').innerText.trim()]))

await test('Marsa Al Arab, real mode: its name, and no demo figure or unconfigured rate in any report', async () => {
  mode = 'embedded'; stamp = 'proj-site'; fin = { iaq_index: '80.1' }
  const { p, errors, close } = await open(MARSA)
  await p.waitForFunction(() => window.EKO_DATA.marsa.metrics.iaq === 80.1, null, { timeout: 15000 })
  const exec = await generate(p, 'executive-monthly')
  assert.ok(exec.text.includes('Marsa Al Arab'), exec.text.slice(0, 300))
  for (const l of [/contract/i, /energy cost/i, /co₂/i, /previous month/i]) {
    for (const f of exec.figs.filter(x => l.test(x.label))) assert.strictEqual(f.val, '—', `${f.label} = ${f.val}`)
  }
  for (const id of await p.evaluate(() => Object.keys(window.EKO_R.templates()))) {
    const { text } = await generate(p, id)
    assert.ok(!BAD.test(text), `${id}: ${text.match(BAD)?.[0]}`)
    assert.ok(!/DEWA|provisional|61,204|1,190/.test(text), `${id} shows a demo figure or basis: ${text.match(/DEWA|provisional|61,204|1,190/)?.[0]}`)
  }
  assert.deepStrictEqual(await hiddenSubs(p), ['anom', 'bench', 'fcst'], 'modules with no FIN source are hidden')
  /* the prototype's people, systems and sites are not this project's */
  const util = await generate(p, 'utilities-water-gas')
  assert.ok(!/Arman|\bAY\b/.test(exec.text + util.text), 'no sample user as report author')
  assert.ok(!/meter (W-01|G-01|MW-03|KG-02)/.test(util.text) && util.text.includes('water consumption (FIN)'), 'sources are the FIN totals, not sample meters')
  const real = await p.evaluate(() => ({ ints: window.EKO.data.integrations, sites: window.EKO_DATA.portfolio.map(s => s.key), estate: window.EKO_DATA.estate.sites.length,
    llm: window.EKO_LLM.kind, cmms: window.EKO_CMMS.createWorkOrder({ assetId: 'X-1' }), raised: Object.keys(window.EKO.state.woRaised), avatar: document.querySelector('.avatar')?.innerText.trim() }))
  assert.ok(real.ints.length === 1 && /^FIN Framework · marsaAlArab$/.test(real.ints[0].name) && !/4,812/.test(JSON.stringify(real.ints)), 'the integration row is the FIN connection: ' + JSON.stringify(real.ints))
  assert.deepStrictEqual(real.sites, ['marsa'], 'the site switcher lists this project only'); assert.strictEqual(real.estate, 0, 'no sample estate figures')
  assert.strictEqual(real.llm, 'none', 'no simulated AI narration'); assert.strictEqual(real.cmms, null, 'no simulated work order')
  await p.waitForTimeout(1200)
  assert.deepStrictEqual(await p.evaluate(() => Object.keys(window.EKO.state.woRaised)), [], 'nothing was raised')
  assert.notStrictEqual(real.avatar, 'AY', 'no sample initials')
  const genLbl = await p.evaluate(() => window.EKO_R.store.list()[0].generatedAtLabel)
  const tzName = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', timeZoneName: 'short' }).formatToParts(new Date()).find(x => x.type === 'timeZoneName').value
  assert.ok(genLbl.endsWith(tzName), `"Generated" is the site clock, named (${genLbl})`)
  const asOf = await p.evaluate(() => window.EKO_DATA.marsa.basis.asOf)
  assert.ok(Math.abs(+asOf.replace(':', '') - +siteClock().replace(':', '')) <= 1 || asOf === siteClock(), `report clock ${asOf} is the site clock ${siteClock()}, not 14:00`)
  assert.deepStrictEqual(errors, [])
  await close()
})

await test('Marsa Al Arab with Demo figures on: the prototype\'s demo experience is kept', async () => {
  mode = 'embedded'; stamp = 'proj-site'; fin = { iaq_index: '80.1' }
  const { p, errors, close } = await open({ ...MARSA, demo: true })
  await p.waitForFunction(() => window.EKO_DATA.marsa.metrics.iaq === 80.1, null, { timeout: 15000 })
  const exec = await generate(p, 'executive-monthly')
  assert.ok(exec.text.includes('Marsa Al Arab') && exec.text.includes('DEWA'), exec.text.slice(0, 300))
  assert.match(exec.figs.find(f => /contract/i.test(f.label))?.val || '', /^125/)
  assert.deepStrictEqual(await hiddenSubs(p), [], 'demo modules are shown')
  const demo = await p.evaluate(() => ({ user: window.EKO.data.user.name, sites: window.EKO_DATA.portfolio.length, llm: window.EKO_LLM.kind, avatar: document.querySelector('.avatar')?.innerText.trim() }))
  assert.deepStrictEqual(demo, { user: 'Arman Y.', sites: 14, llm: 'mock', avatar: 'AY' }, 'the demo keeps its sample user, sites and adapters')
  assert.deepStrictEqual(errors, [])
  await close()
})

await test('reporting basis: costs and CO₂ use only the project\'s own rates, and the report states them', async () => {
  const today = dubaiDay(); mode = 'embedded'; stamp = 'proj-K'
  fin = { iaq_index: '61' }; finHistory = { Hourly_Energy_Consumption_his: his([[today, 0, '100']]) }
  const ready = p => p.waitForFunction(() => window.EKO_DATA.marsa.metrics.energyTodayKwh === 100, null, { timeout: 15000 })
  const costFigs = async p => { const out = {}
    for (const id of await p.evaluate(() => Object.keys(window.EKO_R.templates()))) {
      const { text, figs } = await generate(p, id)
      figs.filter(f => /energy cost today|co₂ today/i.test(f.label)).forEach(f => { out[f.label.toLowerCase()] = f.val })
      out.text = (out.text || '') + text
    }
    return out }
  /* configured */
  const cfg = await open(withBasis(KHAZNA, { currency: 'SAR', energyTariff: 0.5, tariffName: 'Test Tariff T1', co2Factor: 0.4, co2FactorName: 'Grid 2026' }))
  await ready(cfg.p)
  const c = await costFigs(cfg.p)
  assert.strictEqual(c['energy cost today'], '50.0SAR', JSON.stringify(c).slice(0, 300))   // 100 kWh × 0.50 SAR/kWh
  assert.strictEqual(c['co₂ today'], '0.0tCO₂')                                         // 0.1 MWh × 0.4 = 0.04 t
  assert.ok(c.text.includes('Test Tariff T1') && c.text.includes('0.50 SAR/kWh') && c.text.includes('Grid 2026') && c.text.includes('0.40 kg CO₂/kWh'), 'basis disclosed')
  assert.ok(!/DEWA|provisional/.test(c.text), 'no DEWA assumption on a project that configured its own')
  assert.deepStrictEqual(cfg.errors, [])
  await cfg.close()
  /* not configured: unavailable, never 0 and never the prototype's DEWA rate */
  const none = await open(KHAZNA)
  await ready(none.p)
  const n = await costFigs(none.p)
  assert.strictEqual(n['energy cost today'], '—'); assert.strictEqual(n['co₂ today'], '—')
  assert.ok(!/DEWA|0\.30 AED|0\.41 kg/.test(n.text), 'no prototype rate behind a missing one')
  assert.deepStrictEqual(none.errors, [])
  await none.close()
  finHistory = null
})

await test('Power page: boards only where the project maps them; a missing reading is "--", never 0', async () => {
  mode = 'embedded'
  /* Marsa: config.json maps all six board keys. Today, MCC 1's hourly history says 5 + 7.5 kWh;
     no other board has a reading today (MCC 2 not even a live one) */
  const today = dubaiDay()
  stamp = 'proj-site'; fin = { iaq_index: '1', mcc1: '12.5', mcc2: null, smdb_kit: '3', lvfp: '4', ats: '5', sump_pump: '6' }
  finHistory = { Hourly_EC_MCC1_his: his([[today, 0, '5'], [today, 1, '7.5']]) }
  let o = await open(MARSA)
  await o.p.waitForFunction(() => (window.EKO_DATA.marsa.power.boards || []).length === 6 && (window.EKO_DATA.marsa.power.zoneHourly || []).length === 6, null, { timeout: 15000 })
  await goPower(o.p)
  const rows = await dbRows(o.p)
  assert.deepStrictEqual(rows.map(r => r[0]), ['MCC 1', 'MCC 2', 'Kitchen SMDB', 'LVFP', 'ATS', 'Sump pump'])
  assert.strictEqual(rows[0][1], '12.5 kWh', 'MCC 1 today = its hourly history')
  assert.ok(rows.slice(1).every(r => r[1] === '--'), 'no reading today is "--", never 0.0 kWh: ' + JSON.stringify(rows))
  finHistory = null
  assert.deepStrictEqual(o.errors, []); await o.close()
  /* another project that maps no board key: not configured, no Marsa board, no 0 kW */
  stamp = 'proj-K'; fin = { iaq_index: '1' }; finMeters = { 'MTR-1': { active_power: '3.3', voltage: '400' } }
  o = await open(KHAZNA)
  await o.p.waitForFunction(() => (window.EKO_DATA.marsa.power.pmus || []).length === 1, null, { timeout: 15000 })
  await goPower(o.p)
  assert.deepStrictEqual(await dbRows(o.p), [])
  assert.strictEqual(await o.p.locator('[data-testid="pw-boards-unset"]').count(), 2, 'board widgets say "not configured"')
  const pmus = await o.p.evaluate(() => window.EKO_DATA.marsa.power.pmus.map(m => [m.id, m.kw]))
  assert.deepStrictEqual(pmus, [['MTR-1', 3.3]], 'the meter its own meter profile matched, not Marsa\'s PMU04-09')
  await goPower(o.p, 'power-model')
  assert.strictEqual(await o.p.locator('[data-testid="pw-model-unset"]').count(), 1, 'model view says "not configured"')
  assert.deepStrictEqual(o.errors, []); await o.close()
  /* a project that maps one board key: that board only */
  fin = { iaq_index: '1', lvfp: '7' }; finMeters = null
  finHistory = { Hourly_EC_LVFP_his: his([[today, 0, '7']]) }
  o = await open(KHAZNA)
  await o.p.waitForFunction(() => (window.EKO_DATA.marsa.power.boards || []).length === 1 && (window.EKO_DATA.marsa.power.zoneHourly || []).length === 1, null, { timeout: 15000 })
  await goPower(o.p)
  assert.deepStrictEqual(await dbRows(o.p), [['LVFP', '7.0 kWh']])
  finHistory = null
  assert.deepStrictEqual(o.errors, []); await o.close()
  stamp = null; fin = null; mode = 'standalone'
})

await test('configured power boards: the project\'s own boards, "--" when a reading is missing, and only its own data', async () => {
  const today = dubaiDay(); mode = 'embedded'
  const BOARDS_K = [{ name: 'Chiller Plant', liveKey: 'chiller_kw', historyKey: 'Chiller_EC_his', meter: 'MTR-3' }, { name: 'Lighting', liveKey: 'light_kw' }]
  const K = { ...KHAZNA, powerBoards: BOARDS_K }
  const ready = (p, n) => p.waitForFunction(n => (window.EKO_DATA.marsa.power.boards || []).length === n, n, { timeout: 15000 })
  /* Khazna: Chiller Plant's history says 2 + 3 kWh today; Lighting has no reading and no history */
  stamp = 'proj-K'; fin = { iaq_index: '1', chiller_kw: '4', light_kw: null }
  finHistory = { Chiller_EC_his: his([[today, 0, '2'], [today, 1, '3']]) }; finMeters = { 'MTR-3': { active_power: '9' } }
  let o = await open(K)
  await ready(o.p, 2); await o.p.waitForFunction(() => (window.EKO_DATA.marsa.power.pmus || []).length === 1, null, { timeout: 15000 })
  await goPower(o.p)
  assert.deepStrictEqual(await dbRows(o.p), [['Chiller Plant', '5.0 kWh'], ['Lighting', '--']])
  assert.deepStrictEqual(await o.p.evaluate(() => window.EKO_DATA.marsa.power.pmus.map(m => [m.id, m.db, m.kw])), [['MTR-3', 'Chiller Plant', 9]], 'meter named after its board')
  assert.deepStrictEqual(o.errors, []); await o.close()
  /* nothing reported at all (and FIN lists no meter): both boards stay listed, "--", never 0 */
  fin = { iaq_index: '1' }; finHistory = null; finMeters = {}
  o = await open(K)
  await ready(o.p, 2); await goPower(o.p)
  assert.deepStrictEqual(await dbRows(o.p), [['Chiller Plant', '--'], ['Lighting', '--']])
  await o.p.waitForFunction(() => (window.EKO_DATA.marsa.power.pmus || []).length === 1, null, { timeout: 15000 })
  assert.deepStrictEqual(await o.p.evaluate(() => window.EKO_DATA.marsa.power.pmus.map(m => [m.id, m.kw])), [['MTR-3', null]], 'its known meter, reading "--"')
  assert.deepStrictEqual(o.errors, []); await o.close()
  finMeters = null
  /* the backend still serves Marsa (a switch in flight): its board readings are not Khazna's */
  stamp = 'proj-site'; fin = { iaq_index: '1', mcc1: '12.5', chiller_kw: '99' }
  o = await open(K)
  await ready(o.p, 2); await o.p.waitForTimeout(2500)
  await goPower(o.p)
  assert.deepStrictEqual(await dbRows(o.p), [['Chiller Plant', '--'], ['Lighting', '--']], 'a reply stamped for Marsa is dropped')
  stamp = 'proj-K'; fin = { iaq_index: '1', chiller_kw: '4' }; finHistory = { Chiller_EC_his: his([[today, 0, '6']]) }
  await o.p.waitForFunction(() => window.EKO_DATA.marsa.power.boards[0][1] != null, null, { timeout: 10000 })
  await goPower(o.p)
  assert.deepStrictEqual((await dbRows(o.p))[0], ['Chiller Plant', '6.0 kWh'], 'Khazna\'s own reading once the backend serves it')
  assert.deepStrictEqual(o.errors, []); await o.close()
  /* Marsa with its own board list: those boards, not the six built-in ones */
  stamp = 'proj-site'; fin = { iaq_index: '1', mcc1: '12.5', mcc2: '7' }
  finHistory = { Hourly_EC_MCC1_his: his([[today, 0, '12.5']]) }
  o = await open({ ...MARSA, powerBoards: [{ name: 'Main Chiller MCC', liveKey: 'mcc1', historyKey: 'Hourly_EC_MCC1_his', meter: 'PMU09' }] })
  await ready(o.p, 1); await o.p.waitForFunction(() => (window.EKO_DATA.marsa.power.zoneHourly || []).length === 1, null, { timeout: 15000 })
  await goPower(o.p)
  assert.deepStrictEqual(await dbRows(o.p), [['Main Chiller MCC', '12.5 kWh']])
  assert.deepStrictEqual(o.errors, []); await o.close()
  stamp = null; fin = null; finHistory = null; mode = 'standalone'
})

await browser.close(); server.close()
console.log(`\n${passed} passed · PDFs and screenshots in ${out}`)
