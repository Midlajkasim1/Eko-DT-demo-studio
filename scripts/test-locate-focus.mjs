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
  const w = s => { const e = q(s); return e ? Math.round(e.getBoundingClientRect().width) : 0 }
  const ovp = q('#ovp'), root = window.DASHBOARD_ROOT || document.querySelector('.dashboard-native-container')
  return {
    pageId: window.EKO.state.pageId,
    register: !!q('.dgwrap[data-grid="assets"]'), strip: !!q('.regmodelwrap'),
    viewer: w('#vpmain'), mount: w('#mount'), panel: w('#assetpanel'), rail: w('#ekonav'),
    navMode: root.getAttribute('data-nav'),
    summaryFolded: ovp ? ovp.dataset.min === '1' : null, summaryHeight: ovp ? Math.round(ovp.getBoundingClientRect().height) : 0,
    back: !!q('.vpback'), fits: (m => !m || m.scrollWidth <= m.clientWidth + 1)(document.querySelector('#mount')),
    saved: [localStorage.getItem('eko-nav'), localStorage.getItem('eko-ovp')],
  }
})
const register = async p => {
  await p.evaluate(() => window.EKO.go('assets-register', 'assets', 'reg'))
  await p.locator('.dgwrap[data-grid="assets"] tr[data-asset]').first().waitFor()
}
// a register row, clicked where a user would: its asset id cell
async function pickRow(p, n) {
  const row = p.locator('.dgwrap[data-grid="assets"] tr[data-asset]').nth(n)
  const id = await row.getAttribute('data-asset')
  await row.locator('td.mono').first().click()
  await p.locator(`[data-act="locate"][data-asset="${id}"]`).filter({ visible: true }).first().waitFor()
  return id
}
const locate = (p, id) => p.locator(`[data-act="locate"][data-asset="${id}"]`).filter({ visible: true }).first().click()

// the full workflow: register -> asset -> Locate in 3D -> Back to Assets, twice with two assets
async function workflow(p, { stacked }) {
  await register(p)
  const before = await layout(p)
  assert.ok(before.register && before.navMode === 'full', 'the register is open with the full rail: ' + JSON.stringify(before))
  const stripViewer = before.viewer
  const panelOpen = { fits: null }
  for (const n of [0, 1]) {
    const id = await pickRow(p, n)
    panelOpen.fits = (await layout(p)).fits                                // the register with the asset panel, as clicked from
    await locate(p, id)
    await p.locator('.vpback').waitFor()
    await sleep(400)                                                     // the rail's width transition
    const f = await layout(p)
    assert.strictEqual(f.register, false, 'the Assets Register is no longer on screen')
    assert.strictEqual(f.strip, false)
    assert.strictEqual(f.summaryFolded, true, 'the Overview summary is folded')
    assert.ok(f.summaryHeight < 80, 'the folded summary is only its header: ' + f.summaryHeight)
    assert.deepStrictEqual(f.saved, [null, null], 'the temporary layout is never saved')
    assert.strictEqual(await p.evaluate(() => window.EKO.state.assetSel), id, 'the asset stays selected')
    if (stacked) {
      assert.strictEqual(await p.evaluate(() => window.EKO.state.modelFs), true, 'the model is full screen')
    } else {
      assert.strictEqual(f.navMode, 'min'); assert.ok(f.rail <= 64, 'the rail is folded: ' + f.rail)
      // ponytail: only where the register fit; a too-narrow host already pushes the asset panel off-screen there
      if (panelOpen.fits) assert.ok(f.viewer > stripViewer, `the 3D view grows past the register's strip: ${stripViewer} -> ${f.viewer}`)
      assert.ok(f.viewer >= f.mount - f.panel - 2, `the 3D view takes all the room beside the asset panel: ${JSON.stringify(f)}`)
    }
    await p.locator('.vpback').click()
    await p.locator('.dgwrap[data-grid="assets"] tr[data-asset]').first().waitFor()
    await sleep(400)
    const b = await layout(p)
    assert.ok(b.register && !b.back, 'Back to Assets shows the register again: ' + JSON.stringify(b))
    assert.strictEqual(b.navMode, 'full', 'the rail is back')
    assert.strictEqual(b.viewer, stripViewer, 'the register layout is as it was')
    assert.strictEqual(await p.evaluate(() => !!window.EKO.state.locFocus), false)
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
    await p.locator('.vpback').click()
    await p.locator('.dgwrap[data-grid="assets"] tr[data-asset]').first().waitFor()
    const b = await layout(p)
    assert.deepStrictEqual([b.navMode, b.saved[0]], ['min', 'min'])
    assert.deepStrictEqual(errors, [])
    await ctx.close()
  })

  await test('host: leaving the 3D view by the rail also restores the panels', async () => {
    const { p, ctx, errors } = await openHost(1400)
    await register(p)
    await locate(p, await pickRow(p, 0))
    await p.locator('.vpback').waitFor()
    await p.locator('#ekonav [data-act="goMod"][data-mod="energy"]').click()
    await sleep(400)
    const s = await layout(p)
    assert.deepStrictEqual([s.navMode, s.back, s.summaryFolded === true], ['full', false, false])
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
