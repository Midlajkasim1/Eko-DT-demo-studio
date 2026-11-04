import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// Ask EKO's tool lines: a read that fails because nothing is mapped says so, in English and Arabic, and never reads "an internal error". These tests run
// the dashboard's real code (llm/eko-chat.js, and toolText / missingText cut out of ai/ask.js) and its real translation tables, with no browser and no backend.
// The reason codes and tool names the backend can send are checked against the tables by backend/tests/test_eko_chat_messages.py.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const js = p => fs.readFileSync(path.join(root, 'static/dashboard/js', p), 'utf8')

function tableOf(lang) {
  const win = { EKO_I18N: {} }
  vm.runInNewContext(js(`i18n/${lang}.js`), { window: win })
  return win.EKO_I18N[lang]
}
const TABLES = { en: tableOf('en'), ar: tableOf('ar') }

/** toolText and missingText exactly as ai/ask.js has them, with t / tOr over a real translation table */
function toolLines(lang) {
  const table = TABLES[lang]
  const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (_, n) => (p && p[n] != null ? p[n] : `{${n}}`))
  const t = (k, p) => fill(table[k] ?? k, p)
  const tOr = (k, fb, p) => (k in table ? fill(table[k], p) : fb)
  const src = js('ai/ask.js')
  const a = src.indexOf('function missingText(')
  const b = src.indexOf('function toolsHtml(')
  assert.ok(a > 0 && b > a, 'missingText and toolText are in ask.js')
  return new Function('t', 'tOr', src.slice(a, b) + '\nreturn { toolText, missingText }')(t, tOr)
}

test('a read that failed for want of a mapping says what it needs, not "an internal error"', () => {
  const { toolText } = toolLines('en')
  const line = toolText({ tool: 'get_environment', status: 'failed', reason: 'metric_unavailable',
    missing: [{ mapping: 'finLivePoints', key: 'avg_zone_temp' }, { mapping: 'finLivePoints', key: 'avg_zone_temp_sp' }] })
  assert.equal(line, 'Could not read the indoor environment: not available for this project · not mapped: Live Points: avg_zone_temp, avg_zone_temp_sp')
  assert.ok(!/internal error/.test(line))
})

test('the same in Arabic, with the names left as they are', () => {
  const { toolText } = toolLines('ar')
  const line = toolText({ tool: 'get_energy', status: 'failed', reason: 'metric_unavailable',
    missing: [{ mapping: 'finEndpoints', key: 'Hourly_Energy_Consumption_his' }, { mapping: 'power_boards', key: null }] })
  assert.match(line, /[؀-ۿ]/)
  assert.ok(line.includes('Hourly_Energy_Consumption_his'))
  assert.ok(!/internal error|خطأ داخلي/.test(line))
  assert.ok(line.includes(TABLES.ar['ai.mapping.finEndpoints']) && line.includes(TABLES.ar['ai.mapping.power_boards']))
})

test('every reason and tool name the backend may send reads in both languages, and only tool_error is an internal error', () => {
  const reasons = ['metric_unavailable', 'period_not_supported', 'online_state_unavailable', 'no_sensors', 'ambiguous', 'notifications_unavailable',
    'notifications_failed', 'alarm_history_unavailable', 'direct_rejected', 'direct_ungrounded', 'stale', 'no_data_yet', 'fin_not_connected',
    'no_active_project', 'invalid_arguments', 'malformed_tool_call', 'unknown_tool']
  const tools = ['get_building_snapshot', 'find_equipment', 'get_equipment_status', 'get_alarms', 'get_environment', 'get_energy', 'get_hvac_status',
    'get_notifications', 'get_capabilities']
  for (const lang of ['en', 'ar']) {
    const { toolText } = toolLines(lang)
    for (const reason of reasons) for (const tool of tools) {
      const line = toolText({ tool, status: 'failed', reason })
      assert.ok(!line.includes('{') && !line.includes(`ai.reason.${reason}`) && !line.includes(`ai.toolName.${tool}`), `${lang} ${tool} ${reason}: ${line}`)
      assert.ok(!line.includes(tool), `${lang}: the tool name is translated (${line})`)
    }
    const internal = toolText({ tool: 'get_alarms', status: 'failed', reason: 'tool_error' })
    assert.ok(internal.includes(TABLES[lang]['ai.reason.tool_error']), lang)
  }
})

