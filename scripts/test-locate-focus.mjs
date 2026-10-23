// Browser test: Locate in 3D hides ONLY the Asset Register's central table (desktop). The Studio's left
// sidebar, the top bar, the dashboard rail and the selected asset's panel (all five tabs) stay, the model
// strip takes the freed width with no empty column, and Back to Assets / Escape bring the table back.
// Real pointer clicks are hit-tested, so a covered control or pointer-events:none fails; no test calls a
// control handler as a fallback. Narrow (stacked) layouts have no strip: the Overview's full-screen model.
// Supported Studio widths: 1024px and up (desktop layout) and 1023px down to about 800px (stacked). The Studio's
// own 340px sidebar leaves ~50px for the dashboard in a 390px window, so phone width is NOT a Studio layout: it
// is tested on the standalone dashboard (the exported viewer's layout) only.
//
//   1. FAKE_PORT=8010 npm run dev:test      (Vite on :5175, its /api proxied to the FAKE backend, never to :8000)
//   2. APP_URL=http://127.0.0.1:5175 node scripts/test-locate-focus.mjs
//   The fake backend is started here; it refuses an occupied port, and the test stops before any sign-in
//   unless the app under test provably reaches it (scripts/fake-backend.mjs).
//
// Host = the React app with the dashboard overlay (as shipped). Standalone = templates/index.html, for
// the stacked widths the host's own side panel and toolbar leave no room for.
// Needs Playwright (devDependency) and Microsoft Edge, or set PW_CHANNEL=chrome. PYTHON overrides the interpreter.
import assert from 'node:assert'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startFakeBackend, FAKE_APP_URL } from './fake-backend.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = process.env.APP_URL || FAKE_APP_URL
const sleep = ms => new Promise(r => setTimeout(r, ms))

// standalone: the dashboard page alone, no backend (fixture assets)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
const files = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0])
  if (u.startsWith('/api')) { res.writeHead(503); return res.end() }
  const f = u === '/' ? path.join(ROOT, 'templates/index.html') : path.join(ROOT, u)
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f))
}).listen(0)
const STANDALONE = 'http://127.0.0.1:' + files.address().port + '/'

const fake = await startFakeBackend({ root: ROOT, appUrl: APP })   // refuses an occupied port; proves the app reaches the fake
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true })
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ' + name) }

// the host as shipped: an Eko-DT FIN project, signed in, dashboard shown
async function openHost(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const p = await ctx.newPage(), errors = []
  p.on('pageerror', e => errors.push(String(e)))
  await p.goto(APP)
  await p.waitForFunction(() => window.__twin?.stores?.project, null, { timeout: 60000 })
  await p.evaluate(async () => {
    const m = { version: 1, createdAt: 1, updatedAt: 1, models: [], geolocation: null, projectId: 'locate-1', name: 'Locate test',
                isFinProject: true, apiSettings: { finProjectName: 'adnocWarsan' } }
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(m.projectId, { create: true })
    const w = await (await dir.getFileHandle('project.json', { create: true })).createWritable(); await w.write(JSON.stringify(m)); await w.close()
    window.__twin.stores.project.setState({ currentProject: m, folderHandle: dir }); window.__twin.stores.app.getState().setStep('viewing')
  })
  const signIn = p.locator('#fin-username'), connected = p.locator('text=FIN CONNECTED')
  await signIn.or(connected).first().waitFor({ timeout: 30000 })   // the backend keeps one FIN session: signed in once, connected after
  if (await signIn.isVisible()) {
    await signIn.fill('tester'); await p.fill('#fin-password', 'secret')
    await p.click('button:has-text("Connect")')
  }
  await connected.waitFor({ timeout: 15000 })
  const show = p.locator('[title="Show Dashboard"]')
  if (await show.count()) await show.click()
  await p.waitForFunction(() => window.EKO && document.querySelector('.dashboard-native-container #topbar'), null, { timeout: 30000 })
  return { p, ctx, errors }
}
async function openStandalone(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const p = await ctx.newPage(), errors = []
  p.on('pageerror', e => errors.push(String(e)))
  await p.goto(STANDALONE)
  await p.waitForFunction(() => window.EKO && document.querySelector('#topbar'), null, { timeout: 30000 })
  return { p, ctx, errors }
}

