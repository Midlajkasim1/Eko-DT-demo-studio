import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// The bell's alarm lifecycle rows (acknowledged, cleared, returned, critical) and the rows that were there before them (sync failed, work order,
// collaboration): the dashboard's real notif-types / notif-store / notif-ui code and its real translation tables, a scripted backend and no browser.
// What the backend creates and when is tested by backend/tests/test_notifications_alarm_lifecycle.py.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const js = p => fs.readFileSync(path.join(root, 'static/dashboard/js', p), 'utf8')

function tableOf(lang) {
  const win = { EKO_I18N: {} }
  vm.runInNewContext(js(`i18n/${lang}.js`), { window: win })
  return win.EKO_I18N[lang]
}
const TABLES = { en: tableOf('en'), ar: tableOf('ar') }
const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (_, n) => (p && p[n] != null ? p[n] : `{${n}}`))

const row = (id, type, extra = {}) => ({
  id, type, severity: 'info', site_id: 'projA', asset_id: 'AHU-1', source: { kind: 'alarm', id: '@a1' },
  created_at: '2026-11-05T08:00:00Z', opened_at: null, dismissed_at: null, params: {}, ...extra,
})
const ACK = row('n-ack', 'alarm.ack_recorded', { params: { alarm: 'Supply air too hot', alarm_id: '@a1', asset: 'AHU-1', user: 'khalid', project: 'projA', at: '2026-11-05T08:10:00Z' } })
const CRITICAL = row('n-crit', 'alarm.critical', { severity: 'critical', params: { asset: 'AHU-1', message: 'Supply air too hot', acknowledged_by: 'khalid', acknowledged_at: '2026-11-05T08:10:00Z' } })
const CLEARED = row('n-clr', 'alarm.cleared', { params: { alarm: 'Supply air too hot', alarm_id: '@a1', asset: 'AHU-1', dur: '2h' } })
const RERAISED = row('n-rer', 'alarm.reraised', { severity: 'warning', source: { kind: 'alarm', id: '@a2' }, params: { alarm: 'Supply air too hot', alarm_id: '@a2', asset: 'AHU-1' } })
const SYNC = row('n-sync', 'int.sync_failed', { severity: 'warning', source: { kind: 'integration', id: 'fin-workorders' }, params: { system: 'FIN', reason: 'FIN timed out' } })

/** The dashboard code for one project, talking to a scripted backend. server.items is what the backend lists; server.calls records the requests. */
function dashboard({ items = [], project = 'proj-A', stamp = project, ackStatus = 200, remote = true, lang = 'en', acks = [], alarms = [], forbidden = false } = {}) {
  const server = { items, calls: [], ackStatus, stamp, acks: acks.map(a => ({ ...a })), forbidden }
  const kv = new Map()
  const fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET'
    server.calls.push({ method, url, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null })
    const reply = (status, body, headers = {}) => ({ ok: status < 400, status, json: async () => body, headers: { get: k => (k === 'X-Eko-Project' ? server.stamp : headers[k] ?? null) } })
    if (url === '/api/auth/me') return reply(200, { user_id: 'khalid' })
    if (server.forbidden && url.startsWith('/api/notifications/v1')) return reply(403, { error: { code: 'forbidden' } })
    if (url.startsWith('/api/notifications/v1/notifications?')) {
      const open = server.items.filter(n => !n.dismissed_at)
      return reply(200, { items: open, next_cursor: null, unread_count: open.filter(n => !n.opened_at).length, setup: { critical_alarms: 'enabled' } })
    }
    if (url === '/api/notifications/v1/preferences') return reply(200, { master_enabled: true, types: {}, site: { critical_alarms: true, can_administer: true } })
    const opened = url.match(/\/notifications\/([^/]+)\/opened$/)
    if (opened && method === 'POST') { server.items.find(n => n.id === decodeURIComponent(opened[1])).opened_at = '2026-11-05T09:00:00Z'; return reply(200, {}) }
    if (url === '/api/notifications/v1/alarm-acknowledgements' && method === 'GET') return reply(200, { items: server.acks })
    if (url === '/api/notifications/v1/alarm-acknowledgements') {
      if (server.ackStatus === 'network') throw new TypeError('Failed to fetch')
      if (server.ackStatus !== 200) return reply(server.ackStatus, { error: { code: server.ackStatus === 403 ? 'forbidden' : 'x' } })
      server.items.unshift(structuredClone(ACK))
      server.acks.push({ alarm_id: server.calls.at(-1).body.alarm_id, user_id: 'khalid', acknowledged_at: '2026-11-05T08:10:00Z',
        recorded_in: 'eko-dt', fin_acknowledged: false, fin_sync_status: 'not_sent' })
      return reply(200, { notified: true, fin_acknowledged: false })
    }
    return reply(404, {})
  }
  const win = { INJECTED_PROJECT_CONFIG: { site: {}, projectId: project, ...(remote ? {} : { fin: { directMode: true } }) }, EKO_BUILD: {}, addEventListener() {}, removeEventListener() {} }
  const ctx = vm.createContext({
    window: win, fetch, console, Date, Promise, JSON, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem: k => kv.get(k) ?? null, setItem: (k, v) => kv.set(k, String(v)), removeItem: k => kv.delete(k) },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  })
  /* the dashboard's own alarm objects and acknowledgement maker, as app.js has them */
  const E0 = { lang, sets: 0, set() { E0.sets++ }, makeAck: (ms, who) => ({ who, atMs: ms, time: `T${new Date(ms).toISOString().slice(11, 16)}` }) }
  win.EKO = E0
  win.EKO_DATA = { marsa: { alarms } }
  win.EKO_C = { esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]), icon: n => `<i>${n}</i>` }
  for (const f of ['notif/notif-types.js', 'notif/notif-store.js', 'notif/notif-ui.js']) vm.runInContext(js(f), ctx, { filename: f })
  const table = TABLES[lang]
  const E = { lang, state: {}, data: { alarms: [] }, alarm: () => undefined, ph: s => s, clockLabel: ms => `T${new Date(ms).toISOString().slice(11, 16)}`,
    t: (k, p) => fill(table[k] ?? k, p), set() {}, go() {} }
  return { N: win.EKO_NOTIF, NF: win.EKO_NF, server, E, win, E0, alarms }
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

