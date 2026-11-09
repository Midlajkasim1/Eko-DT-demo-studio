import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// The real dashboard (templates/index.html + static/dashboard) in a browser, with the project settings the Studio injects before the dashboard's scripts:
// Systems > Live Twin opens in the content area, its floors and equipment selection work, it survives the shell's re-renders, it is absent on other projects,
// and the Hospital roof schematic still opens. The FIN feed below is a test input written into E.data.assets: no FIN server is involved.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }
let server, browser, base

before(async () => {
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const file = p === '/' ? path.join(root, 'templates/index.html') : path.join(root, p)
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://localhost:${server.address().port}`
  browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
})
after(async () => {
  await browser?.close()
  server?.closeAllConnections?.(); await new Promise(r => server?.close(r))
})

const CONFIGS = {
  eko: { projectId: 'p-eko', demo: false, hospitalHvac: true, site: { name: 'Eko Hospital', finProject: 'ekoHospital', timezone: 'Asia/Dubai' }, basis: {} },
  marsa: { projectId: 'p-marsa', demo: true, hospitalHvac: false, site: { name: 'Marsa Al Arab', finProject: 'marsaAlArab', timezone: 'Asia/Dubai' }, basis: {} },
}
async function openFor(kind, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  page.once('close', () => { ctx.close().catch(() => {}) })
  page.errors = []
  page.on('pageerror', e => page.errors.push(String(e)))
  await page.addInitScript(cfg => { window.INJECTED_PROJECT_CONFIG = { ...cfg } }, CONFIGS[kind])
  await page.goto(base + '/')
  await page.waitForFunction(() => window.EKO && window.EKO.data && document.querySelector('#ekonav .nvi'))
  return page
}
const openTwin = async page => {
  await page.locator('#ekonav .nvi[data-mod="systems"]').click()
  await page.locator('#ekonav .nsub[data-sub="twin"]').click()
  await page.locator('#mount > .twinview').waitFor()
  // the view frames itself once its stage has a size: wait for that before measuring or tapping
  await page.waitForFunction(() => { const s = document.querySelector('.twsvg'), v = s && s.viewBox.baseVal, r = s && s.getBoundingClientRect()
    return v && r.width && Math.abs(v.height / v.width - r.height / r.width) < 0.01 })
}
/* a tap on a machine, as a pointer: the view selects on pointer up */
const tap = async (page, id) => {
  const b = await page.locator(`.twsvg .equip[data-id="${id}"]`).boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}
const viewBox = page => page.locator('.twsvg').getAttribute('viewBox')

test('Systems > Live Twin opens the four-floor building in the content area', async () => {
  const page = await openFor('eko')
  try {
    await openTwin(page)
    assert.equal(await page.locator('#ekonav .nsub[data-sub="twin"]').innerText(), 'Live Twin')
    assert.equal(await page.locator('#ekonav .nsub[data-sub="twin"]').getAttribute('data-on'), 'true')
    assert.equal(await page.locator('#mount').evaluate(m => m.childElementCount), 1, 'the twin stands alone in #mount: no iframe, no second layout')
    assert.equal(await page.locator('.twinview iframe').count(), 0)
    assert.equal(await page.locator('.twsvg .tw-level').count(), 5, 'roof, L2, L1, outside, ground floor')
    assert.equal(await page.locator('.twsvg .equip').count(), await page.evaluate(() => window.EKO_TWIN.EQUIP.length), 'every machine is drawn')
    assert.deepEqual(await page.locator('.twseg button').allInnerTexts(), ['All', 'Roof', 'L2', 'L1', 'GF'])
    await page.locator('.twtabs [data-tab="equip"]').click(); assert.ok((await page.locator('.twside').innerText()).includes('Select equipment'))
    assert.equal(await page.locator('.twstatus').innerText(), 'Live data not connected', 'no live data here: nothing claimed')
    assert.deepEqual(page.errors, [])
  } finally { await page.close() }
})

test('each floor button frames that floor and fades the others; All goes back', async () => {
  const page = await openFor('eko')
  try {
    await openTwin(page)
    const home = await viewBox(page), seen = new Set([home])
    for (const [lv, label] of [['RF', 'Roof'], ['L2', 'L2'], ['L1', 'L1'], ['GF', 'GF']]) {
      await page.locator('.twseg button', { hasText: new RegExp('^' + label + '$') }).click()
      assert.equal(await page.locator('.twsvg').getAttribute('data-level'), lv)
      assert.equal(await page.locator(`.twseg button[data-lv="${lv}"]`).getAttribute('aria-pressed'), 'true')
      await page.waitForFunction(l => [...document.querySelectorAll('.twsvg .tw-level')].every(g => (g.dataset.level === l) === (+getComputedStyle(g).opacity > 0.5)), lv)   // the others fade (a 0.3 s transition)
      const vb = await viewBox(page); assert.ok(!seen.has(vb), lv + ' has its own frame'); seen.add(vb)
    }
    await page.locator('.twseg button[data-lv="ALL"]').click()
    assert.equal(await viewBox(page), home)
    await page.locator('.twseg button[data-lv="L1"]').click()
    await page.locator('.twbar button[data-tw="home"]').click()
    assert.equal(await page.locator('.twsvg').getAttribute('data-level'), 'ALL', 'Whole building')
  } finally { await page.close() }
})

