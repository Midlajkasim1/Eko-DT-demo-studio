// Notification store: demo seeding and per-project storage (no browser). Run: node scripts/test-notif-store.mjs
// Loads the real notif-types.js + notif-store.js into an isolated vm context per "page load", the way
// the dashboard re-runs its scripts for every project it opens. localStorage is an in-memory mock.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const dir = new URL('../static/dashboard/js/notif/', import.meta.url)
const SRC = readFileSync(new URL('notif-types.js', dir), 'utf8') + '\n' + readFileSync(new URL('notif-store.js', dir), 'utf8')

const memoryStorage = () => {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) },
           removeItem: k => { m.delete(k) }, keys: () => [...m.keys()], map: m }
}
const project = (projectId, extra = {}) => ({ projectId, demo: false, site: { name: projectId, finProject: 'p' }, ...extra })

/* one page load: a fresh window, the given build switch and injected project, a shared storage */
function boot({ build = { demo: true }, injected = null, storage }) {
  const ctx = vm.createContext({ console: { ...console, warn() {}, error() {} }, Date, JSON, setInterval, clearInterval })
  ctx.window = ctx
  ctx.localStorage = storage
  if (build) ctx.EKO_BUILD = build
  if (injected) ctx.INJECTED_PROJECT_CONFIG = injected
  vm.runInContext(SRC, ctx)
  return ctx.EKO_NOTIF
}
const report = (N, title) => N.add({ type: 'report.ready', actorId: 'system', params: { report: title } })
/* vm values live in another realm: compare them as plain data */
const plain = v => JSON.parse(JSON.stringify(v))
const titles = N => plain(N.list().map(n => n.params.report).filter(Boolean))

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('ok  ' + name) }

test('demo build, no project (the prototype): the demo history is seeded', () => {
  const storage = memoryStorage()
  const N = boot({ storage })
  assert(N.list().length > 0, 'seeded')
  assert.strictEqual(N.SITE, 'marsa')
  assert.deepStrictEqual(storage.keys().filter(k => k.startsWith('eko-notifs')), ['eko-notifs-v3:demo:prototype'])
})

test('real project with an empty store stays empty (demo build or not)', () => {
  for (const build of [{ demo: true }, { demo: false }]) {
    const storage = memoryStorage()
    const N = boot({ build, injected: project('proj-A'), storage })
    assert.strictEqual(N.list().length, 0, JSON.stringify(build))
    assert.strictEqual(N.badge(), '')
    assert.strictEqual(N.seed(), 0, 'a direct seed() call is refused too')
    assert.strictEqual(N.list().length, 0)
  }
})

test('unknown runtime mode never seeds', () => {
  for (const build of [null, {}, { demo: 'yes' }, { demo: 1 }]) {
    const N = boot({ build, storage: memoryStorage() })
    assert.strictEqual(N.list().length, 0, JSON.stringify(build))
  }
  // an injected project that does not say demo is real: no seed
  const N = boot({ injected: { projectId: 'proj-A', site: { name: 'A' } }, storage: memoryStorage() })
  assert.strictEqual(N.list().length, 0)
})

test('projects A and B keep separate storage; what A adds is not in B', () => {
  const storage = memoryStorage()
  const A = boot({ injected: project('proj-A'), storage })
  assert.strictEqual(A.SITE, 'proj-A')
  assert(report(A, 'A report'))
  const B = boot({ injected: project('proj-B'), storage })
  assert.strictEqual(B.SITE, 'proj-B')
  assert.deepStrictEqual(titles(B), [])
  assert.strictEqual(B.badge(), '')
  assert.deepStrictEqual(storage.keys().filter(k => k.startsWith('eko-notifs')).sort(),
    ['eko-notifs-v3:real:proj-A'])
  assert(report(B, 'B report'))
  assert.deepStrictEqual(storage.keys().filter(k => k.startsWith('eko-notifs')).sort(),
    ['eko-notifs-v3:real:proj-A', 'eko-notifs-v3:real:proj-B'])
})