// what is on screen: sizes from the rendered layout, the register/summary/rail as the user sees them
const layout = p => p.evaluate(() => {
  const q = s => [...document.querySelectorAll(s)].find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
  const box = s => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  const st = window.EKO.state, root = window.DASHBOARD_ROOT || document.querySelector('.dashboard-native-container')
  const canvas = document.querySelector('.viewer-canvas-container canvas')                    // the host's BIM canvas, under the overlay
  const c = canvas && canvas.getBoundingClientRect(), v = box('#vpmain')
  return {
    pageId: st.pageId, focus: !!st.locFocus, kept: st.locFocus && st.locFocus.assetSel, assetSel: st.assetSel, paint: st.paint, modelFs: !!st.modelFs,
    register: !!q('.dgwrap[data-grid="assets"]'), strip: !!q('.regmodelwrap'),
    viewer: v, mount: box('#mount'), root: box('.dashboard-native-container'), panel: box('#assetpanel'), rail: box('#ekonav'), summary: box('#ovp'), back: box('.vpback, #assetpanel .apback [data-act="locBack"]'), topbar: box('#topbar'),
    overviewText: (q('#ovp') || {}).innerText || '', overflowX: root.scrollWidth > root.clientWidth + 1, stripBox: box('.regmodelwrap'), side: box('aside.sidebar'), panelAsset: (q('#assetpanel .aphead') || {}).textContent || '',
    navMode: root.getAttribute('data-nav'),
    canvasCovers: !c || !v || (c.left <= v.x + 1 && c.top <= v.y + 1 && c.right >= v.x + v.w - 1 && c.bottom >= v.y + v.h - 1),
    saved: [localStorage.getItem('eko-nav'), localStorage.getItem('eko-ovp')],
  }
})
const rows = '.dgwrap[data-grid="assets"] tr[data-asset]'
// Back to Assets: the first row of the asset panel on the desktop; the viewer's own button on the stacked full-screen model
const PANEL_BACK = '#assetpanel .apback [data-act="locBack"]'
const BACK = '.vpback, ' + PANEL_BACK
// until two looks 100ms apart agree: the panel slide-in and the width transitions have finished
const settle = async p => {
  // every finite CSS/JS animation first (the stacked sheet slides in over .25s; a mid-slide box is not where it ends)
  await p.evaluate(() => Promise.allSettled(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished)))
  let a = JSON.stringify(await layout(p)); for (let i = 0; i < 30; i++) { await sleep(100); const b = JSON.stringify(await layout(p)); if (a === b) return; a = b } throw new Error('layout never settled')
}
const register = async p => {
  await p.evaluate(() => window.EKO.go('assets-register', 'assets', 'reg'))
  await p.locator(rows).first().waitFor()
}
// a register row, clicked where a user would: its asset id cell
async function pickRow(p, n) {
  const row = p.locator(rows).nth(n)
  const id = await row.getAttribute('data-asset')
  await row.locator('td.mono').first().click()
  await p.locator(`[data-act="locate"][data-asset="${id}"]`).filter({ visible: true }).first().waitFor()
  await settle(p)
  return id
}
const locate = async (p, id) => {
  await p.locator(`[data-act="locate"][data-asset="${id}"]`).filter({ visible: true }).first().click()
  await p.locator(BACK).first().waitFor()
  await settle(p)
}
// Locate in 3D where the page has no model strip: no focus mode, no Back button, the camera just moves
const locateNoFocus = async (p, id) => {
  await p.locator(`[data-act="locate"][data-asset="${id}"]`).filter({ visible: true }).first().click()
  await sleep(500)
}
// the panel's own x, by a real click (the Studio's Render tab used to cover it)
const closePanel = async p => { await p.locator('#assetpanel [data-act="closeAsset"]').click({ timeout: 5000 }); await p.waitForFunction(() => !window.EKO.state.assetSel) }

// A control a user must reach: its centre and a point near each edge land on the control itself, not on a
// Studio tab, the toolbar or anything else drawn over it (elementFromPoint is what a real pointer hits).
async function assertReachable(p, selector, label) {
  const bad = await p.evaluate(sel => {
    const el = [...document.querySelectorAll(sel)].find(e => e.getClientRects().length)
    if (!el) return 'not on screen'
    const r = el.getBoundingClientRect()
    for (const [fx, fy] of [[.5, .5], [.1, .5], [.9, .5], [.5, .15], [.5, .85]]) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return `off the window at ${Math.round(x)},${Math.round(y)}`
      const t = document.elementFromPoint(x, y)
      if (!t || !(t === el || el.contains(t))) return `covered at ${Math.round(x)},${Math.round(y)} by ${t && (t.title || String(t.className).split(' ')[0] || t.tagName)}`
    }
    return null
  }, selector)
  assert.strictEqual(bad, null, `${label} is reachable: ${bad}`)
}