test('selecting equipment shows its mapping and points; the FIN feed is read as it is; the view survives re-renders', async () => {
  const page = await openFor('eko')
  try {
    await openTwin(page)
    await page.evaluate(() => { window.DashboardData = window.DashboardData || {}; Object.defineProperty(window.DashboardData, 'connected', { get: () => true, configurable: true }); window.EKO.set({}) })   // stands for a FIN connection
    await page.locator('.twseg button[data-lv="RF"]').click()
    await tap(page, 'CHILLER_01')
    assert.equal(await page.locator('.twsvg .equip.sel').getAttribute('data-id'), 'CHILLER_01')
    assert.equal(await page.locator('.twdt').innerText(), 'Chiller 01')
    assert.equal(await page.locator('.twchip[data-fin]').innerText(), 'Missing from the live feed')
    // a test feed in the dashboard's own data (as data-map.js shapes it: the chiller's FIN id, tags and floor as the export has them), then a re-render
    const vb = await viewBox(page)
    await page.evaluate(() => {
      window.EKO.data.assets = [{ id: 'CHILLER_01', finId: 'p:ekoHospital:r:3260ac07-19aa0e85', bimId: '@p:ekoHospital:r:3260ac07-19aa0e85', floor: 'ROOF', tags: ['chiller', 'hvac'], typeEn: 'CHILLER', st: 'ok', points: [
        { navName: 'CHWSTemp', currentValue: '6.9°C', unit: '°C', kind: 'Number', pointKind: 'Number', his: true, reporting: true, status: 'ok', bool: null },
        { navName: 'RunStatus', currentValue: 'On', kind: 'Bool', pointKind: 'Bool', bool: true, text: 'true', reporting: true, status: 'ok' },
        { navName: 'AlarmStatus', currentValue: 'Off', kind: 'Bool', pointKind: 'Bool', bool: false, text: 'Normal', enum: 'Normal,Trip', reporting: true, status: 'ok' },
        { navName: 'Power', currentValue: '—', unit: 'kW', his: true, reporting: false, bool: null }] }]
      window.EKO.set({})
    })
    assert.equal(await page.locator('.twchip[data-fin]').innerText(), 'Mapped · in the live feed')
    const rows = await page.locator('.twpts tr').evaluateAll(trs => trs.map(t => [t.querySelector('th').firstChild.textContent, t.querySelector('td').textContent, t.dataset.st]))
    assert.deepEqual(rows, [['CHWSTemp', '6.9 °C', 'live'], ['Power', 'No data', 'not-reporting'], ['CHWSTempSp', 'Missing', 'missing'], ['RunStatus', 'On', 'live'],
      ['AlarmStatus', 'Normal', 'live'], ['EnableCmd', 'Missing', 'missing'], ['CHWRTemp', 'Missing', 'missing'], ['OperatingHours', 'Missing', 'missing']])
    assert.equal(await page.locator('.twpts tr:has-text("CHWSTempSp") .twflag').innerText(), 'S', 'the export marks it a setpoint')
    assert.equal(await page.locator('.twpts tr:has-text("AlarmStatus") td').getAttribute('title'), 'Possible values: Normal,Trip')
    const dl = await page.locator('.twdl div').evaluateAll(ds => Object.fromEntries(ds.map(d => [d.querySelector('dt').textContent, d.querySelector('dd').textContent])))
    assert.deepEqual([dl['Equipment name'], dl['Equipment id'], dl['Reported type'], dl['Reported floor'], dl['BIM id']], ['CHILLER_01', 'p:ekoHospital:r:3260ac07-19aa0e85', 'CHILLER', 'ROOF', '—'])
    assert.equal(await viewBox(page), vb, 'the camera is kept')
    assert.equal(await page.locator('.twsvg').getAttribute('data-level'), 'RF', 'the floor is kept')
    assert.equal(await page.locator('.twsvg .tag[data-id="CHILLER_01"]').getAttribute('data-fin'), 'mapped')
    assert.equal(await page.locator('.twstatus').innerText(), '1 of 46 mapped equipment in the live feed')
    // a feed item whose FIN id is not the export's is not read
    await page.evaluate(() => { window.EKO.data.assets[0].finId = 'p:ekoHospital:r:00000000-00000000'; window.EKO.set({}) })
    assert.equal(await page.locator('.twchip[data-fin]').innerText(), 'Ambiguous match')
    assert.equal(await page.locator('.twpts').count(), 0)
    // an item the exports do not establish stays unmapped
    await page.locator('.twsvg .equip[data-id="RF_ENERGY"]').focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('.twchip[data-fin]').innerText(), 'Unmapped')
    assert.match(await page.locator('.twside').innerText(), /names RF_ENERGY, with energy points/)
    // keyboard: Enter selects, Escape clears; the floor mapping shows with nothing selected
    await page.locator('.twsvg .equip[data-id="BOILER_01"]').focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('.twdt').innerText(), 'Boiler 01')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.twsvg .equip.sel').count(), 0)
    assert.match(await page.locator('.twfloors').innerText(), /Ground floor\s+LEVEL-01/)
    // the close button, and a context item that is not FIN equipment
    await page.locator('.twseg button[data-lv="ALL"]').click()
    await tap(page, 'GENERATOR')
    assert.equal(await page.locator('.twchip[data-fin]').innerText(), 'Shown for context')
    await page.locator('.twside [data-tw="close"]').click()
    await page.locator('.twtabs [data-tab="equip"]').click(); assert.ok((await page.locator('.twside').innerText()).includes('Select equipment'))
    assert.deepEqual(page.errors, [])
  } finally { await page.close() }
})

test('the saved FIN exports as the feed: all 46 mapped, floors agree, alarms on their equipment and points', async () => {
  const fx = n => JSON.parse(fs.readFileSync(path.join(root, 'spec/fixtures/eko-hospital', n), 'utf8'))
  // as data-map.js builds E.data.assets and E.data.alarms from the backend's equipment and alarm payloads
  const assets = fx('equipment.json').equipment.map(e => ({ id: e.name, finId: e.finId, bimId: e.bimId, floor: e.floor, tags: e.tags, typeEn: String(e.type).toUpperCase(), st: 'ok', points: e.points }))
  const alarms = fx('alarms.json').alarms.map(a => ({ id: a.id, sourceId: a.source_id, state: a.state, plainEn: a.message, sev: a.severity }))
  const page = await openFor('eko')
  try {
    await openTwin(page)
    await page.evaluate(([a, al]) => { window.DashboardData = window.DashboardData || {}; Object.defineProperty(window.DashboardData, 'connected', { get: () => true, configurable: true }); window.EKO.data.assets = a; window.EKO.data.alarms = al; window.EKO.set({}) }, [assets, alarms])
    assert.equal(await page.locator('.twstatus').innerText(), '46 of 46 mapped equipment in the live feed')
    const count = st => page.locator(`.twsvg .equip[data-fin="${st}"]`).count()
    assert.deepEqual([await count('mapped'), await count('missing'), await count('ambiguous'), await count('unmapped'), await count('not-fin')], [46, 0, 0, 4, 3])
    assert.equal(await page.locator('.twfloors div[data-conflict="1"]').count(), 0)
    await page.locator('.twsvg .equip[data-id="AHU_01"]').focus()
    await page.keyboard.press('Enter')
    assert.deepEqual(await page.locator('.twalarms li > b').allInnerTexts(), ['Cooling Coil is Overcooling', 'Sensor Fault'])
    assert.deepEqual(await page.locator('.twalarms .twaldl div:has(dt:text-is("Alarm point")) dd').allInnerTexts(), ['FD&D_4_Overcooling', 'FD&D_2_Sensor_Fault'])
    assert.equal(await page.locator('.twdl div:has(dt:text-is("BIM id")) dd').innerText(), '2wLf9$IGsICFYFjFAcUnf2')
    await page.locator('.twsvg .equip[data-id="VAV_10"]').focus()
    await page.keyboard.press('Enter')
    assert.match(await page.locator('.twdl div:has(dt:text-is("BIM id")) dd').innerText(), /shared with another equipment/)
    await page.locator('.twsvg .equip[data-id="SP_01"]').focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('.twdl div:has(dt:text-is("Equipment name")) dd').innerText(), 'SUMP_PUMP')
    assert.equal(await page.locator('.twalarms').count(), 0)
    assert.deepEqual(page.errors, [])
  } finally { await page.close() }
})