test('every alarm lifecycle type, and sync failed, reach the bell from the server', async () => {
  const d = dashboard({ items: [ACK, CRITICAL, CLEARED, RERAISED, SYNC, row('n-x', 'made.up.type')].map(n => structuredClone(n)) })
  await d.N.confirmSession()
  assert.deepEqual(d.N.list().map(n => n.type).sort(), ['alarm.ack_recorded', 'alarm.cleared', 'alarm.critical', 'alarm.reraised', 'int.sync_failed'])
  assert.equal(d.N.remoteState(), 'ok')
  assert.equal(d.N.badge(), '5')
})

test('refreshing and reconnecting never duplicate a row', async () => {
  const d = dashboard({ items: [structuredClone(CRITICAL), structuredClone(CLEARED)] })
  await d.N.confirmSession()
  await d.N.refresh()
  await d.N.refresh()
  await d.N.confirmSession()   // a sign-in event after a reconnect
  assert.deepEqual(d.N.list().map(n => n.id).sort(), ['n-clr', 'n-crit'])
})

test('opening a row marks it read for the user and the count follows the server', async () => {
  const d = dashboard({ items: [structuredClone(ACK), structuredClone(CLEARED)] })
  await d.N.confirmSession()
  assert.equal(d.N.badge(), '2')
  d.N.markRead('n-ack')
  assert.equal(d.N.list().find(n => n.id === 'n-ack').readAt !== null, true)   // at once, before the server answers
  await new Promise(r => setImmediate(r))
  await d.N.refresh()
  assert.equal(d.N.badge(), '1')
  assert.equal(d.server.calls.some(c => c.method === 'POST' && c.url.endsWith('/notifications/n-ack/opened')), true)
  assert.deepEqual(d.N.unread().map(n => n.id), ['n-clr'])
})

test('a backend answering for another project clears the list instead of showing it', async () => {
  const d = dashboard({ items: [structuredClone(CRITICAL)] })
  await d.N.confirmSession()
  assert.equal(d.N.list().length, 1)
  d.server.stamp = 'proj-B'
  await d.N.refresh()
  assert.equal(d.N.list().length, 0)
  assert.equal(d.N.remoteState(), 'mismatch')
})

test('every request names the open project and sends no user, role or site', async () => {
  const d = dashboard({ items: [structuredClone(CRITICAL)] })
  await d.N.confirmSession()
  await d.N.recordAck('@a1')
  const calls = d.server.calls.filter(c => c.url.startsWith('/api/notifications/v1'))
  assert.ok(calls.length >= 3)
  for (const c of calls) assert.equal(decodeURIComponent(c.headers['X-Eko-Project']), 'proj-A')
  assert.deepEqual(d.server.calls.find(c => c.method === 'POST' && c.url.endsWith('/alarm-acknowledgements')).body, { alarm_id: '@a1' })
})