test('switching A -> B -> A restores each project\'s own notifications', () => {
  const storage = memoryStorage()
  report(boot({ injected: project('proj-A'), storage }), 'A1')
  report(boot({ injected: project('proj-B'), storage }), 'B1')
  const A = boot({ injected: project('proj-A'), storage })
  assert.deepStrictEqual(titles(A), ['A1'])
  assert.strictEqual(A.unread('proj-A').length, 1)
  assert.deepStrictEqual(titles(boot({ injected: project('proj-B'), storage })), ['B1'])
})

test('demo notifications never appear in a real project, even the same project with Demo figures off', () => {
  const storage = memoryStorage()
  assert(boot({ storage }).list().length > 0)                                            // the prototype seeds
  assert(boot({ injected: project('proj-A', { demo: true }), storage }).list().length > 0) // A with Demo figures on
  const realA = boot({ injected: project('proj-A'), storage })                           // A, Demo figures off
  assert.strictEqual(realA.list().length, 0)
  assert(!storage.keys().includes('eko-notifs-v3:real:proj-A'), 'nothing written for real A yet')
})

test('the legacy shared v2 key is neither read nor changed', () => {
  const storage = memoryStorage()
  const legacy = JSON.stringify([{ id: 'n-old', type: 'report.ready', siteId: 'marsa', createdAt: new Date().toISOString(),
    params: { report: 'legacy' }, readAt: null, archivedAt: null }])
  storage.setItem('eko-notifs-v2', legacy)
  const A = boot({ injected: project('proj-A'), storage })
  assert.deepStrictEqual(titles(A), [])
  report(A, 'A report')
  assert(!titles(boot({ storage })).includes('legacy'), 'the demo prototype does not adopt it either')
  assert.strictEqual(storage.getItem('eko-notifs-v2'), legacy)
})

test('a real project with no id records nothing and shows nothing', () => {
  const storage = memoryStorage()
  const N = boot({ injected: { demo: false, site: { name: 'X' } }, storage })
  assert.strictEqual(N.SITE, null)
  assert.strictEqual(report(N, 'lost?'), null)
  assert.deepStrictEqual(plain(N.list()), [])
  assert.deepStrictEqual(storage.keys().filter(k => k.startsWith('eko-notifs')), [])
})

test('read/unread, mark-all, archive, unarchive and archive-read still work', () => {
  const storage = memoryStorage()
  const N = boot({ injected: project('proj-A'), storage })
  const a = report(N, 'one'), b = report(N, 'two')
  assert.strictEqual(N.badge(), '2')
  N.markRead(a.id)
  assert.strictEqual(N.unread('proj-A').length, 1)
  N.archive(b.id)
  assert.deepStrictEqual(plain(N.list().map(n => n.id)), [a.id])
  N.unarchive(b.id)
  N.markAllRead('proj-A')
  assert.strictEqual(N.badge(), '')
  N.archiveRead('proj-A')
  assert.deepStrictEqual(plain(N.list()), [])
  const again = boot({ injected: project('proj-A'), storage })   // persisted for the project
  assert.deepStrictEqual(plain(again.list()), [])
  assert.strictEqual(JSON.parse(storage.getItem('eko-notifs-v3:real:proj-A')).length, 2)   // archived, not deleted
})

test('an explicit siteId is kept, and stays inside the open project\'s storage', () => {
  const storage = memoryStorage()
  const A = boot({ injected: project('proj-A'), storage })
  const n = A.add({ type: 'report.ready', actorId: 'system', siteId: 'proj-A-annex', params: { report: 'annex' } })
  assert.strictEqual(n.siteId, 'proj-A-annex')
  assert.strictEqual(A.otherUnread().length, 1)                 // shown as another site's, as before
  assert.deepStrictEqual(titles(boot({ injected: project('proj-B'), storage })), [])
  const seededDemo = boot({ storage })                            // demo seed still uses its own explicit sites
  assert(seededDemo.list().some(x => x.siteId === 'kz-dxb2') && seededDemo.list().some(x => x.siteId === 'marsa'))
})