test('networks: every system drawn still; layer chips hide one layer each, through floors, zoom and re-renders; a selection lights its own pipes', async () => {
  const page = await openFor('eko')
  try {
    await openTwin(page)
    const pipes = page.locator('.twsvg .pipe')
    const total = await pipes.count()
    assert.ok(total >= 91, total + ' pipe and riser segments')
    assert.deepEqual(await page.evaluate(() => [...new Set([...document.querySelectorAll('.twsvg .pipe')].map(g => g.dataset.sys))].sort()),
      ['chwr', 'chws', 'cwr', 'cws', 'dcw', 'drn', 'ea', 'fa', 'gen', 'hw', 'ma', 'o2', 'pwr', 'sa'])
    assert.equal(await page.evaluate(() => document.querySelector('.twsvg').getAnimations({ subtree: true }).length), 0, 'nothing moves: no flow is shown')
    assert.equal(await page.locator('.twsvg .flowline').count(), 0)
    assert.deepEqual(await page.locator('.twlayers button').allInnerTexts(), ['Chilled water', 'Condenser water', 'Air', 'Water & drainage', 'Power', 'Medical gas'])
    await page.locator('.twtabs [data-tab="equip"]').click(); assert.equal(await page.locator('.twlegend dd').count(), 14, 'every system in the legend')
    assert.match(await page.locator('.twside').innerText(), /Building layout and service routes are illustrative and require engineering verification\./)
    assert.doesNotMatch(await page.locator('.twside').innerText(), /no flow is shown|not surveyed/)
    const shown = l => page.evaluate(l => [...document.querySelectorAll(`.twsvg .pipe[data-layer="${l}"]`)].filter(g => getComputedStyle(g).display !== 'none').length, l)
    const equipShown = () => page.evaluate(() => [...document.querySelectorAll('.twsvg .equip')].every(g => getComputedStyle(g).display !== 'none'))
    // each chip hides its own layer and nothing else
    for (const l of ['chw', 'cw', 'air', 'water', 'power', 'gas']) {
      const before = await shown(l)
      assert.ok(before > 0, l)
      await page.locator(`.twlayers button[data-layer="${l}"]`).click()
      assert.equal(await page.locator(`.twlayers button[data-layer="${l}"]`).getAttribute('aria-pressed'), 'false')
      assert.equal(await shown(l), 0, l + ' hidden')
      assert.ok(await equipShown(), 'machines stay')
      await page.locator(`.twlayers button[data-layer="${l}"]`).click()
      assert.equal(await shown(l), before, l + ' back')
    }
    // a hidden layer stays hidden through a floor, the whole building, a zoom and a data re-render
    await page.locator('.twlayers button[data-layer="air"]').click()
    await page.locator('.twseg button[data-lv="L1"]').click()
    await page.mouse.move(700, 450); await page.mouse.wheel(0, -400)
    await page.evaluate(() => window.EKO.set({}))
    assert.equal(await shown('air'), 0)
    assert.ok(await shown('chw') > 0)
    // floors: L1's networks are at full strength, the others fade with their floor
    await page.waitForFunction(() => [...document.querySelectorAll('.twsvg .pipe[data-sys="chws"]')].every(g => (g.closest('.tw-level').dataset.level === 'L1') === (+getComputedStyle(g.closest('.tw-level')).opacity > 0.5)))
    await page.locator('.twbar button[data-tw="home"]').click()
    await page.locator('.twlayers button[data-layer="air"]').click()
    // selection: AHU 01's own pipes stand out (chilled water drop, supply air), the rest step back
    await page.locator('.twsvg .equip[data-id="AHU_01"]').focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('.twsvg').getAttribute('data-conn'), '1')
    assert.deepEqual(await page.locator('.twsvg .pipe.conn').evaluateAll(gs => gs.map(g => g.dataset.pipe).sort()), ['chws_ahu_GF', 'sa_main2_GF', 'sa_main_GF'])
    assert.ok(+(await page.locator('.twsvg .pipe[data-pipe="chws_hdr_GF"]').evaluate(g => getComputedStyle(g).opacity)) < 0.5)
    assert.deepEqual(await page.locator('.twnets li').allInnerTexts(), ['Chilled water supply (CHWS)', 'Supply air (SA)'])
    // a machine the reference ties no pipe to: nothing is dimmed, no network listed
    await page.locator('.twsvg .equip[data-id="BTU_01"]').focus()
    await page.keyboard.press('Enter')
    assert.deepEqual([await page.locator('.twsvg').getAttribute('data-conn'), await page.locator('.twsvg .pipe.conn').count(), await page.locator('.twnets').count()], ['0', 0, 0])
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.twsvg').getAttribute('data-conn'), '0')
    // pipes never take a click: a tap on a machine drawn under a ceiling pipe selects the machine
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.twsvg .pipe')).pointerEvents), 'none')
    await page.locator('.twseg button[data-lv="GF"]').click()
    await tap(page, 'FCU_01')
    assert.equal(await page.locator('.twdt').innerText(), 'FCU 01')
    // a data re-render leaves the pipes alone (same elements, nothing rewritten)
    const before = await page.evaluate(() => { window.__p = document.querySelector('.twsvg .pipe[data-pipe="chws_hdr_GF"] .core'); return window.__p.getAttribute('d') })
    await page.evaluate(() => window.EKO.set({}))
    assert.deepEqual(await page.evaluate(() => { const p = document.querySelector('.twsvg .pipe[data-pipe="chws_hdr_GF"] .core'); return [p === window.__p, p.getAttribute('d')] }), [true, before])
    assert.deepEqual(page.errors, [])
  } finally { await page.close() }
})