test('acknowledging asks the server and then shows the notification it created', async () => {
  const d = dashboard({ items: [structuredClone(CRITICAL)] })
  await d.N.confirmSession()
  const answer = await d.N.recordAck('@a1')
  assert.equal(answer.ok, true)
  assert.equal(answer.data.fin_acknowledged, false)
  assert.deepEqual(d.N.list().map(n => n.type).sort(), ['alarm.ack_recorded', 'alarm.critical'])
})

test('a refused acknowledgement shows nothing and breaks nothing', async () => {
  const d = dashboard({ items: [structuredClone(CRITICAL)], ackStatus: 403 })
  await d.N.confirmSession()
  const res = await d.N.recordAck('@a1')
  assert.deepEqual([res.ok, res.status], [false, 403])
  assert.deepEqual(d.N.list().map(n => n.type), ['alarm.critical'])
  assert.equal(d.N.remoteState(), 'ok')
})

test('nothing is sent without a backend, for an empty id, or in a demo build', async () => {
  const direct = dashboard({ remote: false })
  assert.equal((await direct.N.recordAck('@a1')).ok, false)
  const d = dashboard()
  assert.equal((await d.N.recordAck('')).ok, false)
  assert.equal((await d.N.recordAck(null)).ok, false)
  assert.equal(d.server.calls.filter(c => c.url.includes('alarm-acknowledgements')).length, 0)
  assert.equal(direct.server.calls.length, 0)
})

for (const lang of ['en', 'ar']) {
  test(`the rows read right in ${lang === 'en' ? 'English' : 'Arabic'}: user, equipment, project, time and the FIN alarm id`, async () => {
    const d = dashboard({ items: [ACK, CRITICAL, CLEARED, RERAISED, SYNC].map(n => structuredClone(n)), lang })
    await d.N.confirmSession()
    const html = Object.fromEntries(d.N.list().map(n => [n.type, text(d.NF.row(d.E, n))]))
    assert.match(html['alarm.ack_recorded'], /khalid/)
    assert.match(html['alarm.ack_recorded'], /Supply air too hot/)
    assert.match(html['alarm.ack_recorded'], /AHU-1/)
    assert.match(html['alarm.ack_recorded'], /projA/)
    assert.match(html['alarm.ack_recorded'], /T08:10/)
    assert.match(html['alarm.ack_recorded'], /@a1/)
    assert.match(html['alarm.critical'], /khalid/)   // the alarm's own row says who acknowledged it
    assert.match(html['alarm.critical'], /T08:10/)
    assert.match(html['alarm.cleared'], /AHU-1/)
    assert.match(html['alarm.cleared'], /2h/)
    assert.match(html['alarm.reraised'], /@a2/)
    assert.match(html['int.sync_failed'], /FIN timed out/)
    assert.ok(!Object.values(html).some(h => /\{\w+\}/.test(h)), 'no placeholder is left unfilled')
    assert.ok(!/@a1/.test(html['int.sync_failed']), 'a sync row carries no alarm id')
  })
}

test('the registry, the English table and the Arabic table agree on the lifecycle types', () => {
  const win = {}
  vm.runInNewContext(js('notif/notif-types.js'), { window: win })
  for (const type of ['alarm.ack_recorded', 'alarm.cleared', 'alarm.reraised', 'alarm.critical', 'int.sync_failed']) {
    assert.ok(win.EKO_NOTIF_TYPES.byType[type], type)
    for (const lang of ['en', 'ar']) for (const k of [`nt.${type}.t`, `nt.${type}.b`]) assert.ok(TABLES[lang][k], `${lang} ${k}`)
  }
  assert.equal(win.EKO_NOTIF_TYPES.byType['alarm.critical'].defaultOn, false)   // still opt-in
  assert.ok(TABLES.en.nfAckedBy && TABLES.ar.nfAckedBy)
  // the acknowledgement wording uses exactly what the server sends
  for (const lang of ['en', 'ar']) assert.deepEqual([...TABLES[lang]['nt.alarm.ack_recorded.b'].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), ['alarm', 'asset', 'project', 'time', 'user'])
})

