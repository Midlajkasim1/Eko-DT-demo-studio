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
  const b = { active, rows, prefs, calls, fail: null, stampAs: null }
  b.add = (project, id, extra = {}) => { (rows[project] = rows[project] || []).push({ id, type: 'int.sync_failed', severity: 'warning',
    site_id: 'fin-' + project, asset_id: null, source: { kind: 'integration', id: 'fin-workorders' }, created_at: new Date().toISOString(),
    opened_at: null, dismissed_at: null, params: { system: 'FIN', reason: 'x' }, ...extra }) }
  b.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET', header = (opts.headers || {})['X-Eko-Project']
    calls.push({ method, url, header })
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body,
      headers: { get: k => (k === 'X-Eko-Project' ? encodeURIComponent(b.stampAs || b.active) : null) } })
    if (b.fail === 'network') throw new TypeError('Failed to fetch')
    if (b.fail) return reply(b.fail, { error: { code: 'storage_failed', message: 'notification storage failed', details: {} } })
    if (decodeURIComponent(header || '') !== b.active) return reply(409, { error: { code: 'project_mismatch' } })
    const mine = rows[b.active] = rows[b.active] || []
    const path = url.replace('/api/notifications/v1', '').split('?')[0]
    const one = id => mine.find(r => r.id === decodeURIComponent(id))
    let m
    if (method === 'GET' && path === '/notifications') {
      const items = mine.filter(r => !r.dismissed_at)
      return reply(200, { items, next_cursor: null, unread_count: items.filter(r => !r.opened_at).length, scope: 'project' })
    }
    if (method === 'GET' && path === '/preferences') return reply(200, prefs[b.active] || { master_enabled: true, types: {} })
    if (method === 'PUT' && path === '/preferences') { const p = prefs[b.active] = prefs[b.active] || { master_enabled: true, types: {} }
      Object.assign(p.types, JSON.parse(opts.body).types || {}); return reply(200, p) }
    if (method === 'POST' && path === '/notifications/opened-all') { mine.forEach(r => { if (!r.dismissed_at) r.opened_at = r.opened_at || 'now' }); return reply(200, { updated: 1 }) }
    if (method === 'POST' && path === '/notifications/dismiss-opened') { mine.forEach(r => { if (r.opened_at) r.dismissed_at = 'now' }); return reply(200, { updated: 1 }) }
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

console.log(`\n${passed} notification store tests passed`)