test('equipment intelligence: alarms go to their equipment; traces up and down across floors; evidence kept apart; layers and selection unharmed', async () => {
  const fx = n => JSON.parse(fs.readFileSync(path.join(root, 'spec/fixtures/eko-hospital', n), 'utf8'))
  const assets = fx('equipment.json').equipment.map(e => ({ id: e.name, finId: e.finId, bimId: e.bimId, floor: e.floor, tags: e.tags, typeEn: String(e.type).toUpperCase(), st: 'ok', points: e.points }))
  const alarms = fx('alarms.json').alarms.map(a => ({ id: a.id, sourceId: a.source_id, state: a.state, plainEn: a.message, techEn: a.detail, sev: a.severity,
    finSeverity: a.severity, priority: a.priority, locEn: a.source, hist: a.history.map(h => ({ open: h.open })) }))
  // a cleared record and an alarm on undrawn FIN equipment: the first is never listed, the second is listed without a link
  alarms.push({ id: 'rtn', sourceId: alarms[0].sourceId, state: alarms[0].state, plainEn: 'Return to normal', sev: 'info' },
    { id: 'cctv', sourceId: 'p:ekoHospital:r:cctv', plainEn: 'Camera offline', locEn: 'HOSPITAL CCTV_01', sev: 'info' })
  const page = await openFor('eko')
  try {
    await openTwin(page)
    await page.evaluate(([a, al]) => { window.DashboardData = window.DashboardData || {}; Object.defineProperty(window.DashboardData, 'connected', { get: () => true, configurable: true }); window.EKO.data.assets = a; window.EKO.data.alarms = al; window.EKO.set({}) }, [assets, alarms])
    // nothing selected: every open FIN alarm, the cleared record left out
    assert.match(await page.locator('.twside h3.twsub').first().innerText(), /Open alarms in the hospital \(11\)/i)
    assert.equal(await page.locator('.twallist li').count(), 11)
    assert.equal(await page.locator('.twallist li:has-text("Return to normal")').count(), 0)
    assert.match(await page.locator('.twallist li[data-linked="0"]').innerText(), /Camera offline\nHOSPITAL CCTV_01 · not on drawn equipment/)
    assert.equal(await page.locator('.twallist li[data-linked="0"] button').count(), 0, 'an alarm off the drawing does not pretend to a place')
    assert.equal(await page.locator('.twsvg .equip[data-al="alarm"]').count(), 9, 'the nine machines with an open alarm are marked')
    // an alarm takes you to its machine, on its floor
    await page.locator('.twallist li:has-text("Cooling Performance Fault"):has-text("FCU 03") button').click()
    assert.equal(await page.locator('.twdt').innerText(), 'FCU 03')
    assert.equal(await page.locator('.twsvg').getAttribute('data-level'), 'L1')
    assert.equal(await page.locator('.twsvg .equip.sel').getAttribute('data-id'), 'FCU_03')
    assert.match(await page.locator('.twfdd li[data-st="fault"]').innerText(), /FD&D_1_Cooling_Performance\nFault · open alarm/)
    // trace downstream from AHU 01: its five VAV boxes would stop, two would only see values change
    await page.locator('.twsvg .equip[data-id="AHU_01"]').focus()
    await page.keyboard.press('Enter')
    await page.locator('.twacts button[data-dir="down"]').click()
    const tr = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.twsvg .equip[data-tr]')].map(g => [g.dataset.id, g.dataset.tr])))
    assert.deepEqual(await tr(), { AHU_01: 'src', VAV_01: 'down-stop', VAV_02: 'down-stop', VAV_03: 'down-stop', VAV_04: 'down-stop', VAV_05: 'down-stop',
      GF_ENERGY: 'down-shift-weak', CHILLED_WATER_PUMP_01: 'down-shift-weak' })
    assert.equal(await page.locator('.twtrace').innerText().then(t => t.split('\n')[0]), 'Downstream of AHU 01: 5 would stop · 2 would change values')
    assert.equal(await page.locator('.twsvg').getAttribute('data-level'), 'ALL', 'the trace reaches the roof: the whole building shows')
    assert.ok(+(await page.locator('.twsvg .equip[data-id="BOILER_01"]').evaluate(g => getComputedStyle(g).opacity)) < 0.5, 'unrelated machines step back')
    assert.ok(await page.locator('.twsvg .pipe.tr-on').count() > 0)
    assert.ok(await page.locator('.twsvg .pipe.tr-on[data-src="CHILLED_WATER_PUMP_01"]').count() > 0, 'pipes of traced machines stand out')
    assert.equal(await page.locator('.twsvg .pipe.tr-on[data-src="BOILER_01"]').count(), 0)
    assert.equal(await page.locator('.twacts button[data-dir="down"]').getAttribute('aria-pressed'), 'true')
    // evidence: confirmed, reference, possible, impact under their own headings
    assert.deepEqual(await page.locator('.twev h4').evaluateAll(hs => hs.map(h => h.dataset.k)), ['confirmed', 'reference', 'possible', 'impact'])
    assert.match(await page.locator('.twev').innerText(), /No upstream equipment has an open alarm or FDD fault/)
    // a layer hidden mid-trace stays hidden; the trace survives a data re-render
    await page.locator('.twlayers button[data-layer="air"]').click()
    await page.evaluate(() => window.EKO.set({}))
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.twsvg .pipe[data-layer="air"]')].every(g => getComputedStyle(g).display === 'none')), true)
    assert.equal((await tr()).VAV_03, 'down-stop')
    await page.locator('.twlayers button[data-layer="air"]').click()
    // trace upstream from VAV 02, across floors: AHU 01 is the one possible cause, with its own FIN alarms
    await page.locator('.twev a, .twev button[data-id="VAV_02"]').first().click()
    assert.equal(await page.locator('.twdt').innerText(), 'VAV 02')
    assert.deepEqual(await tr(), {}, 'selecting another machine ends the trace')
    assert.equal(await page.locator('.twtrace').isHidden(), true)
    await page.locator('.twacts button[data-dir="up"]').click()
    const up = await tr()
    assert.deepEqual([up.VAV_02, up.AHU_01, up.SMDB_01, up.CHILLER_01, up.DEWA_SUPPLY], ['src', 'up-stop', 'up-stop', 'up-shift', 'up-shift'])
    assert.equal(Object.keys(up).length, 11)
    assert.deepEqual(await page.locator('.twev h4[data-k="possible"] + ul > li > button').allInnerTexts(), ['AHU 01'])
    assert.match(await page.locator('.twev h4[data-k="possible"] + ul').innerText(), /Alarm: Cooling Coil is Overcooling/)
    // Escape clears the trace first, then the selection
    await page.keyboard.press('Escape')
    assert.deepEqual(await tr(), {})
    assert.equal(await page.locator('.twdt').innerText(), 'VAV 02')
    assert.equal(await page.locator('.twsvg').getAttribute('class').then(c => /tracing/.test(c)), false)
    // the Clear button in the trace bar
    await page.locator('.twacts button[data-dir="down"]').click()
    await page.locator('.twtrace button[data-tw="untrace"]').click()
    assert.deepEqual(await tr(), {})
    // selection and its own pipes still work after a trace
    await page.locator('.twsvg .equip[data-id="AHU_01"]').focus()
    await page.keyboard.press('Enter')
    assert.deepEqual(await page.locator('.twsvg .pipe.conn').evaluateAll(gs => gs.map(g => g.dataset.pipe).sort()), ['chws_ahu_GF', 'sa_main2_GF', 'sa_main_GF'])
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.twinview').getAttribute('data-sel'), '0')
    assert.deepEqual(page.errors, [])
  } finally { await page.close() }
})