test('a failed read with no mapping names reads as before; running and completed lines are unchanged', () => {
  const { toolText } = toolLines('en')
  assert.equal(toolText({ tool: 'find_equipment', status: 'failed', reason: 'no_data_yet' }), 'Could not read the equipment list: no data has been read yet')
  assert.equal(toolText({ tool: 'find_equipment', status: 'failed', reason: 'no_data_yet', missing: [] }), 'Could not read the equipment list: no data has been read yet')
  assert.equal(toolText({ tool: 'get_capabilities', status: 'completed' }), "Read the assistant's capabilities")
  assert.equal(toolText({ tool: 'get_energy', status: 'running' }), 'Reading the energy consumption…')
  assert.equal(toolText({ tool: 'unknown', status: 'failed' }), 'A request for an unknown data source was refused')
})

test('whatever else arrives in the missing list is ignored, not shown', () => {
  const { missingText } = toolLines('en')
  assert.equal(missingText(null), '')
  assert.equal(missingText('x'), '')
  assert.equal(missingText([null, 5, 'a', {}, { mapping: 7 }]), '')
  assert.equal(missingText([{ mapping: 'finLivePoints', key: 'a' }, null, { mapping: 'finLivePoints', key: 'b' }, { mapping: 'finEndpoints' }]),
    ' · not mapped: Live Points: a, b; Endpoints')
})

test('the chat client hands the mapping names of a failed read to Ask EKO', async () => {
  const win = {}
  vm.runInNewContext(js('llm/eko-chat.js'), { window: win, AbortController, TextDecoder, JSON, Object, String, Array, Promise })
  const sse = [
    'event: start\ndata: {"model":null,"project":{"id":"p","name":"ekoHospital"}}\n\n',
    'event: tool\ndata: {"tool":"get_environment","status":"failed","reason":"metric_unavailable","missing":[{"mapping":"finLivePoints","key":"avg_zone_temp"}]}\n\n',
    'event: tool\ndata: {"tool":"get_alarms","status":"failed","reason":"no_data_yet"}\n\n',
    'event: done\ndata: {"answer":"x","grounded":true,"project":{"id":"p","name":"ekoHospital"}}\n\n',
  ].join('')
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close() } })
  const seen = []
  const res = await win.EKO_CHAT.ask('q', { tool: d => seen.push(d) }, { fetch: async () => ({ ok: true, status: 200, body }) })
  assert.equal(res.status, 'done')
  const plain = d => JSON.parse(JSON.stringify(d))     // the client ran in its own vm context: compare the values, not the realms' prototypes
  assert.deepEqual(plain(seen[0]), { tool: 'get_environment', status: 'failed', reason: 'metric_unavailable', missing: [{ mapping: 'finLivePoints', key: 'avg_zone_temp' }] })
  assert.deepEqual(plain(seen[1]), { tool: 'get_alarms', status: 'failed', reason: 'no_data_yet', missing: null })
})

test('the capability card has its headline, columns and cells in both languages', () => {
  for (const lang of ['en', 'ar']) {
    const T = TABLES[lang]
    for (const k of ['capabilities', 'capability', 'capabilitiesUnavailable']) assert.ok(T[`ai.card.h.${k}`] && T[`ai.card.i.${k}`], `${lang} ${k}`)
    for (const c of ['area', 'available', 'unmapped', 'not_supported', 'capability', 'needs', 'data', 'tags']) assert.ok(T[`ai.card.c.${c}`], `${lang} column ${c}`)
    for (const v of ['available', 'unmapped', 'not_supported', 'live', 'historical', 'stored']) assert.ok(T[`ai.card.cap.${v}`], `${lang} cell ${v}`)
  }
  assert.match(js('ai/ask.js'), /col === 'status' \|\| col === 'data'\) return tOr\('ai\.card\.cap\./)
})
