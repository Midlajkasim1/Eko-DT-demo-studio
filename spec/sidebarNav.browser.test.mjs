import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// The dashboard's left rail (templates/index.html + static/dashboard): every expandable section opens, folds and switches, its items are all shown and
// reachable, the active item is marked, the collapsed rail shows a flyout, and none of it reloads the page. Hospital (extended modules) and Marsa.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }
let server, browser, base
before(async () => {
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname), file = p === '/' ? path.join(root, 'templates/index.html') : path.join(root, p)
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://localhost:${server.address().port}`
  browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
})
after(async () => { await browser?.close(); server?.closeAllConnections?.(); await new Promise(r => server?.close(r)) })

const CONFIGS = {
  eko: { projectId: 'p-eko', demo: false, hospitalHvac: true, modules: 'extended', site: { name: 'Eko Hospital', finProject: 'ekoHospital', timezone: 'Asia/Dubai' }, basis: {} },
  marsa: { projectId: 'p-marsa', demo: true, hospitalHvac: false, site: { name: 'Marsa Al Arab', finProject: 'marsaAlArab', timezone: 'Asia/Dubai' }, basis: {} },
}
async function openFor(kind, viewport = { width: 1440, height: 900 }, lang = 'en') {
  const ctx = await browser.newContext({ viewport }), page = await ctx.newPage()
  page.once('close', () => { ctx.close().catch(() => {}) })
  page.errors = []; page.on('pageerror', e => page.errors.push(String(e)))
  await page.addInitScript(([cfg, lg]) => { window.INJECTED_PROJECT_CONFIG = { ...cfg }; window.__loads = (window.__loads || 0) + 1; try { localStorage.setItem('eko-lang', lg) } catch (e) {} }, [CONFIGS[kind], lang])
  await page.goto(base + '/')
  await page.waitForFunction(() => window.EKO && window.EKO.data && document.querySelector('#ekonav .nvi'))
  assert.equal(await page.evaluate(() => (document.querySelector('.dashboard-native-container') || document.documentElement).dir), lang === 'ar' ? 'rtl' : 'ltr')
  return page
}
const row = (page, m) => page.locator(`#ekonav .nvi[data-mod="${m}"]`)
const chev = (page, m) => page.locator(`#ekonav .nchevb[data-mod="${m}"]`)
const items = page => page.locator('#ekonav .nsub').evaluateAll(l => l.map(x => { const r = x.getBoundingClientRect(), v = { w: innerWidth, h: innerHeight }
  return { text: x.textContent.trim(), on: x.dataset.on, shown: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= v.w } }))
const expandable = page => page.evaluate(() => [...document.querySelectorAll('#ekonav .nvi[data-mod]')].filter(x => x.querySelector('.nchevb')).map(x => x.dataset.mod))
const settle = page => page.waitForTimeout(350)

for (const kind of ['eko', 'marsa']) {
  test(`${kind}: every expandable section opens, folds on a second click and on its chevron, and switching keeps one open`, async () => {
    const page = await openFor(kind)
    try {
      const mods = await expandable(page)
      assert.ok(mods.length >= 5, 'the sections: ' + mods)
      for (const m of mods) {
        await row(page, m).click(); await settle(page)
        const open = await items(page)
        assert.ok(open.length >= 1 && open.every(i => i.shown), `${m}: every item shown and inside the window`)
        assert.equal(await row(page, m).getAttribute('data-on'), 'page')
        await row(page, m).click(); await settle(page); assert.equal((await items(page)).length, 0, `${m}: a second click folds it`)
        await chev(page, m).click(); await settle(page); assert.equal((await items(page)).length, open.length, `${m}: the chevron opens it`)
        await chev(page, m).click(); await settle(page); assert.equal((await items(page)).length, 0, `${m}: the chevron folds it`)
        await chev(page, m).click(); await settle(page)
        // the first item: opens its page, is marked active, and the section stays open and marked as the one holding the page
        await page.locator('#ekonav .nsub').first().click(); await settle(page)
        const after = await items(page)
        assert.equal(after.length, open.length, `${m}: still open after a choice`); assert.equal(after.filter(i => i.on === 'true').length, 1, `${m}: exactly one active item`)
        assert.equal(await row(page, m).getAttribute('data-on'), 'contains')
      }
      // switching: opening another section closes the previous one
      await row(page, mods[0]).click(); await settle(page); const first = (await items(page)).length
      await row(page, mods[1]).click(); await settle(page); const second = (await items(page)).length
      assert.ok(first > 0 && second > 0); assert.equal(await page.locator(`#ekonav .nvi[data-mod="${mods[0]}"] + .nsubs`).count(), 0, 'the previous one is closed')
      assert.equal(await page.evaluate(() => window.__loads), 1, 'no page reload'); assert.deepEqual(page.errors, [])
    } finally { await page.close() }
  })
}