test('a new language rebuilds the view in that language; the same language keeps it', async () => {
  const page = await openFor('eko')
  try {
    await openTwin(page)
    await page.evaluate(() => { window.__tw = document.querySelector('.twinview'); window.EKO.set({}) })
    assert.equal(await page.evaluate(() => document.querySelector('.twinview') === window.__tw), true)
    await page.locator('#topbar [data-act="lang"][data-v="ar"]').first().click()
    await page.waitForFunction(() => document.querySelector('.twinview') !== window.__tw)
    assert.equal(await page.locator('.twttl').innerText(), 'مستشفى EKO – التوأم الحي')
    assert.equal(await page.locator('.twsvg').getAttribute('dir'), 'ltr', 'the drawing stays left to right')
    assert.deepEqual(page.errors, [])
  } finally { await page.close() }
})

test('leaving and coming back; other projects have no Live Twin; the roof schematic still opens', async () => {
  const page = await openFor('eko')
  try {
    await openTwin(page)
    await page.locator('#ekonav .nsub[data-sub="hvac"]').click()
    await page.waitForFunction(() => !document.querySelector('#mount > .twinview'))
    await page.locator('#ekonav .nsub[data-sub="twin"]').click()
    await page.locator('#mount > .twinview').waitFor()
    await page.evaluate(() => window.EKO.go('assets-register', 'assets', 'reg'))
    await page.locator('tr.dgroof button[data-act="roofOpen"]').click()
    await page.locator('#mount > .roofview').waitFor()
    assert.equal(await page.locator('.twinview').count(), 0)
    assert.deepEqual(page.errors, [])
  } finally { await page.close() }
  const marsa = await openFor('marsa')
  try {
    await marsa.locator('#ekonav .nvi[data-mod="systems"]').click()
    await marsa.locator('#ekonav .nsub').first().waitFor()
    assert.equal(await marsa.locator('#ekonav .nsub[data-sub="twin"]').count(), 0)
    assert.equal(await marsa.evaluate(() => typeof window.EKO_TWIN_MAP), 'undefined', 'no Hospital mapping in another project')
    assert.equal(await marsa.evaluate(() => typeof window.EKO_TWIN), 'undefined', 'no Hospital relationships or traces in another project')
    await marsa.evaluate(() => window.EKO.go('live-twin', 'systems', 'twin'))
    assert.equal(await marsa.locator('.twinview').count(), 0, 'a direct route goes to the Overview')
  } finally { await marsa.close() }
})

/* Phase 5: the Studio's BIM bridge is not in this harness (no model, no Studio). A stand-in with the same method names records what the twin asks of it. */
const HOST_STUB = () => {
  window.__calls = []
  const rec = n => (...a) => { window.__calls.push([n, ...a]) }
  window.EKO_HOST_ENGINE = { highlightAsset: rec('highlightAsset'), clearHighlight: rec('clearHighlight'), flyToAsset: rec('flyToAsset'), isolateLevel: rec('isolateLevel'),
    listMapped: () => [], listLevels: () => [{ id: 'LEVEL-01', name: 'LEVEL-01' }], inModel: g => g === '2wLf9$IGsICFYFjFAcUnf2' }
}
const fixtureFeed = () => {
  const fx = n => JSON.parse(fs.readFileSync(path.join(root, 'spec/fixtures/eko-hospital', n), 'utf8'))
  return fx('equipment.json').equipment.map(e => ({ id: e.name, finId: e.finId, bimId: e.bimId, floor: e.floor, tags: e.tags, typeEn: String(e.type).toUpperCase(), st: 'ok', points: e.points }))
}
const feedIn = (page, assets, extra = {}) => page.evaluate(([a, x]) => { window.DashboardData = window.DashboardData || {}
  Object.defineProperty(window.DashboardData, 'connected', { get: () => true, configurable: true }); window.EKO.data.assets = a; Object.assign(window.EKO.data, x); window.EKO.set({}) }, [assets, extra])
const calls = page => page.evaluate(() => window.__calls.filter(c => c[0] === 'highlightAsset' || c[0] === 'clearHighlight'))

