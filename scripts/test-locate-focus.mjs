// Browser test: Locate in 3D leaves the Assets Register for the full 3D view (rail and summary folded),
// and Back to Assets brings the register back. Real pointer clicks (hit-tested, so a control covered by
// another element or with pointer-events:none fails) and rendered layout, not handler calls.
//
//   1. npm run dev                       (Vite on :5173, proxying /api/fin to :8000)
//   2. make sure nothing listens on :8000 (this script starts the backend with a FAKE FIN client)
//   3. node scripts/test-locate-focus.mjs
//
// Host = the React app with the dashboard overlay (as shipped). Standalone = templates/index.html, for
// the stacked widths the host's own side panel and toolbar leave no room for.
// Needs Playwright (devDependency) and Microsoft Edge, or set PW_CHANNEL=chrome. PYTHON overrides the interpreter.
import assert from 'node:assert'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = process.env.APP_URL || 'http://localhost:5173'
const API = 'http://127.0.0.1:8000'
const python = process.env.PYTHON || path.join(ROOT, 'backend', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
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

const backend = spawn(python, ['tests/fake_fin_server.py', '--port', '8000'], { cwd: path.join(ROOT, 'backend'), stdio: 'ignore' })
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true })
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ' + name) }

async function waitBackend() {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(API + '/api/fin/status')).ok) return } catch {} await sleep(300) }
  throw new Error('fake backend did not start on :8000')
}

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
    viewer: v, mount: box('#mount'), panel: box('#assetpanel'), rail: box('#ekonav'), summary: box('#ovp'), back: box('.vpback'),
    navMode: root.getAttribute('data-nav'),
    canvasCovers: !c || !v || (c.left <= v.x + 1 && c.top <= v.y + 1 && c.right >= v.x + v.w - 1 && c.bottom >= v.y + v.h - 1),
    saved: [localStorage.getItem('eko-nav'), localStorage.getItem('eko-ovp')],
  }
})
const rows = '.dgwrap[data-grid="assets"] tr[data-asset]'
// until two looks 100ms apart agree: the panel slide-in and the width transitions have finished
const settle = async p => { let a = JSON.stringify(await layout(p)); for (let i = 0; i < 30; i++) { await sleep(100); const b = JSON.stringify(await layout(p)); if (a === b) return; a = b } throw new Error('layout never settled') }
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
  await p.locator('.vpback').waitFor()
  await settle(p)
}
// ponytail: Escape, not the panel's x: in the host its Render side tab covers that corner (a host overlap, not this feature)
const closePanel = async p => { await p.keyboard.press('Escape'); await p.waitForFunction(() => !window.EKO.state.assetSel) }

// focus mode as the user sees it: the 3D view alone, the asset kept and still highlighted
async function assertFocus(p, id, { stacked, saved = [null, null] }) {
  const f = await layout(p)
  const ctx = JSON.stringify(f)
  assert.strictEqual(f.register, false, 'the Assets Register is gone: ' + ctx)
  assert.strictEqual(f.strip, false)
  assert.strictEqual(f.summary, null, 'no Overview summary over the model: ' + ctx)
  assert.strictEqual(f.panel, null, 'no asset panel taking width: ' + ctx)
  assert.strictEqual(f.rail, null, 'no navigation rail: ' + ctx)
  assert.ok(f.back, 'Back to Assets is shown')
  assert.deepStrictEqual([f.kept, f.paint], [id, id], 'the asset is kept and stays highlighted: ' + ctx)
  assert.deepStrictEqual(f.saved, saved, 'nothing about the temporary layout is saved')
  if (stacked) assert.strictEqual(f.modelFs, true, 'the model is full screen')
  else {
    // the viewer fills the whole page area: nothing beside it, nothing over it
    assert.ok(f.viewer.x <= f.mount.x + 1 && f.viewer.w >= f.mount.w - 1, 'the 3D view takes the whole page width: ' + ctx)
    assert.ok(f.canvasCovers, 'the 3D canvas covers the whole viewer: ' + ctx)
  }
  return f
}
async function assertRegister(p, id, railMode) {
  const b = await layout(p)
  assert.ok(b.register && !b.back && !b.focus, 'Back to Assets shows the register again: ' + JSON.stringify(b))
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
    await locate(p, id)
    await assertFocus(p, id, { stacked })
    await p.locator('.vpback').click()
    await p.locator(rows).first().waitFor()
    await settle(p)
    const b = await assertRegister(p, id, 'full')
    // the strip and the panel as before; not the panel's x: in the host the register already overflows by a content-dependent amount
    if (!stacked) assert.deepStrictEqual([b.viewer, b.panel && b.panel.w], [opened.viewer, opened.panel && opened.panel.w], 'the register layout is as before')
  }
}

try {
  await waitBackend()
  try { await fetch(APP) } catch { throw new Error(`no app at ${APP}: start it with npm run dev`) }

  for (const width of [1400, 1100]) await test(`host ${width}px: select -> Locate in 3D -> Back to Assets, twice`, async () => {
    const { p, ctx, errors } = await openHost(width)
    await workflow(p, { stacked: false })
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  await test('host: a rail the user had folded stays folded after Back to Assets', async () => {
    const { p, ctx, errors } = await openHost(1400)
    await register(p)
    await p.evaluate(() => { localStorage.setItem('eko-nav', 'min'); window.EKO.set({ navMin: true }) })
    const id = await pickRow(p, 0)
    await locate(p, id)
    await assertFocus(p, id, { stacked: false, saved: ['min', null] })   // the user's own folded rail, untouched
    await p.locator('.vpback').click()
    await p.locator(rows).first().waitFor()
    const b = await assertRegister(p, id, 'min')
    assert.strictEqual(b.saved[0], 'min')
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  await test('host: Escape leaves focus like Back to Assets; the logo leaves it for the normal Overview', async () => {
    const { p, ctx, errors } = await openHost(1400)
    await register(p)
    let id = await pickRow(p, 0)
    await locate(p, id)
    await p.keyboard.press('Escape')
    await p.locator(rows).first().waitFor()
    await assertRegister(p, id, 'full')
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
  backend.kill()
}
console.log(`\n${passed} locate-focus tests passed`)