// The asset panel's five tabs, each by a real pointer click: a tab another element covers cannot be clicked.
const TABS = ['alarms', 'analytics', 'om', 'warranty', 'workorder']
async function clickEveryTab(p, id) {
  for (const k of TABS) await assertReachable(p, `#assetpanel .aptab[data-v="${k}"]`, `the ${k} tab`)
  await assertReachable(p, '#assetpanel [data-act="closeAsset"]', "the panel's close button")
  await assertReachable(p, '#assetpanel [data-act="locate"]', "the panel's Locate in 3D")
  for (const k of TABS) {
    await p.locator(`#assetpanel .aptab[data-v="${k}"]`).click({ timeout: 5000 })
    await p.waitForFunction(k => window.EKO.state.apTab === k, k)
    const body = p.locator('#assetpanel .apbody')
    assert.ok(await body.isVisible(), `the ${k} tab shows its body`)
    assert.strictEqual(await p.locator(`#assetpanel .aptab[data-v="${k}"]`).getAttribute('data-on'), 'true', `${k} is the active tab`)
    assert.ok((await layout(p)).panelAsset.includes(id), `the panel is still for ${id} on the ${k} tab`)
  }
  await p.locator('#assetpanel .aptab[data-v="alarms"]').click()   // leave it as it was
}

// Focus keeps the Studio shell and the selected asset panel. On the desktop register only the table goes:
// its model strip takes the width, so nothing is left empty beside the panel. Stacked layouts use modelFs.
async function assertFocus(p, id, { stacked, saved = [null, null], opened }) {
  const f = await layout(p)
  const ctx = JSON.stringify(f)
  assert.strictEqual(f.register, false, 'the Assets Register table is gone: ' + ctx)
  if (!stacked) {
    assert.ok(f.strip && f.stripBox, 'the desktop model strip remains: ' + ctx)
    assert.ok(f.panel && f.rail && f.topbar, 'Studio chrome and the asset panel remain visible: ' + ctx)
    // the Assets Overview opens FOLDED: just its title and fold control at the model's top left, none of its cards over the model
    const ov = await p.evaluate(() => ({ min: document.getElementById('ovp')?.getAttribute('data-min'), cards: [...document.querySelectorAll('#ovp .ovk')].filter(e => e.getClientRects().length).length }))
    assert.deepStrictEqual([ov.min, ov.cards], ['1', 0], 'the Assets Overview is folded on Locate in 3D, no cards shown: ' + JSON.stringify(ov) + ctx)
    assert.ok(f.summary && f.summary.x >= f.stripBox.x - 1 && f.summary.x + f.summary.w <= f.stripBox.x + f.stripBox.w + 1 && f.summary.h < 80, 'its folded title sits inside the model strip: ' + ctx)
    assert.ok(f.overviewText.toUpperCase().includes('ASSETS OVERVIEW'), 'and says what it is: ' + ctx)
    await assertReachable(p, '#ovp [data-act="ovpMin"]', "the Assets Overview's unfold control")
    assert.ok(f.panelAsset.includes(id), 'the panel still shows the selected asset: ' + ctx)
    // nothing but the table moved: the Studio sidebar, the top bar and the rail are exactly as before
    for (const k of ['side', 'topbar', 'rail']) assert.deepStrictEqual(f[k], opened[k], `${k} is unchanged: ` + ctx)
    // the freed width is used, not reserved: no gap between the strip and the panel, the panel flush right
    assert.ok(Math.abs((f.stripBox.x + f.stripBox.w) - f.panel.x) <= 1, 'no empty column between the model and the panel: ' + ctx)
    assert.ok(Math.abs((f.panel.x + f.panel.w) - (f.root.x + f.root.w)) <= 1, 'the panel is flush with the right edge: ' + ctx)
    assert.ok(f.stripBox.x + f.stripBox.w + f.panel.w >= f.mount.x + f.mount.w - 1, 'the strip and the panel fill the page area: ' + ctx)
  }
  assert.ok(f.back, 'Back to Assets is shown')
  if (!stacked) await assertPanelBackAndDock(p, f)
  assert.deepStrictEqual([f.kept, f.paint], [id, id], 'the asset is kept and stays highlighted: ' + ctx)
  assert.deepStrictEqual(f.saved, saved, 'nothing about the temporary layout is saved')
  if (stacked) assert.strictEqual(f.modelFs, true, 'the model is full screen')
  else assert.ok(f.canvasCovers, 'the 3D canvas covers the desktop model strip: ' + ctx)
  return f
}
// Desktop Locate in 3D: ONE Back to Assets, the first row of the asset panel above the title and its actions (none at the
// bottom of the viewer); the model strip has its own toolbar, the same one every other page has, inside the strip; the
// Assets Overview's fold chevron sits at the edge of its cards, not a column away from them.
async function assertPanelBackAndDock(p, f) {
  const d = await p.evaluate(() => {
    const vis = e => e.getClientRects().length > 0
    const r = e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } }
    const backs = [...document.querySelectorAll('[data-act="locBack"]')].filter(vis)
    const head = document.querySelector('#assetpanel .aphead'), panel = document.querySelector('#assetpanel')
    const bar = [...document.querySelectorAll('#vbar')].filter(vis), strip = document.querySelector('.regmodelwrap')
    const ovk = [...document.querySelectorAll('#ovp .ovk')].filter(vis), fold = document.querySelector('#ovp [data-act="ovpMin"]')
    return {
      backs: backs.length, backInPanel: backs.length === 1 && !!backs[0].closest('#assetpanel'), vpback: document.querySelectorAll('.vpback').length,
      back: backs[0] && r(backs[0]), head: r(head), panel: r(panel),
      bars: bar.length, bar: bar[0] && r(bar[0]), tools: bar[0] ? [...bar[0].querySelectorAll('.vtb[data-v]')].filter(vis).map(b => b.dataset.v) : [], strip: r(strip),
      cardRight: ovk.length ? Math.max(...ovk.map(c => r(c).x + r(c).w)) : null, foldRight: fold && r(fold).x + r(fold).w,
    }
  })
  const ctx = JSON.stringify(d)
  assert.deepStrictEqual([d.backs, d.backInPanel, d.vpback], [1, true, 0], 'exactly one Back to Assets, in the asset panel, none at the bottom of the viewer: ' + ctx)
  assert.ok(d.back.y >= d.panel.y && d.back.y + d.back.h <= d.head.y + 1, "Back to Assets is above the asset title row, at the top of the panel: " + ctx)
  assert.ok(d.back.y - d.panel.y < 60, 'and at the very top: ' + ctx)
  await assertReachable(p, PANEL_BACK, 'Back to Assets (panel top)')
  for (const sel of ['#assetpanel [data-act="aiOpen"]', '#assetpanel [data-act="apWide"]', '#assetpanel [data-act="closeAsset"]']) await assertReachable(p, sel, `the panel's ${sel.split('"')[1]} button stays reachable below Back`)
  // the model strip's toolbar: one instance, inside the strip, every button where a pointer lands on it
  assert.strictEqual(d.bars, 1, 'one toolbar, not two: ' + ctx)
  assert.ok(d.bar.x >= d.strip.x - 1 && d.bar.x + d.bar.w <= d.strip.x + d.strip.w + 1 && d.bar.y + d.bar.h <= d.strip.y + d.strip.h, 'the toolbar is inside the model strip: ' + ctx)
  for (const need of ['select', 'levels', 'reset', 'measure', 'slice', 'layers', 'minimap', 'style']) assert.ok(d.tools.includes(need), `the toolbar has ${need}: ` + ctx)
  for (const tool of d.tools) await assertReachable(p, `#vbar .vtb[data-v="${tool}"]`, `the toolbar's ${tool} button`)
  if (d.cardRight != null) assert.ok(d.foldRight - d.cardRight <= 24, 'the fold chevron is next to the cards, not a column away: ' + ctx)
}