// ─── real mode with a backend: the project-scoped server API ────────────────────────────────
/* a fake backend that follows the server's rules: it serves ONE active project, stamps every
   answer with it, refuses another project's header (409), and never lists dismissed rows */
function fakeBackend(active) {
  const rows = {}, prefs = {}, calls = []
  const b = { active, rows, prefs, calls, fail: null, stampAs: null, session: true, sessionSite: null }   // session: this browser's
  b.add = (project, id, extra = {}) => { (rows[project] = rows[project] || []).push({ id, type: 'int.sync_failed', severity: 'warning',
    site_id: 'fin-' + project, asset_id: null, source: { kind: 'integration', id: 'fin-workorders' }, created_at: new Date().toISOString(),
    opened_at: null, dismissed_at: null, params: { system: 'FIN', reason: 'x' }, ...extra }) }
  b.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET', header = (opts.headers || {})['X-Eko-Project']
    calls.push({ method, url, header, body: opts.body })
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body,
      headers: { get: k => (k === 'X-Eko-Project' ? encodeURIComponent(b.stampAs || b.active) : null) } })
    if (b.fail === 'network') throw new TypeError('Failed to fetch')
    if (url === '/api/auth/me') return b.session ? reply(200, { user_id: 'u1', site: 'fin-' + b.active, role: null, expires_at: 'x' })
      : reply(401, { error: { code: 'session_required' } })
    if (b.fail) return reply(b.fail, { error: { code: 'storage_failed', message: 'notification storage failed', details: {} } })
    if (!b.session) return reply(401, { error: { code: 'session_required' } })
    if (decodeURIComponent(header || '') !== b.active) return reply(409, { error: { code: 'project_mismatch' } })
    if (b.sessionSite) return reply(409, { error: { code: 'session_project_mismatch' } })
    const mine = rows[b.active] = rows[b.active] || []
    const path = url.replace('/api/notifications/v1', '').split('?')[0]
    const one = id => mine.find(r => r.id === decodeURIComponent(id))
    let m
    const mp = prefs[b.active] || { master_enabled: true, types: {} }
    const hidden = r => r.type === 'alarm.critical' && (mp.master_enabled === false || (mp.types || {})['alarm.critical'] === false)
    const listed = () => mine.filter(r => !r.dismissed_at && !hidden(r))
    if (method === 'GET' && path === '/notifications') {
      const items = listed(), limit = Number(new URL('http://x' + url).searchParams.get('limit')) || 50
      return reply(200, { items: items.slice(0, limit), next_cursor: items.length > limit ? 'next' : null,
                          unread_count: items.filter(r => !r.opened_at).length, scope: 'user' })
    }
    const site = () => (b.site === undefined ? {} : { site: b.site })   // the server's read-only facts about the site
    if (method === 'GET' && path === '/preferences') return reply(200, { ...(prefs[b.active] || { master_enabled: true, types: {} }), ...site() })
    if (method === 'PUT' && path === '/preferences') { const p = prefs[b.active] = prefs[b.active] || { master_enabled: true, types: {} }
      Object.assign(p.types, JSON.parse(opts.body).types || {}); return reply(200, { ...p, ...site() }) }
    if (method === 'POST' && path === '/notifications/opened-all') { listed().forEach(r => { r.opened_at = r.opened_at || 'now' }); return reply(200, { updated: 1 }) }
    if (method === 'POST' && path === '/notifications/dismiss-opened') { listed().forEach(r => { if (r.opened_at) r.dismissed_at = 'now' }); return reply(200, { updated: 1 }) }
    if ((m = path.match(/^\/notifications\/([^/]+)\/(opened|dismiss)$/))) {
      const r = one(m[1]); if (!r) return reply(404, { error: { code: 'not_found' } })
      if (m[2] === 'opened') r.opened_at = r.opened_at || 'now'
      else if (method === 'POST') r.dismissed_at = r.dismissed_at || 'now'
      else r.dismissed_at = null
      return reply(200, r)
    }
    return reply(404, { error: { code: 'not_found' } })
  }
  return b
}
/* one dashboard window; load() re-runs the scripts in it for the open project, as a switch does */
function dashboardWindow({ backend, build = { demo: true }, storage = memoryStorage() }) {
  const ctx = vm.createContext({ console: { ...console, warn() {}, error() {} }, Date, JSON, Promise,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1 })   // refresh is driven by the test
  ctx.window = ctx; ctx.localStorage = storage; ctx.EKO_BUILD = build
  const on = {}   // the page's events: eko-auth-changed is how a sign-in or sign-out reaches the bell
  ctx.addEventListener = (t, f) => (on[t] = on[t] || []).push(f)
  ctx.removeEventListener = (t, f) => { on[t] = (on[t] || []).filter(g => g !== f) }
  ctx.dispatchEvent = e => { (on[e.type] || []).slice().forEach(f => f(e)); return true }
  ctx.Event = class { constructor(type) { this.type = type } }
  if (backend) ctx.fetch = backend.fetch
  return { ctx, load(injected) { ctx.INJECTED_PROJECT_CONFIG = injected; vm.runInContext(SRC, ctx); return ctx.EKO_NOTIF } }
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)) }
const ids = N => plain(N.list().map(n => n.id)).sort()
const atest = async (name, fn) => { await fn(); passed++; console.log('ok  ' + name) }