test('work-order and collaboration rows still arrive and honour the rules of the bell', async () => {
  const d = dashboard()
  await d.N.confirmSession()
  const wo = d.N.add({ type: 'wo.assigned', actorId: 'system', params: { wo: 'WO-1', asset: 'AHU-1', user: 'S. Khan' }, source: { kind: 'workOrder', id: 'WO-1' } })
  const mention = d.N.add({ type: 'mention.comment', actorId: 'S. Khan', params: { user: 'S. Khan', asset: 'AHU-1', excerpt: 'check this' } })
  assert.deepEqual([wo.type, mention.type], ['wo.assigned', 'mention.comment'])
  assert.equal(d.N.badge(), '2')
  assert.equal(d.N.add({ type: 'wo.started', actorId: d.N.ME, params: {} }), null)   // never told about your own action
  assert.equal(d.N.add({ type: 'no.such.type' }), null)
  d.N.markRead(wo.id)
  assert.equal(d.N.badge(), '1')
  const html = text(d.NF.row(d.E, d.N.list().find(n => n.type === 'wo.assigned')))
  assert.match(html, /WO-1/)
  assert.match(html, /S\. Khan/)
})

// ---- acknowledging: the alarm reads acknowledged only once the server has confirmed it ----------------------------------------------------------

const appSource = fs.readFileSync(path.join(root, 'static/dashboard/js/app.js'), 'utf8')

/** ackServer / ackBusy exactly as app.js has them, run on a stand-in dashboard object with a real translation table. */
function ackHarness(d, lang = 'en') {
  const a = appSource.indexOf('ackBusy: new Set(),'), b = appSource.indexOf('ackText(a){')
  assert.ok(a > 0 && b > a, 'ackServer is in app.js')
  const toasts = []
  const win = Object.assign(d.win, { EKO_FB: { toast: o => toasts.push(o) } })
  const parts = new Function('window', 'return ({' + appSource.slice(a, b) + '})')(win)
  const table = TABLES[lang]
  const E2 = Object.assign(parts, { t: (k, p) => fill(table[k] ?? k, p), set: () => d.E0.set() })
  return { E2, toasts }
}
const liveAlarm = (id = 'fin-a1', finId = '@a1') => ({ id, finId, asset: 'AHU-1', sev: 'critical', ack: null })

test('the alarm is not acknowledged while the request is still out, and not at all if it fails', async () => {
  const al = liveAlarm()
  const d = dashboard({ items: [structuredClone(CRITICAL)], alarms: [al] })
  await d.N.confirmSession()
  const { E2 } = ackHarness(d)
  const sent = E2.ackServer([al])
  assert.equal(al.ack, null, 'nothing is shown before the server answers')
  assert.equal(E2.ackBusy.has('fin-a1'), true, 'the button is busy meanwhile')
  assert.equal(await sent, 1)
  assert.equal(al.ack.source, 'eko')
  assert.equal(E2.ackBusy.size, 0)
})

for (const [label, status, key] of [['not signed in', 401, 'ackErrSignIn'], ['not a superuser', 403, 'ackErrForbidden'], ['no longer open in FIN', 404, 'ackErrGone'],
  ['another project', 409, 'ackErrProject'], ['a server error', 500, 'ackErrFailed'], ['no network', 'network', 'ackErrFailed']]) {
  for (const lang of ['en', 'ar']) {
    test(`a refused acknowledgement (${label}) shows a clear ${lang} error and changes nothing`, async () => {
      const al = liveAlarm()
      const d = dashboard({ items: [structuredClone(CRITICAL)], alarms: [al], ackStatus: status, lang })
      await d.N.confirmSession()
      const { E2, toasts } = ackHarness(d, lang)
      assert.equal(await E2.ackServer([al]), 0)
      assert.equal(al.ack, null)
      assert.equal(E2.ackBusy.size, 0, 'the button is usable again')
      assert.equal(toasts.length, 1)
      assert.deepEqual([toasts[0].tone, toasts[0].text], ['warn', TABLES[lang][key]])
      assert.ok(TABLES[lang][key].length > 10)
      assert.deepEqual(d.N.list().map(n => n.type), ['alarm.critical'], 'no acknowledgement notification appeared')
    })
  }
}

test('an alarm FIN sent no id for is not marked and no request is made', async () => {
  const al = liveAlarm('fin-x', null)
  const d = dashboard({ alarms: [al] })
  await d.N.confirmSession()
  const { E2, toasts } = ackHarness(d)
  assert.equal(await E2.ackServer([al]), 0)
  assert.equal(al.ack, null)
  assert.equal(d.server.calls.some(c => c.url.endsWith('/alarm-acknowledgements') && c.method === 'POST'), false)
  assert.equal(toasts[0].text, TABLES.en.ackErrNoId)
})