// The asset panel's own splitter: the only one at its edge, a real pointer drag moves it in both directions within its
// declared limits, the strip and the panel keep filling the page, and a double-click puts the width back.
async function assertResize(p) {
  const state = () => p.evaluate(() => {
    const a = document.querySelector('#assetpanel').getBoundingClientRect(), root = document.querySelector('.dashboard-native-container').getBoundingClientRect()
    const s = document.querySelector('.regmodelwrap').getBoundingClientRect(), h = document.querySelector('.sphandle[data-split="panel"]')
    const shown = [...document.querySelectorAll('.sphandle')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.dataset.split)
    const hit = document.elementFromPoint(a.x, a.y + a.height / 2), hh = hit && hit.closest('.sphandle')
    return { x: a.x, y: a.y, h: a.height, w: a.width, rootRight: root.right, stripRight: s.right, shown, hit: hh && hh.dataset.split,
             min: Number(h.getAttribute('aria-valuemin')), max: Number(h.getAttribute('aria-valuemax')) }
  })
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  // the Studio's laptop band (1024-1200px) pins the panel at its minimum width: nothing to drag, so no handle to leave dead
  if (await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#assetpanel')).maxWidth) <= 320)) {
    const shown = await p.evaluate(() => [...document.querySelectorAll('.sphandle')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.dataset.split))
    assert.deepStrictEqual(shown, [], 'the panel is pinned at its minimum here, so it shows no splitter: ' + JSON.stringify(shown))
    return
  }
  const b = await state()
  const ctx = JSON.stringify(b)
  assert.deepStrictEqual(b.shown, ['panel'], 'only the asset panel has a splitter while the model strip is fluid: ' + ctx)
  assert.strictEqual(b.hit, 'panel', 'a pointer at the panel edge lands on its splitter, not on another handle or the viewer: ' + ctx)
  const drag = async dx => {
    const a = await state()
    await p.mouse.move(a.x, a.y + a.h / 2); await p.mouse.down()
    await p.mouse.move(a.x + dx / 2, a.y + a.h / 2, { steps: 4 }); await p.mouse.move(a.x + dx, a.y + a.h / 2, { steps: 4 }); await p.mouse.up()
    await settle(p)
    return state()
  }
  const wider = await drag(-70)                                          // dragging the edge left makes the panel wider
  assert.ok(Math.abs(wider.w - clamp(b.w + 70, b.min, b.max)) <= 2, `dragging left widens the panel within its limits (${b.w} -> ${wider.w}, limits ${b.min}..${b.max}): ` + JSON.stringify(wider))
  assert.ok(wider.x + wider.w <= wider.rootRight + 1 && Math.abs(wider.stripRight - wider.x) <= 1, 'the panel stays in the window and the strip follows it: ' + JSON.stringify(wider))
  assert.deepStrictEqual(wider.shown, ['panel'])
  const narrower = await drag(400)                                       // far right: the panel stops at its minimum
  assert.ok(Math.abs(narrower.w - narrower.min) <= 2 && narrower.w <= wider.w, `dragging right narrows it down to its minimum (${wider.w} -> ${narrower.w}): ` + JSON.stringify(narrower))
  assert.ok(Math.abs(narrower.stripRight - narrower.x) <= 1, 'the strip took the room: ' + JSON.stringify(narrower))
  const widest = await drag(-2000)                                       // far left: it stops at its maximum, inside the window
  assert.ok(widest.w <= widest.max + 2 && widest.x >= 0 && widest.x + widest.w <= widest.rootRight + 1, 'the panel never leaves the window: ' + JSON.stringify(widest))
  await p.locator('.sphandle[data-split="panel"]').dblclick()           // the splitter's own reset
  await settle(p)
}