test('BIM: a verified GlobalId is highlighted on selection; a shared one never; a pick in the model finds its machine; Show in BIM model goes to the model', async () => {
  const page = await openFor('eko')
  try {
    await page.evaluate(HOST_STUB)
    await openTwin(page)
    await feedIn(page, fixtureFeed(), { equipmentAt: new Date().toISOString() })
    await page.locator('.twtabs [data-tab="equip"]').click(); assert.match(await page.locator('.twside').innerText(), /25 with a verified BIM element · 19 without one · 2 on a shared id · 0 in conflict · 4 not checked/)
    assert.match(await page.locator('.twside').innerText(), /Shared BIM ID: VAV_07 · VAV_10\. These assets cannot be linked to the model/)
    assert.equal(await page.locator('.twsvg .equip[data-bim="verified"]').count(), 25)
    await page.evaluate(() => { window.__calls = [] })
    await page.evaluate(() => window.EKO_TWIN.goTo(document.querySelector('.twinview'), 'AHU_01'))
    assert.deepEqual(await calls(page), [['highlightAsset', '2wLf9$IGsICFYFjFAcUnf2']], 'by the GlobalId itself, not the asset id')
    assert.equal(await page.locator('.twchip[data-bim]').innerText(), 'BIM element verified')
    assert.match(await page.locator('.twside').innerText(), /IFC GlobalId\n2wLf9\$IGsICFYFjFAcUnf2\nFrom\nEquipment record\nLoaded model\nElement found\nModel storey\nLEVEL-01/)
    // a data refresh does not highlight again
    await page.evaluate(() => window.EKO.set({}))
    assert.equal((await calls(page)).length, 1)
    // VAV 07: FIN shares its id with VAV 10: nothing highlighted, the issue said
    await page.evaluate(() => window.EKO_TWIN.goTo(document.querySelector('.twinview'), 'VAV_07'))
    assert.deepEqual((await calls(page)).slice(1), [['clearHighlight']])
    assert.equal(await page.locator('.twchip[data-bim]').innerText(), 'BIM id shared · not linked')
    assert.match(await page.locator('.twside').innerText(), /shared with VAV_10/)
    assert.equal(await page.locator('[data-tw="bim"]').count(), 0)
    // no BIM id in FIN (BTU 01): nothing guessed
    await page.evaluate(() => window.EKO_TWIN.goTo(document.querySelector('.twinview'), 'BTU_01'))
    assert.equal(await page.locator('.twchip[data-bim]').innerText(), 'No BIM element')
    // a pick in the model while elsewhere: the Live Twin opens on that machine; a pick on the shared id finds nothing
    await page.evaluate(() => window.EKO.go(window.EKO.overviewId(), 'overview', null))
    assert.deepEqual((await calls(page)).slice(-1), [['clearHighlight']], 'leaving the twin ends its highlight')
    const vav07 = await page.evaluate(() => String(window.EKO.data.assets.find(a => a.id === 'VAV_07').bimId).replace(/\\\$/g, '$'))
    assert.equal(await page.evaluate(g => window.EKO_TWIN.machineForBim(window.EKO, g), vav07), null)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('viewer-command', { detail: { action: 'openAssetByBimId', bimId: '1bdVDp2sfD5mmOxkY5qzYy' } })))
    await page.locator('#ekonav .nvi[data-mod="systems"]').click()
    await page.locator('#ekonav .nsub[data-sub="twin"]').click()
    await page.locator('#mount > .twinview').waitFor()
    assert.equal(await page.locator('.twdt').innerText(), 'VAV 03')
    assert.equal(await page.locator('.twsvg').getAttribute('data-level'), 'GF')
    assert.match(await page.locator('.twside').innerText(), /Selected from the BIM model \(element 1bdVDp2sfD5mmOxkY5qzYy\)/)
    // Show in BIM model: the Overview's model, the floor of that FIN name when the model has one
    await page.evaluate(() => window.EKO_TWIN.goTo(document.querySelector('.twinview'), 'AHU_01'))
    await page.locator('[data-tw="bim"]').click()
    await page.waitForFunction(() => window.EKO.state.pageId === window.EKO.overviewId())
    assert.equal(await page.evaluate(() => window.EKO.state.dock.level), 'LEVEL-01')
    assert.equal(await page.locator('.twinview').count(), 0)
    assert.deepEqual(page.errors, [])
  } finally { await page.close() }
})

test('live feed: an old equipment read is stale on every machine; energy meters are shown as unverified candidates, never mapped', async () => {
  const page = await openFor('eko')
  try {
    await openTwin(page)
    const meter = { id: 'GF_ENERGY', finId: 'p:ekoHospital:r:meter-gf', floor: 'LEVEL-01', tags: ['meter'], typeEn: 'METER',
      points: [{ navName: 'GF_ENERGY_CONSUMPTION', currentValue: '41.2', unit: 'kW', pointKind: 'Number', reporting: true, status: 'ok', bool: null }] }
    await feedIn(page, fixtureFeed(), { equipmentAt: new Date().toISOString(), finExcluded: [meter] })
    assert.equal(await page.locator('.twstatus').innerText(), '46 of 46 mapped equipment in the live feed', 'the candidate is not counted')
    await page.evaluate(() => window.EKO_TWIN.goTo(document.querySelector('.twinview'), 'GF_ENERGY'))
    assert.equal(await page.locator('.twchip[data-fin]').innerText(), 'Unmapped')
    assert.match(await page.locator('.twcand').innerText(), /Candidate record \(unverified\)[\s\S]*p:ekoHospital:r:meter-gf[\s\S]*GF_ENERGY_CONSUMPTION\t41\.2 kW/i)
    assert.equal(await page.locator('.twsvg .equip[data-id="GF_ENERGY"]').getAttribute('data-fin'), 'unmapped')
    // the backend stops reading FIN: its last list grows old
    await page.evaluate(() => { window.EKO.data.equipmentAt = new Date(Date.now() - 10 * 60000).toISOString(); window.EKO.set({}) })
    assert.match(await page.locator('.twstatus').innerText(), /^Live data stale · last read /)
    assert.equal(await page.locator('.twsvg .equip[data-fin="stale"]').count(), 46)
    await page.evaluate(() => window.EKO_TWIN.goTo(document.querySelector('.twinview'), 'CHILLER_01'))
    assert.ok(await page.locator('.twpts tr').count() > 0)
    assert.equal(await page.locator('.twpts tr:not([data-st="stale"])').count(), 0, 'no value shown as current')
    // disconnected
    await page.evaluate(() => { Object.defineProperty(window.DashboardData, 'connected', { get: () => false, configurable: true }); window.EKO.set({}) })
    assert.equal(await page.locator('.twstatus').innerText(), 'Live data not connected')
    assert.deepEqual(page.errors, [])
  } finally { await page.close() }
})

test('switching projects in the same tab leaves nothing of the Hospital behind', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(String(e)))
  try {
    await page.addInitScript(cfgs => { window.INJECTED_PROJECT_CONFIG = { ...cfgs[sessionStorage.getItem('kind') || 'eko'] } }, CONFIGS)
    await page.goto(base + '/')
    await page.waitForFunction(() => window.EKO && document.querySelector('#ekonav .nvi'))
    await openTwin(page)
    await page.evaluate(() => sessionStorage.setItem('kind', 'marsa'))
    await page.reload()
    await page.waitForFunction(() => window.EKO && document.querySelector('#ekonav .nvi'))
    assert.deepEqual(await page.evaluate(() => [typeof window.EKO_TWIN, typeof window.EKO_TWIN_MAP]), ['undefined', 'undefined'])
    await page.locator('#ekonav .nvi[data-mod="systems"]').click()
    assert.equal(await page.locator('#ekonav .nsub[data-sub="twin"]').count(), 0)
    // a pick in Marsa's model is the dashboard's own: the twin does nothing
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('viewer-command', { detail: { action: 'openAssetByBimId', bimId: '2wLf9$IGsICFYFjFAcUnf2' } })))
    assert.equal(await page.locator('.twinview').count(), 0)
    assert.deepEqual(errors, [])
  } finally { await ctx.close() }
})

