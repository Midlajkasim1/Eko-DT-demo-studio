// Browser test: per-browser sign-in in the Studio's FIN Connect and the exported viewer.
// A browser counts as signed in only with its own session (/api/auth/me), never because another
// browser connected FIN; the bell loads only after that, and says why when it cannot.
//
//   1. FAKE_PORT=8010 npm run dev:test    (Vite on :5175, proxying /api to the fake backend on :8010)
//   2. APP_URL=http://127.0.0.1:5175 node scripts/test-auth-sessions.mjs
//      (the fake backend is started by the script and refuses an occupied port; see scripts/README.md)
//
// Each browser below is its own Playwright context: its own cookies, as two people on two machines.
// Needs Playwright (devDependency) and Microsoft Edge, or set PW_CHANNEL=chrome. PYTHON overrides the interpreter.
import { chromium } from 'playwright'
import { startFakeBackend, FAKE_APP_URL } from './fake-backend.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = process.env.APP_URL || FAKE_APP_URL

let failures = 0
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++ }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 15000) => {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) { try { last = await fn(); if (last) return last } catch { /* retry */ } await sleep(150) }
  throw new Error('timed out waiting for ' + what + (last !== undefined ? ' (last: ' + JSON.stringify(last) + ')' : ''))
}

const server = await startFakeBackend({ root: ROOT, appUrl: APP })   // stops here, before any sign-in, unless it is the one backend APP reaches
const API = server.api
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true })
const errors = []

// ── the Studio ───────────────────────────────────────────────────────────────────────────────
// open an Eko-DT FIN project in a fresh browser (its own cookie jar), as the user would
async function studio(projectId = 'auth-1', finProjectName = 'adnocWarsan') {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(APP)
  await page.waitForFunction(() => window.__twin?.stores?.project, null, { timeout: 60000 })
  await page.evaluate(async ({ projectId, finProjectName }) => {
    const m = { version: 1, createdAt: 1, updatedAt: 1, models: [], geolocation: null, projectId, name: 'Auth ' + projectId,
                isFinProject: true, apiSettings: { finProjectName } }
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(m.projectId, { create: true })
    const w = await (await dir.getFileHandle('project.json', { create: true })).createWritable(); await w.write(JSON.stringify(m)); await w.close()
    window.__twin.stores.project.setState({ currentProject: m, folderHandle: dir }); window.__twin.stores.app.getState().setStep('viewing')
  }, { projectId, finProjectName })
  return { ctx, page }
}
const fin = page => page.evaluate(() => { const s = window.__twin.stores.fin?.getState?.(); return s ? { c: s.isConnected, check: s.sessionCheck, user: s.session?.user_id } : null })
const formShown = page => page.locator('#fin-username').isVisible().catch(() => false)
const connect = async (page, user, typedProject) => {
  await page.waitForSelector('#fin-username')
  await page.fill('#fin-username', user); await page.fill('#fin-password', 'secret')
  if (typedProject) { await page.click('button:has-text("Advanced")'); await page.fill('#fin-project', typedProject) }
  await page.click('button:has-text("Connect")')
  await page.waitForSelector('[data-testid="fin-signed-in-as"]', { timeout: 15000 })
  const show = page.locator('[title="Show Dashboard"]')
  if (await show.count()) await show.click()
  await page.waitForFunction(() => window.EKO_NOTIF && window.EKO_NOTIF.remoteState, null, { timeout: 30000 })
}
// the dashboard's bell: the store's state, and what the open panel says
const bellState = page => page.evaluate(() => window.EKO_NOTIF && window.EKO_NOTIF.remoteState ? window.EKO_NOTIF.remoteState() : 'no-store')
async function dashboard(page) {
  const show = page.locator('[title="Show Dashboard"]')   // the Studio's dashboard is a toolbar toggle
  if (await show.count()) await show.click()
  await page.waitForFunction(() => window.EKO && document.querySelector('[data-act="nfTgl"]') && window.EKO_NOTIF?.remoteState
    && window.EKO_NOTIF.remoteState() !== 'checking', null, { timeout: 30000 })   // the session check has answered
}
async function bellNotice(page) {
  await dashboard(page)
  if (!(await page.locator('.nfpanel').count())) await page.click('[data-act="nfTgl"]')
  await page.waitForSelector('.nfpanel')
  await page.waitForFunction(() => !document.querySelector('.nfpanel .nfload'), null, { timeout: 10000 })   // the open shimmer
  return page.evaluate(() => { const n = document.querySelector('.nfpanel .nfauth'); return n ? { state: n.dataset.state, text: n.textContent.trim() } : null })
}

