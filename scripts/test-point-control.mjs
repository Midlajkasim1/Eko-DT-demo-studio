// Browser test: the asset panel marks the points the backend lets the dashboard change, and the
// point editor sends setpoint, status and return-to-automatic requests through DashboardData.writePoint.
// The real asset panel and dialog code in a page with a stand-in DashboardData (no backend, no FIN).
//
//   node scripts/test-point-control.mjs
//
// Needs Playwright and Microsoft Edge, or set PW_CHANNEL=chrome, or PW_EXECUTABLE=<path to a Chromium>.
import assert from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const asset = rel => pathToFileURL(path.join(ROOT, rel)).href

const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${asset('static/dashboard/css/tokens.css')}">
<link rel="stylesheet" href="${asset('static/dashboard/css/base.css')}">
<link rel="stylesheet" href="${asset('static/dashboard/css/components.css')}">
<script src="${asset('static/dashboard/js/i18n/en.js')}"></script>
<script src="${asset('static/dashboard/js/components/charts.js')}"></script>
<script src="${asset('static/dashboard/js/components/widgets.js')}"></script>
<script src="${asset('static/dashboard/js/components/point-control.js')}"></script>
<style>#assetpanel{position:static!important;height:auto!important;animation:none!important}</style>
</head><body><div class="dashboard-native-container" data-theme="dark"><div id="mount"></div><div id="overlays"></div></div>
<script>
const sp = { id: 'p:sp', navName: 'Space_Temp_SP', currentValue: '18°C', reporting: true,
  control: { role: 'setpoint', unit: '°C', min: 16, max: 30, step: 0.5, level: 8, manual: false } };
const ss = { id: 'p:ss', navName: 'Start/Stop', currentValue: 'On', text: 'START', bool: true, reporting: true,
  control: { role: 'status', options: [{ value: false, label: 'STOP' }, { value: true, label: 'START' }], level: 8, manual: true } };
const temp = { id: 'p:t', navName: 'Space_Temp', currentValue: '21.33°C', reporting: true, control: null };
const fcu = { id: 'FCU-L3-02', typeEn: 'OTHER', level: 'LEVEL-03', zone: 'General', alarms: [], params: [], alarmPts: [],
  points: [sp, ss, temp], analog: [['Space_Temp_SP', '', '18°C', undefined, sp], ['Start/Stop', '', 'START', undefined, ss], ['Space_Temp', '', '21.33°C']] };
const dict = window.EKO_I18N.en;
window.calls = []; window.mode = 'ok';
window.DashboardData = { async writePoint(id, action, value) {
  calls.push([id, action, value]);
  if (mode === 'error') return { ok: false, status: 502, error: 'FIN answered 400: Attest-Key header required' };
  const p = [sp, ss].find(x => x.id === id);
  const status = p.control.role === 'status';
  const text = action === 'auto' ? p.text : status ? (value ? 'START' : 'STOP') : null;
  const currentValue = action === 'auto' ? p.currentValue : status ? (value ? 'On' : 'Off') : value + '°C';
  return { ok: true, data: { pointId: id, confirmed: mode !== 'pending', currentValue, text, bool: status ? (action === 'auto' ? p.bool : value) : null,
    control: { ...p.control, manual: action !== 'auto' } } };
} };
window.EKO = { lang: 'en', data: { assets: [fcu], alarms: [] },
  state: { assetSel: 'FCU-L3-02', apTab: 'analytics', woRaised: {}, born: null, pointEdit: null },
  t(k, v) { let s = dict[k] ?? k; for (const n in v || {}) s = s.split('{' + n + '}').join(v[n]); return s; },
  ph: x => x, alarm: () => null, alarmLines: () => ({ main: '' }),
  set(p) { Object.assign(this.state, p); render(); } };