async function assertRegister(p, id, railMode) {
  const b = await layout(p)
  assert.ok(b.register && !b.back && !b.focus, 'Back to Assets shows the register again: ' + JSON.stringify(b))
  assert.strictEqual(b.summary, null, 'the Assets Overview was only for Locate in 3D, not the register itself: ' + JSON.stringify(b))
  assert.strictEqual(await p.locator('[data-act="locBack"]').count(), 0, 'Back to Assets is only for Locate in 3D')
  assert.strictEqual(b.navMode, railMode, 'the rail is as it was')
  assert.ok(b.rail === null || b.rail.w > 0)
  assert.deepStrictEqual([b.assetSel, b.paint], [id, id], "the asset's panel is open again and it is still highlighted")
  return b
}

// the full workflow: register -> asset -> Locate in 3D -> Back to Assets, twice with two assets
async function workflow(p, { stacked }) {
  await register(p)
  const before = await layout(p)
  assert.ok(before.register && before.navMode === 'full', 'the register is open with the full rail: ' + JSON.stringify(before))
  for (const n of [0, 1]) {
    if (n) await closePanel(p)                                           // the previous asset's panel, reopened by Back
    const id = await pickRow(p, n)
    const opened = await layout(p)                                      // the layout Locate is clicked from
    if (!stacked) {
      assert.ok(opened.panelAsset.includes(id), 'the asset panel shows the selected asset: ' + JSON.stringify(opened))
      // the register itself (before Locate): the panel sits inside the dashboard, which does not scroll sideways,
      // and its close button is not under a Studio tab
      assert.strictEqual(opened.summary, null, 'the register itself shows no Assets Overview: ' + JSON.stringify(opened))
      assert.strictEqual(opened.overflowX, false, 'the register does not overflow the dashboard sideways: ' + JSON.stringify(opened))
      assert.ok(opened.panel.x >= opened.root.x && opened.panel.x + opened.panel.w <= opened.root.x + opened.root.w, 'the asset panel is inside the dashboard: ' + JSON.stringify(opened))
      await assertReachable(p, '#assetpanel [data-act="closeAsset"]', "the panel's close button (register)")
    }
    await locate(p, id)
    await assertFocus(p, id, { stacked, opened })
    await assertReachable(p, stacked ? '.vpback' : PANEL_BACK, 'Back to Assets')
    if (!stacked) await clickEveryTab(p, id)
    if (!stacked) await assertResize(p)
    await p.locator(stacked ? '.vpback' : PANEL_BACK).click()
    await p.locator(rows).first().waitFor()
    await settle(p)
    const b = await assertRegister(p, id, 'full')
    if (!stacked) assert.deepStrictEqual([b.viewer, b.panel && b.panel.w], [opened.viewer, opened.panel && opened.panel.w], 'the register layout is as before')
  }
}