await atest('real project: the server\'s rows are shown, with its unread count and header', async () => {
  const be = fakeBackend('proj-A'); be.add('proj-A', 'ntf_1'); be.add('proj-A', 'ntf_2', { opened_at: 'then' })
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  assert.strictEqual(N.REMOTE, true)
  await N.refresh()
  assert.deepStrictEqual(ids(N), ['ntf_1', 'ntf_2'])
  const row = N.list().find(n => n.id === 'ntf_1')
  assert.deepStrictEqual(plain([row.siteId, row.titleKey, row.level, row.remote]), ['proj-A', 'nt.int.sync_failed.t', 'attention', true])
  assert.strictEqual(N.badge(), '1')
  assert(be.calls.every(c => c.header === 'proj-A'), 'every request names the open project')
  report(N, 'local report')                                       // report.ready stays browser-generated
  assert.deepStrictEqual(plain(N.list().map(n => n.params.report).filter(Boolean)), ['local report'])
  assert.strictEqual(N.badge(), '2')
})

await atest('an empty server answer is an empty bell', async () => {
  const N = dashboardWindow({ backend: fakeBackend('proj-A') }).load(project('proj-A'))
  await N.refresh()
  assert.deepStrictEqual(ids(N), [])
  assert.strictEqual(N.badge(), '')
  assert.strictEqual(N.remoteError(), null)
})

await atest('API failures keep the bell working and are reported, never thrown', async () => {
  const be = fakeBackend('proj-A'); be.add('proj-A', 'ntf_1')
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  await N.refresh()
  for (const fail of [500, 'network']) {
    be.fail = fail
    await N.refresh()
    assert.deepStrictEqual(ids(N), ['ntf_1'], 'the last good rows stay')
    assert(N.remoteError(), String(fail))
  }
  assert(report(N, 'still local'), 'the local store still records')
})

await atest('read, archive, undo, mark-all and archive-read reach the server; a refusal is undone', async () => {
  const be = fakeBackend('proj-A'); be.add('proj-A', 'ntf_1'); be.add('proj-A', 'ntf_2'); be.add('proj-A', 'ntf_3')
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  await N.refresh()
  N.markRead('ntf_1'); await settle()
  assert.strictEqual(be.rows['proj-A'][0].opened_at, 'now')
  assert.strictEqual(N.badge(), '2')
  N.archive('ntf_1'); await settle()
  assert.deepStrictEqual(ids(N), ['ntf_2', 'ntf_3'])
  N.unarchive('ntf_1'); await settle()                             // Undo, after a refresh dropped the row
  assert.deepStrictEqual(ids(N), ['ntf_1', 'ntf_2', 'ntf_3'])
  be.fail = 500
  N.markRead('ntf_2'); await settle()
  assert.strictEqual(N.list().find(n => n.id === 'ntf_2').readAt, null, 'refused: back to unread')
  be.fail = null
  N.markAllRead('proj-A'); await settle()
  assert.strictEqual(N.badge(), '')
  N.archiveRead('proj-A'); await settle()
  assert.deepStrictEqual(ids(N), [])
  const sent = be.calls.filter(c => c.method !== 'GET').map(c => c.method + ' ' + c.url.replace('/api/notifications/v1', ''))
  assert.deepStrictEqual(plain(sent), ['POST /notifications/ntf_1/opened', 'POST /notifications/ntf_1/dismiss',
    'DELETE /notifications/ntf_1/dismiss', 'POST /notifications/ntf_2/opened', 'POST /notifications/opened-all',
    'POST /notifications/dismiss-opened'])
})