try {
  // A connects as before: the Connect form, then the connected panel with who is signed in
  const A = await studio()
  await until(async () => (await fin(A.page))?.check === 'signed_out', 'A: no session yet')
  check(await formShown(A.page), 'A, fresh browser, nothing connected: the FIN Connect form is shown')
  check(['no-store', 'signin'].includes(await bellState(A.page)), 'A: nothing is read for the bell before this browser signs in')
  await connect(A.page, 'alice')
  check((await A.page.textContent('[data-testid="fin-signed-in-as"]')).includes('alice'), 'A: the panel says who is signed in (from the server)')
  check((await until(async () => (await bellState(A.page)) === 'ok' && 'ok', 'A bell ok')) === 'ok', 'A: after the session is confirmed the bell loads')
  check((await bellNotice(A.page)) === null, 'A: the open bell shows no sign-in or error notice')

  // B, another browser, while FIN is already connected for A
  const B = await studio()
  await until(async () => (await fin(B.page))?.check === 'signed_out', 'B: no session')
  const st = await B.page.evaluate(() => fetch('/api/fin/status').then(r => r.json()))
  check(st.connected === true, 'B: the backend IS connected to FIN (A connected it)')
  check(await formShown(B.page), 'B: still prompted to sign in: a shared FIN connection signs nobody in')
  check(await B.page.locator('[data-testid="fin-shared-hint"]').isVisible(), 'B: the form says FIN is connected from another browser')
  const bNotice = await bellNotice(B.page)
  check(bNotice?.state === 'signin', 'B: the bell asks to sign in: ' + JSON.stringify(bNotice) + ' state=' + await bellState(B.page)
    + ' panel=' + JSON.stringify(await B.page.evaluate(() => document.querySelector('.nfpanel')?.innerText.slice(0, 160))))
  const bList = await B.page.evaluate(() => window.EKO_NOTIF.list().filter(n => n.remote).length)
  check(bList === 0, 'B: no server notification reaches a browser without a session')
  await connect(B.page, 'bob')
  await until(async () => (await bellState(B.page)) === 'ok', 'B bell ok after sign-in')
  check((await bellNotice(B.page)) === null, 'B: signed in, the bell loads')

  // a client-supplied name changes nothing: the server says who each browser is
  const forged = await A.page.evaluate(() => fetch('/api/auth/me', { headers: { 'X-Eko-User': 'bob', 'X-Eko-Role': 'admin' } }).then(r => r.json()))
  check(forged.user_id === 'alice' && forged.role === null, 'A: forged user/role headers do not change who A is')

  // 409: B signs in for the same Eko-DT project but another FIN project (typed in Advanced)
  await B.page.click('button:has-text("Disconnect")')
  await until(async () => (await fin(B.page))?.check === 'signed_out', 'B signed out')
  await connect(B.page, 'bob', 'otherSite')
  await A.page.evaluate(() => window.EKO_NOTIF.refresh())
  const aMismatch = await until(async () => { const n = await bellNotice(A.page); return n?.state === 'mismatch' && n }, 'A mismatch notice')
  check(/another project/i.test(aMismatch.text), 'A: 409, signed in for another FIN project: the bell explains the mismatch: ' + aMismatch.text)

  // 409: the backend now serves another Eko-DT project than A's dashboard
  const C = await studio('auth-2', 'adnocWarsan')
  await connect(C.page, 'carol')
  await A.page.evaluate(() => window.EKO_NOTIF.refresh())
  const aOther = await until(async () => { const n = await bellNotice(A.page); return n?.state === 'mismatch' && n }, 'A server-other notice')
  check(/showing another project/i.test(aOther.text), 'A: 409, the server serves another project: said so: ' + aOther.text)
  // back to A's project for the rest
  await C.page.click('button:has-text("Disconnect")')
  await B.page.click('button:has-text("Disconnect")')
  await A.page.click('button:has-text("Disconnect")')
  await until(async () => (await fin(A.page))?.check === 'signed_out', 'A signed out')
  await connect(A.page, 'alice')
  await until(async () => (await bellState(A.page)) === 'ok', 'A ok again')

  // a server error is retryable, and Retry recovers
  await A.page.route('**/api/notifications/v1/notifications?*', r => r.fulfill({ status: 500, contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'storage_failed', message: 'notification storage failed', details: {} } }) }))
  await A.page.evaluate(() => window.EKO_NOTIF.refresh())
  const err = await until(async () => { const n = await bellNotice(A.page); return n?.state === 'error' && n }, 'A error notice')
  check(await A.page.locator('.nfpanel [data-act="nfRetryRemote"]').isVisible(), 'A: a server error shows Retry: ' + err.text)
  await A.page.unroute('**/api/notifications/v1/notifications?*')
  await A.page.click('.nfpanel [data-act="nfRetryRemote"]')
  await until(async () => (await bellState(A.page)) === 'ok', 'A ok after Retry')
  check((await bellNotice(A.page)) === null, 'A: Retry loads the notifications again')

  // a page reload: signed in from the server's answer, no form
  await A.page.reload()
  await A.page.waitForFunction(() => window.__twin?.stores?.project, null, { timeout: 60000 })
  await A.page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('auth-1')
    const m = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text())
    window.__twin.stores.project.setState({ currentProject: m, folderHandle: dir }); window.__twin.stores.app.getState().setStep('viewing')
  })
  await until(async () => (await fin(A.page))?.check === 'signed_in', 'A signed in after reload')
  check(!(await formShown(A.page)), 'A, reloaded: still signed in (its session), no form')
  await dashboard(A.page)
  check((await bellState(A.page)) === 'ok', 'A, reloaded: the bell loads from its own session')

  // logout: only this browser; its bell is cleared; the other browser keeps working
  const D = await studio()
  await connect(D.page, 'dave')
  await until(async () => (await bellState(D.page)) === 'ok', 'D ok')
  // one server notification on D's bell (the API's own shape), so clearing it on sign-out is tested
  const item = { id: 'ntf_d1', type: 'int.sync_failed', severity: 'warning', site_id: 'adnocWarsan', asset_id: null,
                 source: { kind: 'integration', id: 'fin-workorders' }, created_at: new Date().toISOString(),
                 opened_at: null, dismissed_at: null, params: { system: 'FIN', reason: 'x' } }
  await D.page.route('**/api/notifications/v1/notifications?*', r => r.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'X-Eko-Project': 'auth-1' }, body: JSON.stringify({ items: [item], next_cursor: null, unread_count: 1, scope: 'project' }) }))
  await D.page.evaluate(() => window.EKO_NOTIF.refresh())
  await until(async () => (await D.page.evaluate(() => window.EKO_NOTIF.list().filter(n => n.remote).length)) === 1, 'D has a server row')
  await D.page.unroute('**/api/notifications/v1/notifications?*')
  await D.page.click('button:has-text("Disconnect")')
  await until(async () => (await bellState(D.page)) === 'signin', 'D bell cleared')
  check((await D.page.evaluate(() => window.EKO_NOTIF.list().filter(n => n.remote).length)) === 0, 'D: after Disconnect its bell holds nothing of the session')
  check(await formShown(D.page), 'D: after Disconnect the Connect form is back')
  check((await A.page.evaluate(() => fetch('/api/auth/me').then(r => r.status))) === 200, 'A: still signed in after D signed out')
  check((await A.page.evaluate(() => fetch('/api/fin/status').then(r => r.json()))).connected === true, 'A: FIN still connected after D signed out')
  await A.page.evaluate(() => window.EKO_NOTIF.refresh())
  check((await bellState(A.page)) === 'ok', 'A: the bell still loads')

  // the dashboard's own Sign out (account menu) ends this browser's session only
  const E = await studio()
  await connect(E.page, 'erin')
  await until(async () => (await bellState(E.page)) === 'ok', 'E ok')
  await E.page.waitForFunction(() => window.EKO && window.EKO.set, null, { timeout: 30000 })
  await E.page.evaluate(() => window.EKO.set({ born: 'dlg', dlg: 'signout' }))   // the account menu's Sign out dialog
  await E.page.click('[data-act="signOut2"]')
  await until(async () => (await bellState(E.page)) === 'signin', 'E bell signin after dashboard Sign out')
  await until(async () => (await fin(E.page))?.check === 'signed_out', 'E Studio panel follows')
  check(true, 'E: the dashboard Sign out ends this browser\'s session; the Studio panel and the bell follow')
  check((await A.page.evaluate(() => fetch('/api/auth/me').then(r => r.status))) === 200, 'A: unaffected by E\'s Sign out')
  for (const x of [B, C, D, E]) await x.ctx.close()

  // ── Export with FIN Backend: the viewer (viewer.html) and the bundled sign-in page (login.html) ──
  // FIN is connected (A). A fresh browser must still be asked to sign in.
  const V = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const v = await V.newPage()
  v.on('pageerror', e => errors.push(String(e)))
  await v.goto(APP + '/viewer.html')
  await v.waitForSelector('#signin-username', { timeout: 30000 })
  check(await v.locator('#signin-username').isVisible(), 'viewer, fresh browser while FIN is connected: the sign-in form is shown')
  await v.fill('#signin-username', 'victor'); await v.fill('#signin-password', 'secret')
  await v.click('button:has-text("Secure Connect")')
  await v.waitForSelector('.signin-overlay', { state: 'detached', timeout: 15000 })
  check((await v.evaluate(() => fetch('/api/auth/me').then(r => r.json()))).user_id === 'victor', 'viewer: signed in as the user FIN accepted')
  await v.reload()
  await sleep(2500)
  check(!(await v.locator('#signin-username').isVisible().catch(() => false)), 'viewer, reloaded: its own session lets it straight in')
  await v.route('**/api/auth/me', r => r.fulfill({ status: 503, body: '' }))
  await v.reload()
  await v.waitForSelector('.signin-overlay button:has-text("Retry")', { timeout: 30000 })
  check(true, 'viewer: a session check that fails offers Retry, not a guess')
  await v.unroute('**/api/auth/me')
  await v.click('.signin-overlay button:has-text("Retry")')
  await v.waitForSelector('.signin-overlay', { state: 'detached', timeout: 15000 })
  check(true, 'viewer: Retry after the error lets the signed-in browser in')
  await V.close()

  // login.html (the bundle's sign-in page, served by the backend): no session, no skip
  const L = await browser.newContext()
  const l = await L.newPage()
  await l.goto(API + '/login')
  await sleep(1500)
  check(l.url().endsWith('/login') && await l.locator('#username').isVisible(), 'login.html: FIN connected for others, this browser still sees the form')
  await l.fill('#username', 'lena'); await l.fill('#password', 'secret')
  await l.click('button[type="submit"]')
  await until(() => !l.url().endsWith('/login'), 'login.html opens the viewer')
  check((await l.evaluate(() => fetch('/api/auth/me').then(r => r.json()))).user_id === 'lena', 'login.html: signed in as the user FIN accepted')
  await l.goto(API + '/login')
  await until(() => !l.url().endsWith('/login'), 'signed-in browser skips login.html')
  check(true, 'login.html: a browser with its own session goes straight to the viewer')
  await L.close()

  check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '))
  await A.ctx.close()
} catch (e) {
  console.log('ERROR', e.stack || e.message)
  failures++
} finally {
  await browser.close()
  server.stop()
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll auth-session checks passed')
process.exit(failures ? 1 : 0)