test('a second click while the first is out sends one request', async () => {
  const al = liveAlarm()
  const d = dashboard({ alarms: [al] })
  await d.N.confirmSession()
  const { E2 } = ackHarness(d)
  const first = E2.ackServer([al]), second = E2.ackServer([al])
  assert.equal(await second, 0)
  assert.equal(await first, 1)
  assert.equal(d.server.calls.filter(c => c.method === 'POST' && c.url.endsWith('/alarm-acknowledgements')).length, 1)
})

test('several alarms are recorded together and each reads acknowledged, with no error', async () => {
  const a1 = liveAlarm('fin-a1', '@a1'), a2 = liveAlarm('fin-a2', '@a2')
  const d = dashboard({ alarms: [a1, a2] })
  await d.N.confirmSession()
  const { E2, toasts } = ackHarness(d)
  assert.equal(await E2.ackServer([a1, a2]), 2)
  assert.deepEqual([a1.ack.source, a2.ack.source], ['eko', 'eko'])
  assert.equal(toasts.length, 0)
})

// ---- the acknowledgement is still there after a reload, and says where it is recorded ---------------------------------------------------------------

const STORED = { alarm_id: '@a1', user_id: 'khalid', acknowledged_at: '2026-11-05T08:10:00Z', recorded_in: 'eko-dt', fin_acknowledged: false, fin_sync_status: 'not_sent' }

test('after a reload the stored acknowledgement is on the alarm, as Eko-DT\'s and not FIN\'s', async () => {
  const acked = liveAlarm('fin-a1', '@a1'), other = liveAlarm('fin-a2', '@a2'), noId = liveAlarm('fin-a3', null)
  const d = dashboard({ alarms: [acked, other, noId], acks: [STORED] })
  await d.N.confirmSession()
  assert.deepEqual([acked.ack.who, acked.ack.source, acked.ack.fin, acked.ack.time], ['khalid', 'eko', false, 'T08:10'])
  assert.equal(other.ack, null)
  assert.equal(noId.ack, null)
  assert.ok(d.E0.sets >= 1, 'the screen is told to redraw')
})

test('an acknowledgement stored while the alarm list was still loading is applied when the alarms arrive', async () => {
  const d = dashboard({ alarms: [], acks: [STORED] })
  await d.N.confirmSession()
  const later = liveAlarm('fin-a1', '@a1')
  d.win.EKO_DATA.marsa.alarms.push(later)   // data-map.js applyAlarms, then
  d.N.applyAcks(true)
  assert.equal(later.ack.who, 'khalid')
})

test('a project the server will not serve this user shows no acknowledgement', async () => {
  const al = liveAlarm()
  const d = dashboard({ alarms: [al], acks: [STORED], stamp: 'proj-B' })
  await d.N.confirmSession()
  assert.equal(al.ack, null)
  assert.equal(d.N.remoteState(), 'mismatch')
})

test('the wording keeps Eko-DT\'s acknowledgement apart from FIN\'s, in both languages', () => {
  assert.match(TABLES.en.ackEkoShort, /Eko-DT/)
  assert.match(TABLES.en.ackEkoShort, /not in FIN/)
  assert.match(TABLES.en.ackEkoTip, /does not acknowledge the alarm in FIN/)
  assert.match(TABLES.en.ackLocalTip, /does not acknowledge the alarm in FIN/)
  for (const k of ['ackEkoShort', 'ackEkoTip', 'ackLocalTip']) assert.match(TABLES.ar[k], /FIN/, k)
  assert.match(TABLES.ar.ackEkoShort, /Eko-DT/)
  const ackText = { en: TABLES.en, ar: TABLES.ar }
  for (const lang of ['en', 'ar']) assert.notEqual(ackText[lang].ackEkoShort, ackText[lang].ackShort)
})

test('a user who is not a superuser gets a notice, an empty bell, and no polling', async () => {
  const al = liveAlarm()
  const d = dashboard({ items: [structuredClone(CRITICAL)], alarms: [al], acks: [STORED], forbidden: true })
  await d.N.confirmSession()
  assert.equal(d.N.remoteState(), 'forbidden')
  assert.equal(d.N.remoteCode(), 'forbidden')
  assert.deepEqual(d.N.list(), [])
  assert.equal(d.N.badge(), '')
  assert.equal(al.ack, null)
  assert.ok(TABLES.en.nfNotAllowed && TABLES.ar.nfNotAllowed)
})