await atest('preferences are the project\'s, on the server; the master toggle overrides', async () => {
  const be = fakeBackend('proj-A')
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  await N.refresh()
  N.setPref('report.ready', false); await settle()
  assert.deepStrictEqual(be.prefs['proj-A'].types, { 'report.ready': false })
  assert.strictEqual(N.prefOn('report.ready'), false)
  be.prefs['proj-A'].master_enabled = false
  await N.refresh()
  assert.strictEqual(N.prefOn('int.sync_failed'), false)
  assert.strictEqual(report(N, 'muted'), null, 'master off: nothing recorded')
})

await atest('switching A -> B in one window: B reads B, the old store goes quiet, stale answers are ignored', async () => {
  const be = fakeBackend('proj-A'); be.add('proj-A', 'ntf_a'); be.add('proj-B', 'ntf_b')
  const win = dashboardWindow({ backend: be })
  const A = win.load(project('proj-A'))
  await A.refresh()
  assert.deepStrictEqual(ids(A), ['ntf_a'])
  const B = win.load(project('proj-B'))                            // the dashboard re-runs its scripts
  await B.refresh()                                                // the backend is still on A: 409
  assert.deepStrictEqual(ids(B), [])
  be.active = 'proj-B'; be.stampAs = 'proj-A'                      // a 200 that is stamped for A
  await B.refresh()
  assert.deepStrictEqual(ids(B), [], 'an answer stamped for A never shows in B')
  assert(B.remoteError())
  be.stampAs = null
  await B.refresh()
  assert.deepStrictEqual(ids(B), ['ntf_b'])
  const before = be.calls.length
  await A.refresh()                                                // A is no longer window.EKO_NOTIF
  assert.strictEqual(be.calls.length, before, 'the switched-away store makes no request')
  assert.deepStrictEqual(ids(win.load(project('proj-A'))), [])     // back to A: nothing of B's
})

await atest('a critical FIN alarm from the server shows in the bell; the type is off by default', async () => {
  const be = fakeBackend('proj-A')
  be.add('proj-A', 'ntf_c1', { type: 'alarm.critical', severity: 'critical', asset_id: 'AHU-01',
    source: { kind: 'alarm', id: '@a1' }, params: { asset: 'AHU-01', message: 'Supply temp high' } })
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  await N.refresh()
  const row = N.list().find(n => n.id === 'ntf_c1')
  assert.deepStrictEqual(plain([row.titleKey, row.bodyKey, row.level, row.category, row.params.asset]),
    ['nt.alarm.critical.t', 'nt.alarm.critical.b', 'attention', 'alarmLifecycle', 'AHU-01'])
  assert.strictEqual(N.badge(), '1')
  assert.strictEqual(N.prefOn('alarm.critical'), false, 'opt-in: off until the project turns it on')
  const local = boot({ injected: project('proj-B'), storage: memoryStorage() })   // no server: the registry default
  assert.strictEqual(local.prefOn('alarm.critical'), false)
})