/* the alarm export as data-map.js keeps it: FIN's time and its cleared records */
const fixtureAlarms = (raisedAt = Date.parse('2026-11-06T12:00:00Z')) => JSON.parse(fs.readFileSync(path.join(root, 'spec/fixtures/eko-hospital/alarms.json'), 'utf8')).alarms
  .map(a => ({ id: a.id, sourceId: a.source_id, state: a.state, plainEn: a.message, techEn: a.detail, sev: a.severity, finSeverity: a.severity, priority: a.priority, raisedAt,
    hist: a.history.map(h => ({ id: h.id, msg: h.message, tech: h.detail, open: h.open, at: raisedAt - 3600e3, state: h.state })) }))
const newAlarm = (finId, id, at) => ({ id, sourceId: finId, state: 'x_AlarmStatus', plainEn: 'Test alarm ' + id, sev: 'info', raisedAt: at })
const flowOf = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.twsvg .pipe')].map(g => [g.dataset.pipe, g.dataset.flow])))
/* what is animating: the flow state of each animated pipe, 'rotor' for a turning fan or pump */
const animating = page => page.evaluate(() => document.querySelector('.twsvg').getAnimations({ subtree: true }).filter(a => a instanceof CSSAnimation).map(a => {
  const t = a.effect.target, pipe = t.closest('.pipe'); return { kind: pipe ? pipe.dataset.flow : 'rotor:' + t.closest('.equip').dataset.run, layer: pipe ? pipe.dataset.layer : null,
    level: t.closest('.tw-level').dataset.level, state: a.playState } }))