test('Hospital: Systems lists its five items, Schematic opens; Marsa has no Schematic', async () => {
  const page = await openFor('eko')
  try {
    await row(page, 'systems').click(); await settle(page)
    assert.deepEqual((await items(page)).map(i => i.text), ['HVAC & Mechanical', 'Electrical', 'Other systems', 'Data health', 'Schematic'])
    await page.locator('#ekonav .nsub[data-sub="twin"]').click(); await page.locator('#mount > .twinview').waitFor()
    assert.equal(await page.locator('#ekonav .nsub[data-sub="twin"]').getAttribute('data-on'), 'true')
  } finally { await page.close() }
  const m = await openFor('marsa')
  try { await row(m, 'systems').click(); await settle(m); assert.ok(!(await items(m)).some(i => i.text === 'Schematic')) } finally { await m.close() }
})

test('1024 px wide (where the rail used to lose its items and nothing replaced them): the items are shown', async () => {
  const page = await openFor('eko', { width: 1024, height: 700 })
  try {
    await row(page, 'systems').click(); await settle(page)
    assert.equal((await items(page)).length, 5); assert.ok((await items(page)).every(i => i.shown))
    assert.ok(await page.locator('#ekonav').evaluate(n => n.getBoundingClientRect().width > 150), 'a full rail, not an icon column')
  } finally { await page.close() }
})

test('a short window: the rail scrolls and its last item can be reached and used', async () => {
  const page = await openFor('eko', { width: 1280, height: 520 })
  try {
    await row(page, 'security').click(); await settle(page)
    const nav = page.locator('#ekonav'); assert.ok(await nav.evaluate(n => n.scrollHeight > n.clientHeight), 'more than fits')
    const last = page.locator('#ekonav .nsub').last(); await last.scrollIntoViewIfNeeded()
    assert.ok(await last.evaluate(x => { const r = x.getBoundingClientRect(), n = document.querySelector('#ekonav').getBoundingClientRect(); return r.top >= n.top - 1 && r.bottom <= n.bottom + 1 }))
    await last.click(); await settle(page); assert.equal(await page.locator('#ekonav .nsub[data-on="true"]').count(), 1)
  } finally { await page.close() }
})

for (const lang of ['en', 'ar']) {
  test(`the collapsed rail shows a section's items as a flyout beside its icon, and closes on a choice (${lang})`, async () => {
    const page = await openFor('eko', { width: 1440, height: 900 }, lang)
    try {
      await page.locator('#ekonav [data-act="navMin"]').click(); await settle(page)
      assert.equal(await page.locator('.dashboard-native-container').getAttribute('data-nav'), 'min')
      assert.equal((await items(page)).length, 0, 'nothing open yet')
      await row(page, 'systems').click(); await settle(page)
      const it = await items(page); assert.equal(it.length, 5); assert.ok(it.every(i => i.shown), 'inside the window, not clipped')
      await row(page, 'systems').click(); await settle(page); assert.equal((await items(page)).length, 0, 'the icon again closes it')
      await row(page, 'systems').click(); await settle(page)
      await page.locator('#ekonav .nsub[data-sub="twin"]').click(); await page.locator('#mount > .twinview').waitFor(); await settle(page)
      assert.equal((await items(page)).length, 0, 'the flyout closes on a choice')
      await page.locator('#ekonav [data-act="navMin"]').click(); await settle(page)   // leave the setting as it was found (it is kept in the browser)
      assert.equal(await page.evaluate(() => window.__loads), 1); assert.deepEqual(page.errors, [])
    } finally { await page.close() }
  })
}