await atest('demo builds and direct mode never call the server', async () => {
  const be = fakeBackend('proj-A'); be.add('proj-A', 'ntf_1')
  const demo = dashboardWindow({ backend: be }).load(null)
  assert.strictEqual(demo.REMOTE, false)
  await demo.refresh()
  assert(demo.list().length > 0 && !demo.list().some(n => n.remote), 'demo: the seeded local history only')
  const direct = dashboardWindow({ backend: be }).load(project('proj-A', { fin: { directMode: true } }))
  assert.strictEqual(direct.REMOTE, false)
  await direct.refresh()
  assert.deepStrictEqual(ids(direct), [])
  assert.strictEqual(be.calls.length, 0)
})

// ─── this browser's session: the bell reads nothing until the server confirms it ──────────────
await atest('no session in this browser: /api/auth/me first, no notification request, "sign in" state', async () => {
  const be = fakeBackend('proj-A'); be.add('proj-A', 'ntf_1'); be.session = false
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  await N.confirmSession()
  assert.deepStrictEqual(plain(be.calls.map(c => c.url)), ['/api/auth/me'], 'nothing else is asked')
  assert.strictEqual(N.remoteState(), 'signin')
  assert.deepStrictEqual(ids(N), [])
})

await atest('signed in: the session is confirmed, then the notifications load', async () => {
  const be = fakeBackend('proj-A'); be.add('proj-A', 'ntf_1')
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  await N.confirmSession()
  assert.strictEqual(be.calls[0].url, '/api/auth/me')
  assert(be.calls.slice(1).some(c => c.url.startsWith('/api/notifications/v1/notifications')))
  assert.deepStrictEqual([N.remoteState(), ids(N)].map(plain), ['ok', ['ntf_1']])
})

await atest('a sign-in elsewhere in the page (eko-auth-changed) makes the bell ask again and load', async () => {
  const be = fakeBackend('proj-A'); be.add('proj-A', 'ntf_1'); be.session = false
  const win = dashboardWindow({ backend: be }), N = win.load(project('proj-A'))
  await N.confirmSession()
  be.session = true
  win.ctx.dispatchEvent(new win.ctx.Event('eko-auth-changed')); await settle()
  assert.deepStrictEqual([N.remoteState(), ids(N)].map(plain), ['ok', ['ntf_1']])
})

await atest("signing out (or a session that expires) clears the bell: server rows and this browser's own", async () => {
  const be = fakeBackend('proj-A'); be.add('proj-A', 'ntf_1')
  const storage = memoryStorage(), win = dashboardWindow({ backend: be, storage }), N = win.load(project('proj-A'))
  await N.confirmSession()
  report(N, 'mine')
  assert.strictEqual(N.list().length, 2)
  be.session = false
  win.ctx.dispatchEvent(new win.ctx.Event('eko-auth-changed')); await settle()
  assert.deepStrictEqual([N.remoteState(), N.list().length, N.badge()].map(plain), ['signin', 0, ''])
  assert.deepStrictEqual(ids(win.load(project('proj-A'))), [], 'not back after a reload either')
  be.session = true; const M = win.load(project('proj-A')); await M.confirmSession()
  be.session = false; await M.refresh()                         // expired between two refreshes: a 401
  assert.deepStrictEqual([M.remoteState(), ids(M)].map(plain), ['signin', []])
})

await atest('409s are told apart: signed in for another project, or the server shows another project', async () => {
  const be = fakeBackend('proj-A'); be.add('proj-A', 'ntf_1')
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  await N.confirmSession()
  be.sessionSite = 'fin-other'; await N.refresh()
  assert.deepStrictEqual([N.remoteState(), N.remoteCode(), ids(N)].map(plain), ['mismatch', 'session_project_mismatch', []])
  be.sessionSite = null; be.active = 'proj-B'; await N.refresh()
  assert.deepStrictEqual([N.remoteState(), N.remoteCode()].map(plain), ['mismatch', 'project_mismatch'])
  be.active = 'proj-A'; await N.refresh()
  assert.deepStrictEqual([N.remoteState(), ids(N)].map(plain), ['ok', ['ntf_1']], 'back when the server is')
})