function render() {
  document.getElementById('mount').innerHTML = EKO_C.assetPanel(EKO);
  document.getElementById('overlays').innerHTML = EKO_POINT_CONTROL.overlay(EKO);
  EKO.state.born = null;   // as app.js: the entry animation plays once
}
document.addEventListener('click', ev => { const el = ev.target.closest('[data-act]'); const fn = el && EKO_POINT_CONTROL.ACTS[el.dataset.act]; if (fn) fn(el, ev); });
render();
</script></body></html>`

const dir = mkdtempSync(path.join(tmpdir(), 'eko-point-control-'))
const file = path.join(dir, 'harness.html')
writeFileSync(file, page)
const browser = await chromium.launch(process.env.PW_EXECUTABLE
  ? { executablePath: process.env.PW_EXECUTABLE, headless: true }
  : { channel: process.env.PW_CHANNEL || 'msedge', headless: true })
const tab = await browser.newPage({ viewport: { width: 900, height: 900 } })
const errors = []
tab.on('pageerror', e => errors.push(e.message))
await tab.goto(pathToFileURL(file).href)

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ' + name) }
const result = () => tab.textContent('.pcresult')
const calls = () => tab.evaluate(() => window.calls.splice(0))
const row = name => tab.locator('.aprow', { has: tab.locator('dt', { hasText: name }) })

try {
  await test('only points with a control decision are marked editable', async () => {
    assert.strictEqual(await row('Space_Temp_SP').locator('.apctlval').count(), 1)
    assert.strictEqual(await row('Start/Stop').locator('.apctlval .apctlman').count(), 1)   // held by a manual override
    assert.strictEqual(await tab.locator('.aprow', { has: tab.locator('dt', { hasText: /^Space_Temp$/ }) }).locator('.apctlval').count(), 0)
  })

  await test('a setpoint steps within its range and the applied value replaces the row', async () => {
    await row('Space_Temp_SP').locator('.apctlval').click()
    assert.strictEqual(await tab.inputValue('#pointEditValue'), '18.0')
    await tab.click('[data-act="pointEditStep"][data-v="1"]')
    await tab.click('[data-act="pointEditStep"][data-v="1"]')
    assert.strictEqual(await tab.inputValue('#pointEditValue'), '19.0')
    await tab.click('[data-act="pointEditApply"]')
    await tab.waitForSelector('.pcresult')
    assert.deepStrictEqual(await calls(), [['p:sp', 'set', 19]])
    assert.match(await result(), /Done\. The equipment reports 19\.0 °C\./)
    await tab.screenshot({ path: path.join(dir, 'setpoint.png') })
    await tab.click('.pcfoot [data-act="pointEditClose"]')
    assert.match(await row('Space_Temp_SP').textContent(), /19°C/)
    assert.strictEqual(await row('Space_Temp_SP').locator('.apctlman').count(), 1)
  })

  await test('a value outside the range is refused before anything is sent', async () => {
    await row('Space_Temp_SP').locator('.apctlval').click()
    await tab.fill('#pointEditValue', '35')
    await tab.click('[data-act="pointEditApply"]')
    assert.match(await result(), /Allowed 16\.0 to 30\.0 °C/)
    assert.deepStrictEqual(await calls(), [])
    await tab.click('.pcfoot [data-act="pointEditClose"]')
  })

  await test('status offers the point\'s two words and says when the equipment has not reported yet', async () => {
    await tab.evaluate(() => { window.mode = 'pending' })
    await row('Start/Stop').locator('.apctlval').click()
    assert.deepStrictEqual(await tab.$$eval('.pcchoice .seg', b => b.map(x => x.textContent)), ['STOP', 'START'])
    await tab.click('.pcchoice .seg:has-text("STOP")')
    await tab.click('[data-act="pointEditApply"]')
    await tab.waitForSelector('.pcresult[data-tone="warn"]')
    assert.deepStrictEqual(await calls(), [['p:ss', 'set', false]])
    assert.match(await result(), /has not reported STOP yet/)
    await tab.screenshot({ path: path.join(dir, 'status.png') })
  })

  await test('return to automatic releases the manual level', async () => {
    await tab.evaluate(() => { window.mode = 'ok' })
    await tab.click('[data-act="pointEditAuto"]')
    await tab.waitForSelector('.pcresult[data-tone="ok"]')
    assert.deepStrictEqual(await calls(), [['p:ss', 'auto', null]])
    assert.match(await result(), /Returned to automatic control/)
    assert.strictEqual(await tab.locator('[data-act="pointEditAuto"]').count(), 0)
    await tab.click('.pcfoot [data-act="pointEditClose"]')
  })

  await test('a refusal from the backend is shown and the dialog stays open', async () => {
    await tab.evaluate(() => { window.mode = 'error' })
    await row('Space_Temp_SP').locator('.apctlval').click()
    await tab.click('[data-act="pointEditApply"]')
    await tab.waitForSelector('.pcresult[data-tone="bad"]')
    assert.match(await result(), /Not changed\. FIN answered 400: Attest-Key header required/)
    assert.strictEqual(await tab.locator('.dlgpoint').count(), 1)
  })

  assert.deepStrictEqual(errors, [])
  console.log(`\n${passed} point control tests passed  (screenshots in ${dir})`)
} finally {
  await browser.close()
  if (!process.env.KEEP_SHOTS) rmSync(dir, { recursive: true, force: true })
}