try {
  try { await fetch(APP) } catch { throw new Error(`no app at ${APP}: start it with npm run dev`) }

  for (const width of [1920, 1400, 1200, 1100, 1024]) await test(`host ${width}px: select -> Locate in 3D (only the table goes, five tabs) -> Back to Assets, twice`, async () => {
    const { p, ctx, errors } = await openHost(width)
    await workflow(p, { stacked: false })
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  // The Studio is not a phone layout (see the header): 1023px and 800px are the stacked widths it does have.
  for (const width of [1023, 800]) await test(`host ${width}px (stacked): the asset sheet's Locate in 3D is reachable, opens the model, Back returns`, async () => {
    const { p, ctx, errors } = await openHost(width)
    await register(p)
    const id = await pickRow(p, 0)
    await assertReachable(p, `#assetpanel [data-act="locate"][data-asset="${id}"]`, "the sheet's Locate in 3D (the Studio toolbar must not cover it)")
    await assertReachable(p, '#assetpanel [data-act="closeAsset"]', "the sheet's close button")
    await locate(p, id)                                                   // a real click: it fails if the button is covered
    const f = await layout(p)
    assert.deepStrictEqual([f.modelFs, f.focus, f.pageId], [true, true, 'marsa-overview'], JSON.stringify(f))
    await assertReachable(p, '.vpback', 'Back to Assets')
    assert.strictEqual(await p.locator('[data-act="locBack"]').filter({ visible: true }).count(), 1, 'one Back to Assets on the full-screen model')
    await p.locator('.vpback').click()
    await p.locator(rows).first().waitFor()
    await settle(p)
    const b = await layout(p)
    assert.deepStrictEqual([b.pageId, b.focus, b.modelFs, b.register], ['assets-register', false, false, true], JSON.stringify(b))
    assert.ok(b.panelAsset.includes(id), 'the asset sheet is open again for the same asset')
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  // The Studio's side panels keep their bodies hidden past the canvas's right edge (only --right-tab-w shows). A focus or
  // scrollIntoView in them used to scroll the whole canvas and dashboard sideways (the canvas is overflow:hidden, which
  // can still scroll); it is overflow:clip now. No model is needed: scroll the hidden body into view and look.
  await test('host: nothing can scroll the Studio canvas sideways (a hidden panel body brought into view)', async () => {
    const { p, ctx, errors } = await openHost(1400)
    await p.locator('#assetpanel, .dashboard-native-container #topbar').first().waitFor()
    const r = await p.evaluate(() => {
      const wrap = document.querySelector('.viewer-canvas-wrapper'), ov = document.querySelector('.dashboard-overlay-container')
      const body = document.querySelector('.position-panel-body'), before = Math.round(ov.getBoundingClientRect().x)
      body.scrollIntoView({ inline: 'end' }); body.querySelector('input, select, button')?.focus()
      return { before, after: Math.round(ov.getBoundingClientRect().x), scrollLeft: wrap.scrollLeft, overflow: getComputedStyle(wrap).overflowX, hadBody: !!body }
    })
    assert.ok(r.hadBody, 'the Studio has its side panels: ' + JSON.stringify(r))
    assert.deepStrictEqual([r.scrollLeft, r.after, r.overflow], [0, r.before, 'clip'], 'the canvas did not move: ' + JSON.stringify(r))
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  // Not part of Locate in 3D: the Energy Summary page shares the dashboard's width, the model view and the right-hand
  // panel with the pages changed above, so it must still fit, show its summary and timeline, and not sit under a Studio tab.
  for (const width of [1920, 1400, 1100]) await test(`host ${width}px: the Energy Summary page still renders inside the dashboard, nothing covered`, async () => {
    const { p, ctx, errors } = await openHost(width)
    await p.locator('#ekonav [data-act="goMod"][data-mod="energy"]').click()
    await p.waitForFunction(() => window.EKO.state.pageId === 'energy')
    await p.locator('#ovp').waitFor()
    await settle(p)
    const f = await p.evaluate(() => {
      const q = s => [...document.querySelectorAll(s)].find(e => e.getClientRects().length)
      const r = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
      const root = document.querySelector('.dashboard-native-container')
      return { root: r(root), overflowX: root.scrollWidth > root.clientWidth + 1, summary: r(q('#ovp')), panel: r(q('#modpanel')), timeline: r(q('#vpmain .scrubbar')), top: r(q('#topbar')) }
    })
    const ctxs = JSON.stringify(f)
    assert.strictEqual(f.overflowX, false, 'the Energy page does not overflow the dashboard sideways: ' + ctxs)
    assert.ok(f.summary && f.summary.h > 100, 'the Energy Summary is shown: ' + ctxs)
    assert.ok(f.timeline && f.timeline.w > 100, 'the 3D view keeps its timeline: ' + ctxs)
    assert.ok(f.panel && f.panel.x + f.panel.w <= f.root.x + f.root.w + 1, 'the right-hand energy panel is inside the dashboard: ' + ctxs)
    await assertReachable(p, '#topbar [data-act="nfTgl"]', 'the notification bell (top right)')
    await assertReachable(p, '#modpanel', 'the energy panel')
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  // The Assets Overview opens folded on Locate in 3D; its own control unfolds it and folds it again, for that visit only: the
  // user's saved fold (eko-ovp) is neither read nor written, and Back and the right panel are unaffected.
  await test('host: the Assets Overview opens folded on Locate in 3D and unfolds and folds by a real click; nothing is saved', async () => {
    const { p, ctx, errors } = await openHost(1400)
    await register(p)
    const id = await pickRow(p, 0)
    await locate(p, id)
    const state = () => p.evaluate(() => ({ min: document.getElementById('ovp')?.getAttribute('data-min'), cards: [...document.querySelectorAll('#ovp .ovk')].filter(e => e.getClientRects().length).length, saved: localStorage.getItem('eko-ovp') }))
    assert.deepStrictEqual(await state(), { min: '1', cards: 0, saved: null }, 'folded on arrival, nothing saved')
    await assertReachable(p, PANEL_BACK, 'Back to Assets (summary folded)')
    await p.locator('#ovp [data-act="ovpMin"]').click()
    await p.waitForFunction(() => document.getElementById('ovp')?.getAttribute('data-min') === '0')
    await settle(p)
    const open = await layout(p)
    for (const label of ['ASSETS REGISTERED', 'OPEN WORK ORDERS', 'ASSETS IN ALARM']) assert.ok(open.overviewText.toUpperCase().includes(label), `unfolded, the Overview shows ${label}`)
    assert.deepStrictEqual((await state()).saved, null, 'unfolding is this visit only, nothing saved')
    await assertPanelBackAndDock(p, open)                       // unfolded, its chevron is still next to the cards
    await assertReachable(p, '#assetpanel [data-act="closeAsset"]', "the panel's close button (summary open)")
    assert.ok(open.panelAsset.includes(id), 'the asset panel is still for the selected asset')
    await p.locator('#ovp [data-act="ovpMin"]').click()
    await p.waitForFunction(() => document.getElementById('ovp')?.getAttribute('data-min') === '1')
    await p.locator(PANEL_BACK).click()
    await p.locator(rows).first().waitFor()
    await settle(p)
    assert.deepStrictEqual(await p.evaluate(() => ({ overview: !!document.getElementById('ovp'), saved: localStorage.getItem('eko-ovp') })), { overview: false, saved: null }, 'back on the register: no overview, the saved fold untouched')
    // and a fresh Locate folds it again, whatever the last visit did
    await closePanel(p)                                          // Back reopens the asset's panel; close it to pick again
    await locate(p, await pickRow(p, 0))
    assert.strictEqual((await state()).min, '1', 'folded again on the next Locate in 3D')
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  await test('host: the asset panel stays inside the window and resizable when the window is resized during Locate in 3D', async () => {
    const { p, ctx, errors } = await openHost(1400)
    await register(p)
    const id = await pickRow(p, 0)
    await locate(p, id)
    for (const width of [1200, 1024, 1500]) {
      await p.setViewportSize({ width, height: 900 })
      await settle(p)
      const f = await layout(p)
      assert.ok(f.panel.x >= f.root.x && f.panel.x + f.panel.w <= f.root.x + f.root.w + 1, `the panel is inside the dashboard at ${width}px: ` + JSON.stringify(f))
      assert.ok(Math.abs(f.stripBox.x + f.stripBox.w - f.panel.x) <= 1, `no gap between the model and the panel at ${width}px: ` + JSON.stringify(f))
      await assertPanelBackAndDock(p, f)
      await assertResize(p)
    }
    await p.locator(PANEL_BACK).click()
    await p.locator(rows).first().waitFor()
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  // Back to Assets is in the asset panel now, so a view whose panel is gone must not stay stuck on the model: closing the
  // panel (x), or Reset clearing the selection from the strip's own toolbar, brings the table back.
  for (const how of ['close', 'reset']) await test(`host: ${how === 'close' ? "closing the asset panel" : "the toolbar's Reset"} during Locate in 3D brings the register back, never a view with no way out`, async () => {
    const { p, ctx, errors } = await openHost(1400)
    await register(p)
    const id = await pickRow(p, 0)
    await locate(p, id)
    if (how === 'close') await p.locator('#assetpanel [data-act="closeAsset"]').click()
    else await p.locator('#vbar .vtb[data-v="reset"]').click()
    await p.locator(rows).first().waitFor()
    await settle(p)
    const b = await layout(p)
    assert.ok(b.register && !b.focus && !b.back && !b.panel && b.assetSel === null, 'the table is back, with no Locate focus and no half-open view: ' + JSON.stringify(b))
    assert.strictEqual(await p.locator('[data-act="locBack"]').count(), 0)
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  await test('host: a rail the user had folded stays folded after Back to Assets', async () => {
    const { p, ctx, errors } = await openHost(1400)
    await register(p)
    await p.evaluate(() => { localStorage.setItem('eko-nav', 'min'); window.EKO.set({ navMin: true }) })
    const id = await pickRow(p, 0)
    const opened = await layout(p)
    await locate(p, id)
    await assertFocus(p, id, { stacked: false, saved: ['min', null], opened })   // the user's own folded rail, untouched
    await assertResize(p)                                                         // the panel still resizes with the rail folded
    await p.locator(PANEL_BACK).click()
    await p.locator(rows).first().waitFor()
    const b = await assertRegister(p, id, 'min')
    assert.strictEqual(b.saved[0], 'min')
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  await test('host: a model strip the user had folded opens for Locate in 3D and is folded again after Back', async () => {
    const { p, ctx, errors } = await openHost(1400)
    await register(p)
    await p.locator('.regcollapse').click()                              // the strip's own fold chevron, by a real click
    await p.waitForFunction(() => window.EKO.state.regMin === true)
    const id = await pickRow(p, 0)
    const folded = await layout(p)
    assert.ok(folded.stripBox.w <= 40, 'the strip is folded: ' + JSON.stringify(folded.stripBox))
    await locate(p, id)
    const f = await layout(p)
    assert.ok(f.stripBox.w > 200 && !f.register, 'the model gets the room: ' + JSON.stringify(f))
    await p.locator(PANEL_BACK).click()
    await p.locator(rows).first().waitFor()
    await settle(p)
    assert.ok((await layout(p)).stripBox.w <= 40, 'folded again')
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  await test('host: Locate in 3D from the Overview only moves the camera: summary and asset panel stay, no focus', async () => {
    const { p, ctx, errors } = await openHost(1400)
    await p.evaluate(() => window.EKO.go('marsa-overview', 'overview', null))
    await p.locator('[data-act="openAsset"][data-asset]').filter({ visible: true }).first().waitFor()
    const id = await p.locator('[data-act="openAsset"][data-asset]').filter({ visible: true }).first().getAttribute('data-asset')
    await p.locator('[data-act="openAsset"][data-asset]').filter({ visible: true }).first().click()
    await p.locator(`[data-act="locate"][data-asset="${id}"]`).filter({ visible: true }).first().waitFor()
    await settle(p)
    await locateNoFocus(p, id)
    const f = await layout(p)
    assert.deepStrictEqual([f.focus, !!f.back, !!f.panel, f.pageId], [false, false, true, 'marsa-overview'], JSON.stringify(f))
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  await test('host: Escape leaves focus like Back to Assets (the panel stays); the logo leaves it for the normal Overview', async () => {
    const { p, ctx, errors } = await openHost(1400)
    await register(p)
    let id = await pickRow(p, 0)
    await locate(p, id)
    await p.keyboard.press('Escape')
    await p.locator(rows).first().waitFor()
    await assertRegister(p, id, 'full')
    assert.ok((await layout(p)).panelAsset.includes(id), 'the asset panel survived Escape')
    await locate(p, id)
    await p.locator('.brandslot').click()
    await sleep(400)
    const s = await layout(p)
    assert.ok(!s.focus && !s.back && s.rail && s.summary && s.pageId === 'marsa-overview', 'the normal Overview: ' + JSON.stringify(s))
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  for (const width of [800, 390]) await test(`standalone ${width}px (stacked): Locate in 3D opens the model full screen, Back returns`, async () => {
    const { p, ctx, errors } = await openStandalone(width)
    await workflow(p, { stacked: true })
    assert.strictEqual(await p.evaluate(() => window.EKO.state.modelFs), false)
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })
} finally {
  await browser.close()
  files.close()
  fake.stop()
}
console.log(`\n${passed} locate-focus tests passed`)