await atest('a server or network error is retryable: the last rows stay, confirmSession recovers', async () => {
  const be = fakeBackend('proj-A'); be.add('proj-A', 'ntf_1')
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  await N.confirmSession()
  be.fail = 'network'; await N.confirmSession()
  assert.deepStrictEqual([N.remoteState(), ids(N)].map(plain), ['error', ['ntf_1']])
  be.fail = 503; await N.refresh()
  assert.strictEqual(N.remoteState(), 'error')
  be.fail = null; await N.confirmSession()
  assert.strictEqual(N.remoteState(), 'ok')
})

// ─── critical alarms: the SITE's setting is the server's word, the switch is the user's own ──────────
const crit = (id, extra = {}) => ({ id, type: 'alarm.critical', severity: 'critical', site_id: 'fin-proj-A', asset_id: 'AHU-01',
  source: { kind: 'alarm', id: '@a1' }, created_at: new Date().toISOString(), opened_at: null, dismissed_at: null,
  params: { asset: 'AHU-01', message: 'Supply temp high', occurred: 'x', priority: 250 }, ...extra })

await atest('site status: true / false from the server, null (unknown) when it is not given or the read failed', async () => {
  const be = fakeBackend('proj-A')
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  assert.strictEqual(N.siteCritical(), null, 'nothing read yet: not assumed on')
  be.site = { critical_alarms: true }; await N.refresh()
  assert.strictEqual(N.siteCritical(), true)
  be.site = { critical_alarms: false }; await N.refresh()
  assert.strictEqual(N.siteCritical(), false)
  be.site = { critical_alarms: null }; await N.refresh()
  assert.strictEqual(N.siteCritical(), null, 'the server could not read it')
  be.site = undefined; await N.refresh()                          // an older backend sends no site part
  assert.strictEqual(N.siteCritical(), null)
  be.site = { critical_alarms: true }; await N.refresh()
  be.session = false; await N.refresh()                           // the session ended: nothing of it stays
  assert.strictEqual(N.siteCritical(), null)
  const local = boot({ injected: project('proj-A'), storage: memoryStorage() })   // no backend at all
  assert.strictEqual(local.siteCritical(), null)
})

await atest('the user\'s own critical-alarm switch decides what THEY see; the site status is untouched by it', async () => {
  const be = fakeBackend('proj-A'); be.add('proj-A', 'ntf_c', crit('ntf_c')); be.add('proj-A', 'ntf_s')
  be.site = { critical_alarms: false }
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  await N.refresh()
  assert.deepStrictEqual(ids(N), ['ntf_c', 'ntf_s'], 'no choice of their own: what the site created is shown')
  N.setPref('alarm.critical', true); await settle()
  assert.deepStrictEqual(ids(N), ['ntf_c', 'ntf_s'], 'opted in: shown')
  assert.strictEqual(N.siteCritical(), false, 'the personal switch never changes what the site says')
  assert.deepStrictEqual(plain(be.prefs['proj-A'].types), { 'alarm.critical': true })
  assert(!('site' in JSON.parse(be.calls.filter(c => c.method === 'PUT').pop().body || '{}')), 'the request carries no site setting')
  N.setPref('alarm.critical', false); await settle()
  assert.deepStrictEqual(ids(N), ['ntf_s'], 'opted out: hidden for this user, other types untouched')
})