test('Arabic (right to left): every section opens and its items are inside the window', async () => {
  const page = await openFor('eko', { width: 1440, height: 900 }, 'ar')
  try {
    for (const m of await expandable(page)) { await row(page, m).click(); await settle(page); const it = await items(page); assert.ok(it.length && it.every(i => i.shown), m) }
  } finally { await page.close() }
})

test('the collapsed rail: a flyout low in the rail stays inside a short window and nothing covers it', async () => {
  const page = await openFor('eko', { width: 1280, height: 560 })
  try {
    await page.locator('#ekonav [data-act="navMin"]').click(); await settle(page)
    await row(page, 'security').click(); await settle(page)
    const it = await items(page); assert.equal(it.length, 8)
    const r = await page.locator('#ekonav .nsubs').evaluate(n => { const b = n.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight } })
    assert.ok(r.top >= 0 && r.bottom <= r.h, JSON.stringify(r))
    const topmost = await page.locator('#ekonav .nsub').evaluateAll(l => l.every(x => { const b = x.getBoundingClientRect(), e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return x.contains(e) }))
    assert.ok(topmost, 'every item is the topmost element at its centre: no tooltip or panel over it')
  } finally { await page.close() }
})

// ── the full matrix: every expandable section × every item, expected from the live navigation configuration (nothing is listed here by hand) ──
const REPORT = []
const sections = page => page.evaluate(() => window.EKO.nav.modules.filter(m => !m.hidden && document.querySelector(`#ekonav .nvi[data-mod="${m.id}"]`)).map(m => ({ id: m.id, locked: !!m.locked, subs: (m.subs || []).filter(s => !s.hidden).map(s => ({ id: s.id, page: s.pageId, locked: !!s.locked })) })))
/* every item of one section: shown, topmost, opens the right page, is the one marked active */
async function auditSection(page, m, { flyout, tag }) {
  const row = page.locator(`#ekonav .nvi[data-mod="${m.id}"]`), openIt = async () => { await row.click(); await page.waitForTimeout(300) }
  await openIt()
  const live = await page.locator('#ekonav .nsub').evaluateAll(l => l.map(x => ({ sub: x.dataset.sub || null, locked: x.dataset.lock === 'true' })))
  assert.deepEqual(live.filter(i => !i.locked).map(i => i.sub), m.subs.filter(s => !s.locked).map(s => s.id), `${tag} ${m.id}: the items are the configured ones, all of them`)
  assert.equal(live.filter(i => i.locked).length, m.subs.filter(s => s.locked).length, `${tag} ${m.id}: locked items are shown as locked`)
  for (const s of m.subs.filter(x => !x.locked)) {
    if (!(await page.locator(`#ekonav .nsub[data-sub="${s.id}"]`).count())) await openIt()
    const it = page.locator(`#ekonav .nsub[data-mod="${m.id}"][data-sub="${s.id}"]`); await it.scrollIntoViewIfNeeded()
    const ok = await it.evaluate(x => { const b = x.getBoundingClientRect(), e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2), n = document.querySelector('#ekonav').getBoundingClientRect()
      return { topmost: x.contains(e), inWindow: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight, inRail: flyoutless(b, n) }
      function flyoutless(b, n) { return document.querySelector('.dashboard-native-container').dataset.nav === 'min' || (b.top >= n.top - 1 && b.bottom <= n.bottom + 1) } })
    assert.ok(ok.topmost && ok.inWindow && ok.inRail, `${tag} ${m.id}/${s.id}: visible and clickable ${JSON.stringify(ok)}`)
    await it.click(); await page.waitForTimeout(350)
    const st = await page.evaluate(() => ({ page: window.EKO.state.pageId, mod: window.EKO.state.module, sub: window.EKO.state.sub }))
    assert.deepEqual(st, { page: s.page, mod: m.id, sub: s.id }, `${tag} ${m.id}/${s.id}: opens its own page`)
    if (flyout) { assert.equal(await page.locator('#ekonav .nsub').count(), 0, `${tag} ${m.id}: the flyout closes on a choice`); await openIt() }
    assert.equal(await page.locator(`#ekonav .nsub[data-on="true"]`).count(), 1, `${tag} ${m.id}/${s.id}: exactly one item is marked`)
    assert.equal(await page.locator(`#ekonav .nsub[data-on="true"]`).getAttribute('data-sub'), s.id)
    assert.equal(await page.locator(`#ekonav .nvi[data-mod="${m.id}"]`).getAttribute('data-on'), 'contains', `${tag} ${m.id}: the section holding the page is marked`)
  }
}
const MATRIX = [
  ['eko', 1440, 900, 'en', false], ['eko', 1280, 720, 'en', false], ['eko', 1100, 640, 'en', false], ['eko', 1024, 700, 'en', false], ['eko', 1280, 520, 'en', false],
  ['eko', 1440, 900, 'ar', false], ['eko', 1280, 560, 'en', true], ['eko', 1024, 700, 'en', true], ['eko', 1440, 900, 'ar', true],
  ['marsa', 1440, 900, 'en', false], ['marsa', 1100, 640, 'en', false], ['marsa', 1024, 700, 'en', false], ['marsa', 1440, 900, 'ar', false], ['marsa', 1280, 560, 'en', true],
]
for (const [kind, w, h, lang, flyout] of MATRIX) {
  const tag = `${kind} ${w}x${h} ${lang}${flyout ? ' collapsed' : ''}`
  test(`every section, every item: ${tag}`, async () => {
    const page = await openFor(kind, { width: w, height: h }, lang)
    try {
      if (flyout) { await page.locator('#ekonav [data-act="navMin"]').click(); await page.waitForTimeout(300) }
      const all = await sections(page), exp = all.filter(m => m.subs.length && !m.locked)
      assert.ok(exp.length >= 5, 'expandable sections: ' + exp.map(m => m.id))
      for (const m of exp) {
        await auditSection(page, m, { flyout, tag })
        if (!flyout) {   // expand / collapse by the row and by the chevron, with the page staying where it is
          const n = async () => page.locator('#ekonav .nsub').count(), row = page.locator(`#ekonav .nvi[data-mod="${m.id}"]`), ch = page.locator(`#ekonav .nchevb[data-mod="${m.id}"]`)
          await row.click(); await page.waitForTimeout(250); const full = await n(); assert.ok(full > 0)
          await ch.click(); await page.waitForTimeout(250); assert.equal(await n(), 0, `${tag} ${m.id}: the chevron folds it`)
          await ch.click(); await page.waitForTimeout(250); assert.equal(await n(), full, `${tag} ${m.id}: the chevron opens it`)
        }
        REPORT.push([tag, m.id, m.subs.length])
      }
      if (kind === 'marsa') {
        assert.equal(await page.locator('#ekonav .nsub[data-sub="twin"]').count(), 0, 'no Schematic on Marsa')
        assert.ok(!all.some(x => x.subs.some(s => s.id === 'twin')), 'the configuration hides Schematic on Marsa')
      } else assert.ok(all.find(x => x.id === 'systems').subs.some(s => s.id === 'twin'), 'Schematic is configured for the Hospital')
      assert.equal(await page.evaluate(() => window.__loads), 1, 'no page reload'); assert.deepEqual(page.errors, [])
    } finally { await page.close() }
  })
}

test('sections without items are plain links, and locked or hidden ones expose nothing', async () => {
  for (const kind of ['eko', 'marsa']) {
    const page = await openFor(kind)
    try {
      const all = await sections(page), plain = all.filter(m => !m.subs.length && !m.locked)
      for (const m of plain) {
        assert.equal(await page.locator(`#ekonav .nvi[data-mod="${m.id}"] .nchevb`).count(), 0, `${kind} ${m.id}: no chevron without items`)
        await page.locator(`#ekonav .nvi[data-mod="${m.id}"]`).click(); await page.waitForTimeout(300)
        assert.equal(await page.evaluate(() => window.EKO.state.module), m.id, `${kind} ${m.id}: opens its page`)
      }
      for (const m of all.filter(x => x.locked)) assert.equal(await page.locator(`#ekonav .nvi[data-mod="${m.id}"] .nchevb`).count(), 0, `${kind} ${m.id}: a locked section has no chevron`)
      REPORT.push([kind + ' plain', plain.map(m => m.id).join(','), 0])
    } finally { await page.close() }
  }
})
after(() => { for (const r of REPORT) console.log('AUDIT', r.join(' | ')) })