test('exhibition and sidebar: tabs, fly to new alarms, labels, settings kept; no word FIN on screen', async () => {
  const page = await openFor('eko')
  try {
    await openTwin(page)
    const [alTab, eqTab] = await page.locator('.twtabs button').allInnerTexts()
    assert.match(alTab, /^Alarms \(\d+\)$/); assert.equal(eqTab, 'Equipment')
    assert.equal(await page.locator('.twtabs [data-tab="alarms"]').getAttribute('aria-selected'), 'true')
    assert.equal(await page.locator('[data-tw-ex="fly"]').isChecked(), true, 'on by default, as in the reference')
    assert.equal(await page.locator('.twexoff input').isDisabled(), true, 'no random faults in the live view')
    assert.match(await page.locator('.twexoff').innerText(), /Random faults and repairs\s+Not available in the live view: no simulated faults are created\./)
    const assets = fixtureFeed(), base = fixtureAlarms()
    await feedIn(page, assets, { equipmentAt: new Date().toISOString(), alarms: base })
    assert.equal(await page.locator('.twinview').getAttribute('data-sel'), '0', 'alarms present when the view opened are not flown to')
    assert.equal(await page.locator('.twtabs button').first().innerText(), 'Alarms (10)')
    assert.match(await page.locator('.twallist li').first().innerText(), /AHU 01 · Ground floor · Open · severity info · priority 150 · /)
    assert.ok(await page.locator('.twcleared li').count() > 0, 'recently cleared records listed')
    assert.equal(await page.locator('.twcleared li').filter({ hasText: 'Returned to normal' }).count(), await page.locator('.twcleared li').count())
    assert.equal(await page.locator('.twallist li').filter({ hasText: 'Return to normal' }).count(), 0, 'a cleared record is never active')
    // a new alarm (raised now) takes the view to its machine, on its floor, once
    const ahu2 = assets.find(a => a.id === 'AHU_02').finId
    await page.evaluate(al => { window.EKO.data.alarms = al; window.EKO.set({}) }, [...base, newAlarm(ahu2, 'n1', Date.now() + 1000)])
    assert.equal(await page.locator('.twdt').innerText(), 'AHU 02')
    assert.equal(await page.locator('.twsvg').getAttribute('data-level'), 'L1')
    assert.equal(await page.locator('.twtabs [data-tab="equip"]').getAttribute('aria-selected'), 'true')
    // not while another machine is being looked at
    await page.evaluate(() => window.EKO_TWIN.select(document.querySelector('.twinview'), 'BOILER_01'))
    const fcu3 = assets.find(a => a.id === 'FCU_03').finId
    await page.evaluate(al => { window.EKO.data.alarms = al; window.EKO.set({}) }, [...base, newAlarm(ahu2, 'n1', Date.now()), newAlarm(fcu3, 'n2', Date.now() + 1000)])
    assert.equal(await page.locator('.twdt').innerText(), 'Boiler 01')
    // switched off: never
    await page.evaluate(() => { window.EKO_TWIN.select(document.querySelector('.twinview'), null); const c = document.querySelector('[data-tw-ex="fly"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })) })
    await page.evaluate(al => { window.EKO.data.alarms = al; window.EKO.set({}) }, [...base, newAlarm(fcu3, 'n3', Date.now() + 1000)])
    assert.equal(await page.locator('.twinview').getAttribute('data-sel'), '0')
    // an alarm click selects its machine, shows its floor and the Equipment tab
    await page.locator('.twtabs [data-tab="alarms"]').click()
    await page.locator('.twallist li:has-text("Cooling Performance Fault"):has-text("FCU 05") button').click()
    assert.equal(await page.locator('.twdt').innerText(), 'FCU 05')
    assert.equal(await page.locator('.twsvg').getAttribute('data-level'), 'L2')
    assert.match(await page.locator('.twpane').innerText(), /Running|Stopped|Run status unavailable/)
    // live points update in place
    await page.evaluate(() => { const a = window.EKO.data.assets.find(x => x.id === 'FCU_05'); a.points.find(p => p.navName === 'FanSpeed').currentValue = 'Low'; a.points.find(p => p.navName === 'FanSpeed').text = 'Low'; window.EKO.set({}) })
    assert.equal(await page.locator('.twpts tr:has(th:text-is("FanSpeed")) td').innerText(), 'Low')
    // labels: Off hides them all, Always shows every label on the floors in view, Auto follows the zoom
    await page.locator('.twbar button[data-tw="home"]').click()
    const shownTags = () => page.evaluate(() => [...document.querySelectorAll('.twsvg .tag')].filter(t => getComputedStyle(t).display !== 'none').length)
    const total = await page.locator('.twsvg .tag').count()
    await page.locator('[data-tw-ex="labels"]').selectOption('off')
    assert.equal(await shownTags(), 0)
    await page.locator('[data-tw-ex="labels"]').selectOption('always')
    assert.equal(await shownTags(), total)
    await page.locator('[data-tw-ex="labels"]').selectOption('auto')
    assert.ok(await shownTags() < total, 'far zoom: labels thin out')
    // settings kept for the project through a reload in this session
    await page.locator('[data-tw-ex="labels"]').selectOption('always')
    await page.reload()
    await page.waitForFunction(() => window.EKO && document.querySelector('#ekonav .nvi'))
    await openTwin(page)
    assert.deepEqual([await page.locator('[data-tw-ex="labels"]').inputValue(), await page.locator('[data-tw-ex="fly"]').isChecked()], ['always', false])
    assert.equal(await page.locator('.twsvg').getAttribute('data-labels'), 'always')
    // the word FIN is nowhere on screen, in either tab, with a machine selected or not
    await feedIn(page, assets, { equipmentAt: new Date().toISOString(), alarms: base })
    for (const id of [null, 'AHU_01', 'VAV_07', 'GF_ENERGY', 'DEWA_SUPPLY']) {
      await page.evaluate(id => window.EKO_TWIN.select(document.querySelector('.twinview'), id), id)
      for (const tab of ['alarms', 'equip']) {
        await page.locator(`.twtabs [data-tab="${tab}"]`).click()
        assert.doesNotMatch(await page.locator('.twinview').innerText(), /\bFIN\b/, `${id} ${tab}`)
      }
    }
    assert.deepEqual(page.errors, [])
  } finally { await page.close() }
})

test('live flow: only metered flow moves, running equipment never claims flow, nothing moves without data; layers, floors, polling, reduced motion', async () => {
  const page = await openFor('eko')
  try {
    await openTwin(page)
    assert.equal(await page.locator('.twsvg .pipe:not([data-flow="unknown"])').count(), 0, 'no feed: every network unknown')
    assert.deepEqual(await animating(page), [], 'and still')
    await feedIn(page, fixtureFeed(), { equipmentAt: new Date().toISOString() })
    const f = await flowOf(page)
    assert.deepEqual([f.chws_hdr_GF, f.dcw_L1, f.sa_vav_06, f.o2_GF, f.ma_GF, f.pwr_dewa_pmu], ['measured', 'measured', 'measured', 'measured', 'measured', 'measured'])
    assert.deepEqual([f.cws_ct_cwp, f.cwr_ch_ct, f.fa_in_GF, f.sa_main_GF, f.hw_boiler_riser, f.ea_01], ['running', 'running', 'running', 'running', 'running', 'running'], 'pumps and fans running: status only')
    assert.deepEqual([f.chws_ahu_GF, f.gen_ats], ['unknown', 'stopped'])
    const kinds = [...new Set((await animating(page)).map(a => a.kind))].sort()
    assert.deepEqual(kinds, ['measured', 'rotor:on'], 'only measured flow and running fans and pumps move')
    // polling keeps the drawing: same elements, no rebuild
    await page.evaluate(() => { window.__p = document.querySelector('.twsvg .pipe[data-pipe="chws_hdr_GF"]'); window.__svg = document.querySelector('.twsvg'); window.EKO.set({}); window.EKO.set({}) })
    assert.deepEqual(await page.evaluate(() => [document.querySelector('.twsvg .pipe[data-pipe="chws_hdr_GF"]') === window.__p, document.querySelector('.twsvg') === window.__svg]), [true, true])
    // a hidden layer does not animate
    await page.locator('.twlayers button[data-layer="chw"]').click()
    assert.equal((await animating(page)).filter(a => a.layer === 'chw').length, 0)
    await page.locator('.twlayers button[data-layer="chw"]').click()
    assert.ok((await animating(page)).some(a => a.layer === 'chw'))
    // a picked floor: the faded floors pause
    await page.locator('.twseg button[data-lv="L1"]').click()
    const byLevel = await animating(page)
    assert.ok(byLevel.filter(a => a.level !== 'L1').every(a => a.state === 'paused') && byLevel.some(a => a.level === 'L1' && a.state === 'running'))
    await page.locator('.twbar button[data-tw="home"]').click()
    // the meter at 0 stops the chilled water flow; its pumps still running say nothing of the water
    await page.evaluate(() => { const p = window.EKO.data.assets.find(x => x.id === 'BTU_01').points.find(q => q.navName === 'CHWFlow'); p.currentValue = '0L/s'; window.EKO.set({}) })
    assert.equal((await flowOf(page)).chws_hdr_GF, 'stopped')
    // disconnected or stale: nothing flows, nothing turns
    await page.evaluate(() => { window.EKO.data.equipmentAt = new Date(Date.now() - 10 * 60000).toISOString(); window.EKO.set({}) })
    assert.equal(await page.locator('.twsvg .pipe:not([data-flow="unknown"])').count(), 0, 'stale')
    await page.evaluate(() => { window.EKO.data.equipmentAt = new Date().toISOString(); Object.defineProperty(window.DashboardData, 'connected', { get: () => false, configurable: true }); window.EKO.set({}) })
    assert.equal(await page.locator('.twsvg .pipe:not([data-flow="unknown"])').count(), 0, 'disconnected')
    assert.deepEqual(await animating(page), [])
    // reduced motion: states still shown, nothing moves
    await page.evaluate(() => { Object.defineProperty(window.DashboardData, 'connected', { get: () => true, configurable: true }); window.EKO.set({}) })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.ok(await page.locator('.twsvg .pipe[data-flow="measured"]').count() > 0)
    assert.deepEqual(await animating(page), [])
    assert.deepEqual(page.errors, [])
  } finally { await page.close() }
})

test('phone width: page header with the Systems tabs, details under the building, no sideways scroll', async () => {
  const page = await openFor('eko', { width: 390, height: 844 })
  try {
    await page.evaluate(() => window.EKO.go('live-twin', 'systems', 'twin'))
    await page.locator('#mount > .twinview').waitFor()
    assert.equal(await page.locator('#mount > #pagehead .phsub[data-sub="twin"]').getAttribute('data-on'), '1')
    const side = await page.locator('.twside').boundingBox(), stage = await page.locator('.twstage').boundingBox()
    assert.ok(side.y >= stage.y + stage.height - 1, 'the panel is under the stage')
    assert.ok(stage.width > 300)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  } finally { await page.close() }
})