await atest('the preferences dialog tells the personal switch from the site setting, and never implies it is on when unknown', async () => {
  const ctx = vm.createContext({ console, Date, JSON })
  ctx.window = ctx
  const E = lang => ({ state: { nf: { prefs: true } }, lang, t: k => ctx.EKO_I18N[lang][k] ?? k })
  ctx.EKO_C = { esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]), icon: () => '' }
  const read = f => readFileSync(new URL(f, new URL('../static/dashboard/js/', import.meta.url)), 'utf8')
  vm.runInContext(read('i18n/en.js') + '\n' + read('i18n/ar.js') + '\n' + read('notif/notif-types.js'), ctx)
  const render = async (site, extra = {}) => {
    const be = fakeBackend('proj-A'); be.site = site
    const w = dashboardWindow({ backend: be, ...extra })
    const N = w.load(project('proj-A'))
    for (const k of ['EKO_C', 'EKO_I18N']) w.ctx[k] = ctx[k]
    vm.runInContext(read('notif/notif-ui.js'), w.ctx)
    await N.refresh()
    return w.ctx.EKO_NF.overlays(E('en'))
  }
  const note = html => (html.match(/<div class="nfpsite"[^>]*>[\s\S]*?<\/div>/) || [''])[0]
  const off = note(await render({ critical_alarms: false }))
  assert(off.includes('data-state="off"') && /not enabled/.test(off) && /does not start any notifications/.test(off) && /Nothing is being generated/.test(off), off)
  const on = note(await render({ critical_alarms: true }))
  assert(on.includes('data-state="on"') && /are enabled/.test(on) && /only decides whether you see them/.test(on), on)
  for (const unavailable of [{ critical_alarms: null }, undefined]) {
    const u = note(await render(unavailable))
    assert(u.includes('data-state="unknown"') && /could not be determined/.test(u) && /does not mean notifications are being generated/.test(u), u)
    assert(!/notifications are enabled\./.test(u) && !/data-state="on"/.test(u), 'unknown is never shown as enabled')
  }
  const html = await render({ critical_alarms: false })
  assert.strictEqual((html.match(/class="nfpsite"/g) || []).length, 1, 'one note, under the critical-alarm row only')
  assert(html.indexOf('data-v="alarm.critical"') < html.indexOf('class="nfpsite"') && html.indexOf('class="nfpsite"') < html.indexOf('data-v="', html.indexOf('data-v="alarm.critical"') + 5), 'it sits right under that row')
  for (const key of ['nfSiteLbl', 'nfSiteOn', 'nfSiteOff', 'nfSiteUnknown']) assert(ctx.EKO_I18N.ar[key] && ctx.EKO_I18N.en[key], key + ' in both languages')
})

await atest('server-side opt-out: the badge, pages and bulk actions describe the same rows (more than one page)', async () => {
  const be = fakeBackend('proj-A')
  for (let i = 0; i < 90; i++) be.add('proj-A', 'ntf_s' + i)                       // 90 unread the user keeps
  for (let i = 0; i < 60; i++) be.add('proj-A', 'ntf_c' + i, crit('ntf_c' + i))    // 60 unread critical alarms
  be.site = { critical_alarms: true }
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  await N.refresh()
  assert.strictEqual(N.list().length, 100, 'shown: the first page (opted in by default)')
  assert.strictEqual(N.badge(), '99+', '150 unread, more pages: the server count')
  N.setPref('alarm.critical', false); await settle()
  assert.strictEqual(N.list().length, 90, 'the server left the critical alarms out, whatever page they were on')
  assert(N.list().every(n => n.type !== 'alarm.critical'))
  assert.strictEqual(N.badge(), '90', 'one page now: the badge is what is listed (it was 50 when the client filtered a full page)')
  N.setPref('alarm.critical', true); await settle()
  assert.strictEqual(N.badge(), '99+', 'opted back in: they are all back, unread')
})

await atest('only hidden critical alarms unread: nothing to mark read, and no request is made for them', async () => {
  const be = fakeBackend('proj-A')
  for (let i = 0; i < 5; i++) be.add('proj-A', 'ntf_c' + i, crit('ntf_c' + i))
  be.site = { critical_alarms: true }; be.prefs['proj-A'] = { master_enabled: true, types: { 'alarm.critical': false } }
  const N = dashboardWindow({ backend: be }).load(project('proj-A'))
  await N.refresh()
  assert.deepStrictEqual([N.list().length, N.badge()], [0, ''])
  const before = be.calls.length
  N.markAllRead(); await settle()
  assert(!be.calls.slice(before).some(c => c.method === 'POST' && c.url.includes('opened-all')), 'no mark-all request')
  assert(be.rows['proj-A'].every(r => !r.opened_at), 'the hidden rows were never opened')
})

console.log(`\n${passed} notification store tests passed`)
