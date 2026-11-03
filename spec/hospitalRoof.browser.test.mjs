import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// The real dashboard (templates/index.html + static/dashboard) in a browser, with the settings DashboardOverlay injects
// (INJECTED_PROJECT_CONFIG.hospitalHvac = true only for the ekoHospital FIN project):
//   - the Assets register lists the Hospital roof entry with a Schematic button for Eko Hospital only,
//   - it opens the BMS-style graphic in the popup frame: equipment, coloured pipework, no point tables, no mapping section,
//   - fans, impellers and the flame turn only while the equipment's own run-status point says On; pipes flow only while the pumps
//     (or the measured flow) say so; unmapped, missing, stale and disconnected data leave everything still,
//   - data updates change the drawing in place (a turning fan is not restarted), selecting an equipment shows only its live points,
//   - zoom, pan and fit work; the O&M / warranty popup still works.
// The equipment names and points below are TEST INPUTS, not a FIN export: no roof equipment list exists in this repository.

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
  browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await browser?.close()
  await new Promise(r => server?.close(r))
})

const CONFIGS = {
  eko: { projectId: 'p-eko', demo: false, hospitalHvac: true, site: { name: 'Eko Hospital', finProject: 'ekoHospital', timezone: 'Asia/Dubai' }, basis: {} },
  marsa: { projectId: 'p-marsa', demo: true, hospitalHvac: false, site: { name: 'Marsa Al Arab', finProject: 'marsaAlArab', timezone: 'Asia/Dubai' }, basis: {} },
  other: { projectId: 'p-other', demo: false, hospitalHvac: false, site: { name: 'ANC09 Tower', finProject: 'anc09', timezone: 'Asia/Dubai' }, basis: {} },
  missing: { projectId: 'p-old', demo: false, site: { name: 'Saved before the flag', finProject: 'old', timezone: 'Asia/Dubai' }, basis: {} },
  standalone: null,
}

let loads = 0
async function openFor(kind, viewport = { width: 1440, height: 900 }, opts = {}) {
  const page = await browser.newPage({ viewport, reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference' })
  await page.goto(base + '/')
  await page.waitForFunction(() => window.EKO && window.EKO.data && window.EKO_ROOF)
  // What DashboardOverlay does on each project open: inject the project's settings, then run data-map.js, which maps the live feed.
  // DashboardData.connected is what the data layer reports about FIN: the test controls it (window.__connected).
  await page.evaluate(cfg => {
    window.DASHBOARD_OVERLAY = true
    window.__connected = true
    Object.defineProperty(window, 'DashboardData', { configurable: true, get: () => ({ connected: window.__connected }) })
    if (cfg) window.INJECTED_PROJECT_CONFIG = cfg; else delete window.INJECTED_PROJECT_CONFIG
  }, CONFIGS[kind])
  await page.addScriptTag({ url: `${base}/static/js/data-map.js?load=${++loads}` })
  return page
}
const showRegister = async page => {
  await page.evaluate(() => window.EKO.set({ pageId: 'assets-register', module: 'assets', sub: 'reg', assetSel: null }))
  await page.waitForSelector('table.dg')
}
const popup = page => page.locator('#docov')
const point = (navName, currentValue, extra = {}) => ({ navName, currentValue, text: currentValue, unit: '', reporting: true, ...extra })
/** The equipment feed the way the live data layer delivers it */
const feed = (page, equipment) => page.evaluate(equipment => {
  window.dispatchEvent(new CustomEvent('dashboard-data', { detail: { type: 'equipment', data: { equipment: equipment.map(e => ({ floor: 'Roof', tags: [], type: '', ...e })) } } }))
}, equipment)
const confirm = (page, map) => page.evaluate(map => { window.EKO_ROOF.SLOTS.forEach(s => { if (map[s.id]) s.equip = map[s.id] }) }, map)
const openSchematic = async page => {
  await showRegister(page)
  await page.locator('tr.dgroof button[data-act="roofOpen"]').click()
  await popup(page).locator('svg.rf-svg').waitFor()
}
const ALL = { coolingTower: 'T', condenserPumps: 'CP', chiller: 'C', chilledPumps: 'WP', boiler: 'B', btu: 'BT' }
/** A plant feed; `over` replaces the points of one equipment */
const plant = (over = {}) => [
  { name: 'T', points: over.T ?? [point('FAN_RUN_STATUS', 'On'), point('FAN_SPEED', '82'), point('CW_ENTERING_TEMP', '33.9'), point('CW_LEAVING_TEMP', '30.4')] },
  { name: 'CP', points: over.CP ?? [point('PUMP1_RUN_STATUS', 'On'), point('PUMP2_RUN_STATUS', 'On'), point('PUMP1_SPEED', '100')] },
  { name: 'C', points: over.C ?? [point('RUN_STATUS', 'On'), point('CHWS_TEMP', '8.8'), point('CHWR_TEMP', '16.4'), point('POWER', '94.3'), point('OPERATING_HOURS', '1018')] },
  { name: 'WP', points: over.WP ?? [point('PUMP1_RUN_STATUS', 'On'), point('PUMP2_RUN_STATUS', 'Off')] },
  { name: 'B', points: over.B ?? [point('RUN_STATUS', 'On'), point('HWS_TEMP', '58.2')] },
  { name: 'BT', points: over.BT ?? [point('CHW_FLOW', '11.8'), point('COOLING_POWER', '172.3')] },
]
/** Open the graphic for a confirmed plant */
const openPlant = async (over, viewport, opts) => {
  const page = await openFor('eko', viewport, opts)
  await feed(page, plant(over))
  await confirm(page, ALL)
  await openSchematic(page)
  return page
}

/** Wait until the page's animation clock has advanced by `ms`. A software-rendered headless browser draws frames slowly and the clock only
 *  moves on frames, so this waits for the clock, not for wall-clock time. */
const WAIT_CLOCK = `window.__clock = ms => new Promise(res => { const t0 = document.timeline.currentTime, w0 = performance.now(); const tick = () => document.timeline.currentTime - t0 >= ms ? res(true) : performance.now() - w0 > 15000 ? res(false) : requestAnimationFrame(tick); requestAnimationFrame(tick) })`
/** Is a rotating part turning right now? Reads the computed animation and whether its transform actually changes as the clock advances */
const spin = (page, part) => page.evaluate(async ([part, def]) => {
  if (!window.__clock) (0, eval)(def)
  const el = document.querySelector(`#docov [data-part="${part}"] .rf-rot`)
  await Promise.all(el.getAnimations().map(x => x.ready))   // a just-started animation is pending until the compositor takes it
  const a = getComputedStyle(el).transform
  const ticked = await window.__clock(350)
  const b = getComputedStyle(el).transform
  return { name: getComputedStyle(el).animationName, moving: a !== b, running: el.getAnimations().some(x => x.playState === 'running'), ticked }
}, [part, WAIT_CLOCK])
const flow = (page, loop) => page.evaluate(async ([loop, def]) => {
  if (!window.__clock) (0, eval)(def)
  const el = document.querySelector(`#docov .rf-loop[data-loop="${loop}"] .rf-flow`)
  await Promise.all(el.getAnimations().map(x => x.ready))
  const cs = getComputedStyle(el), a = cs.strokeDashoffset
  await window.__clock(350)
  return { display: getComputedStyle(el).display, name: cs.animationName, moving: a !== getComputedStyle(el).strokeDashoffset, attr: el.closest('.rf-loop').dataset.flow }
}, [loop, WAIT_CLOCK])
const stripTick = ({ ticked, ...rest }) => rest
const chip = (page, id) => page.evaluate(id => { const c = document.querySelector(`#docov [data-chip="${id}"]`); return [c.dataset.state, c.textContent.trim()] }, id)

test('the Hospital roof entry is in the Assets register with a Schematic button for Eko Hospital only, and has no iframe action', async () => {
  const eko = await openFor('eko'); await showRegister(eko)
  assert.equal(await eko.locator('tr.dgroof').count(), 1)
  assert.equal((await eko.locator('tr.dgroof button[data-act="roofOpen"]').innerText()).trim(), 'Schematic')
  assert.ok((await eko.locator('tr.dgroof').innerText()).includes('Hospital Roof'))
  assert.equal(await eko.locator('table.dg tbody tr').first().getAttribute('class'), 'dgroof', 'top of the list')
  assert.equal(await eko.locator('[data-act="graphicOpen"], tr.dgfin, .dgfinb').count(), 0, 'the old iframe action is gone')
  await eko.close()
  for (const kind of ['marsa', 'other', 'missing', 'standalone']) {
    const page = await openFor(kind); await showRegister(page)
    assert.equal(await page.locator('tr.dgroof').count(), 0, kind)
    await page.close()
  }
})

test('the entry is not an asset: the register\'s own rows are unchanged by it', async () => {
  const page = await openFor('eko')
  await feed(page, plant()); await showRegister(page)
  const rows = () => page.locator('table.dg tbody tr:not(.dgroof):not(.dgx)').allInnerTexts()
  const withEntry = await rows()
  assert.equal(withEntry.length, 6, 'the register lists the six assets of the feed')
  await page.evaluate(() => { window.INJECTED_PROJECT_CONFIG.hospitalHvac = false; window.EKO.set({ sub: 'reg2' }); window.EKO.set({ sub: 'reg' }) })
  await page.waitForFunction(() => !document.querySelector('tr.dgroof'))
  assert.deepEqual(await rows(), withEntry, 'the entry adds no row, count or asset')
  await page.close()
})

test('the schematic is a BMS-style plant graphic: six equipment, three coloured loops, no iframe, no point tables, no mapping section', async () => {
  const page = await openFor('eko'); await openSchematic(page)
  assert.equal(await popup(page).locator('iframe').count(), 0)
  assert.equal(await popup(page).locator('.doctitle').innerText(), 'Hospital Roof – HVAC')
  const probe = await page.evaluate(() => {
    const svg = document.querySelector('#docov svg.rf-svg')
    return {
      slots: [...svg.querySelectorAll('.rf-eq')].map(g => g.dataset.slot).sort(),
      loops: [...svg.querySelectorAll('.rf-loop')].map(g => g.dataset.loop).sort(),
      pipeColours: [...new Set([...svg.querySelectorAll('.rf-pipe')].map(p => p.getAttribute('stroke')))].sort(),
      rotors: svg.querySelectorAll('.rf-rot').length,
      text: svg.textContent,
      tables: document.querySelectorAll('#docov .rf-panel, #docov .rf-val, #docov details, #docov .roofmap, #docov table').length,
    }
  })
  assert.deepEqual(probe.slots, ['boiler', 'btu', 'chilledPumps', 'chiller', 'condenserPumps', 'coolingTower'])
  assert.deepEqual(probe.loops, ['chilled', 'condenser', 'hot'])
  assert.deepEqual(probe.pipeColours, ['#2b7fdc', '#35a853', '#e0453a'])
  assert.equal(probe.rotors, 6, 'the tower fan, four pump impellers and the chiller motor fan turn; the boiler has a flame instead')
  assert.equal(probe.tables, 0, 'no equipment point tables, no mapping section')
  assert.ok(!/FANRUNSTATUS|PUMP1RUNSTATUS|OPERATINGHOURS|Mapping status|Candidates/.test(probe.text), 'point names and suggestions are not on the schematic')
  for (const word of ['HOSPITAL ROOF', 'COOLING TOWER', 'CONDENSER WATER PUMPS', 'CHILLER', 'CHILLED WATER PUMPS', 'BOILER', 'BTU METER', 'BUILDING HOT WATER']) assert.ok(probe.text.includes(word), word)
  await page.close()
})

test('with nothing mapped every part is "UNMAPPED" and still: nothing turns, nothing flows, nothing is assumed', async () => {
  const page = await openFor('eko')
  await feed(page, plant())   // the feed has the right-looking points, but no slot is confirmed
  await openSchematic(page)
  for (const id of ['fan', 'cp1', 'cp2', 'wp1', 'wp2', 'chiller', 'boiler', 'btu']) assert.equal((await chip(page, id))[0], 'unmapped', id)
  for (const part of ['fan', 'cp1', 'wp1', 'chiller']) assert.deepEqual(stripTick(await spin(page, part)), { name: 'none', moving: false, running: false }, part)
  for (const loop of ['condenser', 'chilled', 'hot']) {
    const f = await flow(page, loop)
    assert.deepEqual([f.display, f.name, f.moving, f.attr], ['none', 'none', false, 'unknown'], loop)
  }
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#docov .rf-flame')).opacity), '0', 'no flame')
  assert.equal(await page.locator('#docov .rf-eq[data-state="unmapped"]').count(), 6)
  await page.close()
})

test('running equipment turns: the tower fan, each pump impeller and the chiller motor fan rotate; stopped ones do not', async () => {
  const page = await openPlant()
  for (const part of ['fan', 'cp1', 'cp2', 'wp1', 'chiller']) {
    const s = await spin(page, part)
    assert.deepEqual([s.name, s.moving, s.running, s.ticked], ['rf-rot', true, true, true], `${part} turns`)
  }
  assert.deepEqual(stripTick(await spin(page, 'wp2')), { name: 'none', moving: false, running: false }, 'chilled pump 2 is stopped: its impeller does not turn')
  assert.deepEqual((await chip(page, 'wp1')), ['running', 'P1 RUNNING'])
  assert.deepEqual((await chip(page, 'wp2')), ['stopped', 'P2 STOPPED'])
  assert.deepEqual((await chip(page, 'btu')), ['online', 'ONLINE'])
  await page.close()
})

test('the boiler flame burns only while the boiler status says On; a fault shows FAULT and the flame is out', async () => {
  const flame = page => page.evaluate(() => { const f = document.querySelector('#docov .rf-flame'); return [getComputedStyle(f).opacity, getComputedStyle(f).animationName] })
  const page = await openPlant()
  const on = await flame(page)
  assert.equal(on[1], 'rf-flame')
  assert.ok(Number(on[0]) > 0.8)
  await feed(page, plant({ B: [point('RUN_STATUS', 'Fault')] }))
  await page.waitForFunction(() => document.querySelector('#docov [data-chip="boiler"]').dataset.state === 'fault')
  assert.deepEqual(await flame(page), ['0', 'none'])
  assert.deepEqual(await chip(page, 'boiler'), ['fault', 'FAULT'])
  assert.equal(await page.locator('#docov .rf-eq[data-slot="boiler"]').getAttribute('data-state'), 'fault')
  await page.close()
})

test('pipes flow only while the pumps say so: condenser and chilled flow while a pump runs, none when all are stopped, hot follows the boiler', async () => {
  const page = await openPlant({ CP: [point('PUMP1_RUN_STATUS', 'On'), point('PUMP2_RUN_STATUS', 'Off')], B: [point('RUN_STATUS', 'Off')] })
  let f = await flow(page, 'condenser')
  assert.deepEqual([f.attr, f.display, f.name, f.moving], ['on', 'inline', 'rf-flow', true], 'one running condenser pump is enough')
  f = await flow(page, 'chilled')
  assert.deepEqual([f.attr, f.moving], ['on', true])
  f = await flow(page, 'hot')
  assert.deepEqual([f.attr, f.display, f.moving], ['off', 'none', false], 'the boiler is off, so no hot water flow')

  await feed(page, plant({ CP: [point('PUMP1_RUN_STATUS', 'Off'), point('PUMP2_RUN_STATUS', 'Off')], WP: [point('PUMP1_RUN_STATUS', 'Off'), point('PUMP2_RUN_STATUS', 'Off')], BT: [point('CHW_FLOW', '0')], B: [point('RUN_STATUS', 'On')] }))
  await page.waitForFunction(() => document.querySelector('#docov .rf-loop[data-loop="condenser"]').dataset.flow === 'off')
  for (const [loop, want] of [['condenser', 'off'], ['chilled', 'off'], ['hot', 'on']]) {
    const g = await flow(page, loop)
    assert.equal(g.attr, want, loop)
    assert.equal(g.moving, want === 'on', loop)
  }
  // one pump with no status: the loop is "unknown", not stopped
  await feed(page, plant({ CP: [point('PUMP1_RUN_STATUS', 'Off')] }))
  await page.waitForFunction(() => document.querySelector('#docov .rf-loop[data-loop="condenser"]').dataset.flow === 'unknown')
  assert.equal((await flow(page, 'condenser')).moving, false)
  await page.close()
})

test('a live update changes the drawing in place: a running fan keeps turning without restarting, a stopped one stops', async () => {
  const page = await openPlant()
  await page.evaluate(() => {
    const el = document.querySelector('#docov [data-part="fan"] .rf-rot')
    window.__fan = el; window.__anim = el.getAnimations()[0]; window.__t = window.__anim.currentTime
  })
  await page.evaluate(def => { (0, eval)(def); return window.__clock(400) }, WAIT_CLOCK)
  await feed(page, plant({ T: [point('FAN_RUN_STATUS', 'On'), point('FAN_SPEED', '90')] }))   // new reading, still running
  await page.evaluate(() => window.__clock(300))
  const kept = await page.evaluate(() => {
    const el = document.querySelector('#docov [data-part="fan"] .rf-rot')
    const a = el.getAnimations()[0]
    return { sameNode: el === window.__fan, sameAnimation: a === window.__anim, progressed: a.currentTime > window.__t + 500 }
  })
  assert.deepEqual(kept, { sameNode: true, sameAnimation: true, progressed: true })

  await feed(page, plant({ T: [point('FAN_RUN_STATUS', 'Off')] }))
  await page.waitForFunction(() => document.querySelector('#docov [data-chip="fan"]').dataset.state === 'stopped')
  assert.deepEqual(stripTick(await spin(page, 'fan')), { name: 'none', moving: false, running: false })
  assert.deepEqual(await chip(page, 'fan'), ['stopped', 'Fan STOPPED'])
  await feed(page, plant({ T: [point('FAN_RUN_STATUS', 'On')] }))
  await page.waitForFunction(() => document.querySelector('#docov [data-chip="fan"]').dataset.state === 'running')
  assert.equal((await spin(page, 'fan')).moving, true, 'and it turns again when FIN says On')
  await page.close()
})

test('missing, not reporting, stale and invalid status points leave the part at NO DATA and still', async () => {
  const cases = [
    ['no run-status point', [point('FAN_SPEED', '80')]],
    ['not reporting', [point('FAN_RUN_STATUS', 'On', { reporting: false })]],
    ['empty value', [point('FAN_RUN_STATUS', 'null')]],
    ['an unrecognised status text', [point('FAN_RUN_STATUS', 'Standby')]],
    ['a similar name only', [point('FAN_RUN_STATUS_FEEDBACK', 'On')]],
  ]
  for (const [name, points] of cases) {
    const page = await openPlant({ T: points })
    assert.deepEqual(await chip(page, 'fan'), ['unknown', 'Fan NO DATA'], name)
    assert.deepEqual(stripTick(await spin(page, 'fan')), { name: 'none', moving: false, running: false }, name)
    await page.close()
  }
  const page = await openPlant()
  assert.equal((await spin(page, 'fan')).moving, true)
  await page.evaluate(() => { window.EKO.data.assets.forEach(a => { a.st = 'stale' }) })   // the asset is flagged stale
  await feed(page, plant()); await page.evaluate(() => window.EKO.data.assets.forEach(a => { a.st = 'stale' })); await page.evaluate(() => window.dispatchEvent(new CustomEvent('dashboard-data', { detail: { type: 'status', data: { connected: true } } })))
  await page.waitForFunction(() => document.querySelector('#docov [data-chip="fan"]').dataset.state === 'unknown')
  assert.deepEqual(stripTick(await spin(page, 'fan')), { name: 'none', moving: false, running: false }, 'stale: stops')
  await page.close()
})

test('FIN disconnected: everything goes to NO DATA, nothing turns or flows, the status line says so; reconnecting restores it', async () => {
  const page = await openPlant()
  assert.equal((await spin(page, 'fan')).moving, true)
  assert.ok((await page.locator('#docov .rf-strip').textContent()).includes('Live'))
  await page.evaluate(() => { window.__connected = false; window.dispatchEvent(new CustomEvent('dashboard-data', { detail: { type: 'status', data: { connected: false } } })) })
  await page.waitForFunction(() => document.querySelector('#docov [data-chip="fan"]').dataset.state === 'unknown')
  assert.ok((await page.locator('#docov .rf-strip').textContent()).includes('FIN disconnected'))
  for (const part of ['fan', 'cp1', 'wp1', 'chiller']) assert.equal((await spin(page, part)).moving, false, part)
  for (const loop of ['condenser', 'chilled', 'hot']) assert.equal((await flow(page, loop)).attr, 'unknown', loop)
  await page.evaluate(() => { window.__connected = true; window.dispatchEvent(new CustomEvent('dashboard-data', { detail: { type: 'status', data: { connected: true } } })) })
  await page.waitForFunction(() => document.querySelector('#docov [data-chip="fan"]').dataset.state === 'running')
  assert.equal((await spin(page, 'fan')).moving, true)
  await page.close()
})

test('prefers-reduced-motion: nothing is animated, the state chips still tell what runs', async () => {
  const page = await openPlant(undefined, undefined, { reducedMotion: true })
  assert.deepEqual(stripTick(await spin(page, 'fan')), { name: 'none', moving: false, running: false })
  assert.equal((await flow(page, 'condenser')).moving, false)
  assert.deepEqual(await chip(page, 'fan'), ['running', 'Fan RUNNING'])
  await page.close()
})

test('selecting an equipment highlights it and shows only its live points, with a link to its asset panel; selecting again or ✕ closes it', async () => {
  const page = await openPlant()
  await page.locator('#docov .rf-eq[data-slot="chiller"]').click()
  assert.equal(await page.locator('#docov .rf-eq[data-selected]').count(), 1)
  assert.equal(await page.locator('#docov .rf-eq[data-selected]').getAttribute('data-slot'), 'chiller')
  const det = popup(page).locator('.roofdet')
  assert.equal(await det.isVisible(), true)
  const rows = await det.locator('.rd-row').allInnerTexts()
  assert.deepEqual(rows.map(r => r.replace(/\s+/g, ' ')), ['Chiller status On', 'Chilled water supply temperature 8.8 °C', 'Chilled water return temperature 16.4 °C', 'Operating hours 1018 h', 'Power 94.3 kW'])
  assert.ok(!(await det.innerText()).includes('Not mapped'), 'no placeholder rows for points FIN does not report')
  await page.locator('#docov .rf-eq[data-slot="chiller"]').click()
  assert.equal(await det.isVisible(), false)
  await page.locator('#docov .rf-eq[data-slot="btu"]').click()
  assert.ok((await det.innerText()).includes('11.8 L/s'))
  await det.locator('[data-rf="closedet"]').click()
  assert.equal(await det.isVisible(), false)
  assert.equal(await page.locator('#docov .rf-eq[data-selected]').count(), 0)
  await page.close()
})

test('the details follow live data while open, and the asset-panel link opens the equipment\'s existing asset by its id', async () => {
  const page = await openPlant()
  await page.locator('#docov .rf-eq[data-slot="coolingTower"]').click()
  const det = popup(page).locator('.roofdet')
  assert.ok((await det.innerText()).includes('82 %'))
  await feed(page, plant({ T: [point('FAN_RUN_STATUS', 'On'), point('FAN_SPEED', '64')] }))
  await page.waitForFunction(() => document.querySelector('#docov .roofdet')?.textContent.includes('64 %'))
  await det.locator('[data-act="roofAsset"]').click()
  await page.waitForFunction(() => !document.getElementById('docov'))
  assert.equal(await page.evaluate(() => window.EKO.state.assetSel), 'T')
  await page.waitForSelector('#assetpanel')
  await page.close()
})

test('an unmapped or unreporting equipment says what it still needs instead of showing values', async () => {
  const page = await openFor('eko')
  await feed(page, plant()); await openSchematic(page)
  await page.locator('#docov .rf-eq[data-slot="boiler"]').click()
  const text = await popup(page).locator('.roofdet').innerText()
  assert.ok(text.includes('Not mapped to a FIN equipment record yet.'))
  assert.ok(/RUNSTATUS/.test(text) && /HWSTEMP/.test(text))
  assert.equal(await popup(page).locator('.roofdet [data-act="roofAsset"]').count(), 0)
  assert.ok(!/candidate|suggest/i.test(text), 'no candidate equipment is offered')
  await confirm(page, { boiler: 'B' })
  await feed(page, plant({ B: [] }))   // confirmed, but FIN reports none of its points
  await page.waitForFunction(() => document.querySelector('#docov .roofdet')?.textContent.includes('none of this equipment'))
  await page.close()
})

test('close button, Escape and a click outside close it; reopening leaves one popup', async () => {
  const page = await openFor('eko'); await openSchematic(page)
  await popup(page).locator('.docx').click()
  assert.equal(await page.locator('#docov').count(), 0)
  const open = async () => { await page.locator('tr.dgroof button[data-act="roofOpen"]').click(); await popup(page).locator('svg.rf-svg').waitFor() }
  await open(); await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.getElementById('docov'))
  await open(); await page.mouse.click(4, 4)
  await page.waitForFunction(() => !document.getElementById('docov'))
  await open(); await page.evaluate(() => document.querySelector('[data-act="roofOpen"]').click()); await page.evaluate(() => window.EKO_ROOF.open())
  assert.equal(await page.locator('#docov').count(), 1)
  assert.equal(await page.locator('#docov svg.rf-svg').count(), 1)
  await page.close()
})

test('zoom in, zoom out, fit and drag-to-pan are kept and stay inside the drawing', async () => {
  const page = await openFor('eko'); await openSchematic(page)
  const vb = () => page.locator('#docov svg.rf-svg').getAttribute('viewBox').then(v => v.split(' ').map(Number))
  assert.deepEqual(await vb(), [0, 0, 1280, 780])
  await popup(page).locator('[data-rf="in"]').click()
  const zoomed = await vb()
  assert.ok(zoomed[2] < 1280 && zoomed[3] < 780)
  await popup(page).locator('[data-rf="in"]').click(); await popup(page).locator('[data-rf="in"]').click()
  const deep = await vb()
  assert.ok(deep[2] >= 1280 / 8 - 0.01, 'zoom has a limit')
  assert.ok(deep[0] >= 0 && deep[1] >= 0 && deep[0] + deep[2] <= 1280.01 && deep[1] + deep[3] <= 780.01, 'the view stays inside the drawing')
  // pan: drag on empty canvas moves the view
  const box = await page.locator('#docov .rfwrap').boundingBox()
  const empty = await page.evaluate(() => {
    const r = document.querySelector('#docov .rfwrap').getBoundingClientRect()
    for (let y = 0.1; y < 0.95; y += 0.05) for (let x = 0.1; x < 0.95; x += 0.05) {
      const px = r.left + r.width * x, py = r.top + r.height * y
      if (document.elementFromPoint(px, py)?.classList.contains('rf-bg')) return [px, py]
    }
    return null
  })
  assert.ok(empty, 'there is empty canvas to drag')
  await page.mouse.move(empty[0], empty[1])
  await page.mouse.down(); await page.mouse.move(empty[0] - 60, empty[1] - 40, { steps: 4 }); await page.mouse.up()
  const panned = await vb()
  assert.ok(panned[0] !== deep[0] || panned[1] !== deep[1], 'dragging pans the view')
  assert.ok(panned[0] >= 0 && panned[0] + panned[2] <= 1280.01 && panned[1] >= 0 && panned[1] + panned[3] <= 780.01)
  // wheel zoom
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 300)
  assert.ok((await vb())[2] >= panned[2], 'wheel down zooms out')
  await popup(page).locator('[data-rf="out"]').click()
  await popup(page).locator('[data-rf="fit"]').click()
  assert.deepEqual(await vb(), [0, 0, 1280, 780])
  await page.close()
})

for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
  test(`rendering (${name}): the graphic fills the popup, and no label or state chip overlaps another`, async () => {
    const page = await openPlant(undefined, viewport)
    const r = await page.evaluate(() => {
      const wrap = document.querySelector('#docov .rfwrap').getBoundingClientRect()
      const bg = document.querySelector('#docov .rf-bg').getBoundingClientRect()
      const box = document.querySelector('#docov .docbox').getBoundingClientRect()
      const items = [...document.querySelectorAll('#docov .rf-chip, #docov .rf-lbl, #docov .rf-legend text, #docov .rf-strip text, #docov svg > text')].map((e, i) => ({ id: (e.dataset.chip || e.textContent).slice(0, 24), ...e.getBoundingClientRect().toJSON() }))
      const overlaps = []
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j]
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push(`${a.id} / ${b.id}`)
      }
      return { fillW: bg.width / wrap.width, fillH: bg.height / wrap.height, box: box.toJSON(), vw: innerWidth, vh: innerHeight, bg: bg.toJSON(), overlaps, count: items.length, scrollX: document.documentElement.scrollWidth > innerWidth }
    })
    assert.ok(Math.max(r.fillW, r.fillH) >= 0.95, `the drawing fills the popup in one dimension (${r.fillW.toFixed(2)} x ${r.fillH.toFixed(2)})`)
    assert.ok(r.box.width >= r.vw * 0.9 && r.box.height >= r.vh * 0.9, `the popup takes most of the screen (${Math.round(r.box.width)}x${Math.round(r.box.height)})`)
    assert.ok(r.bg.left >= r.box.left - 1 && r.bg.right <= r.box.right + 1, 'the drawing is inside the popup')
    assert.deepEqual(r.overlaps, [], 'no two labels or chips overlap')
    assert.ok(r.count >= 20)
    assert.equal(r.scrollX, false, 'no horizontal page scroll')
    // an open details panel keeps the drawing usable
    await page.locator('#docov .rf-eq[data-slot="chiller"]').click({ force: true })
    const after = await page.evaluate(() => {
      const bg = document.querySelector('#docov .rf-bg').getBoundingClientRect(), det = document.querySelector('#docov .roofdet').getBoundingClientRect(), box = document.querySelector('#docov .docbox').getBoundingClientRect()
      return { bgW: bg.width, bgH: bg.height, inside: det.left >= box.left - 1 && det.right <= box.right + 1 && det.bottom <= box.bottom + 1 }
    })
    assert.ok(after.bgW > 200 && after.bgH > 120 && after.inside, `the drawing and the panel both fit (${Math.round(after.bgW)}x${Math.round(after.bgH)})`)
    await page.close()
  })
}

test('switching projects: Eko Hospital -> Marsa -> Eko Hospital shows the entry only where it belongs', async () => {
  const page = await openFor('eko'); await showRegister(page)
  assert.equal(await page.locator('tr.dgroof').count(), 1)
  await page.evaluate(cfg => { window.INJECTED_PROJECT_CONFIG = cfg; window.EKO.set({ sub: 'reg2' }); window.EKO.set({ sub: 'reg' }) }, CONFIGS.marsa)
  await page.waitForSelector('table.dg')
  assert.equal(await page.locator('tr.dgroof').count(), 0)
  await page.evaluate(cfg => { window.INJECTED_PROJECT_CONFIG = cfg; window.EKO.set({ sub: 'reg2' }); window.EKO.set({ sub: 'reg' }) }, CONFIGS.eko)
  await page.waitForSelector('table.dg')
  assert.equal(await page.locator('tr.dgroof').count(), 1)
  await page.close()
})

test('regression: the O&M / warranty popup still opens with its download link; a foreign address is refused; Escape closes it', async () => {
  const page = await openFor('marsa')
  await page.evaluate(() => {
    const mk = (id, url, title) => { const b = document.createElement('button'); b.dataset.act = 'docOpen'; b.dataset.title = title; b.dataset.url = url; b.id = id; document.body.appendChild(b) }
    mk('om', '/api/fin/file?ref=' + encodeURIComponent('@p:marsa:r:1a2b-3c4d'), 'O&M manual')
    mk('evil', 'https://evil.example/api/fin/file?ref=%40p%3Amarsa%3Ar%3A1a2b-3c4d', 'x')
  })
  await page.evaluate(() => document.getElementById('evil').click())
  assert.equal(await page.locator('#docov').count(), 0, 'foreign origin refused')
  await page.evaluate(() => document.getElementById('om').click())
  await popup(page).waitFor()
  assert.equal(await popup(page).locator('.doctitle').innerText(), 'O&M manual')
  assert.equal(await popup(page).locator('a[download]').count(), 1)
  assert.equal(await popup(page).locator('a[target=_blank]').count(), 1)
  assert.ok((await popup(page).locator('iframe.docframe').getAttribute('src')).startsWith('/api/fin/file?ref='))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.getElementById('docov'))
  await page.close()
})

test('regression: opening the graphic and then an O&M popup leaves exactly one popup, and the dashboard data listener is released', async () => {
  const page = await openPlant()
  await page.evaluate(() => {
    const b = document.createElement('button'); b.dataset.act = 'docOpen'; b.dataset.title = 'Warranty'; b.dataset.url = '/api/fin/file?ref=' + encodeURIComponent('@p:ekoHospital:r:1a2b-3c4d'); b.id = 'wty'; document.body.appendChild(b); b.click()
  })
  await page.waitForSelector('#docov iframe.docframe')
  assert.equal(await page.locator('#docov').count(), 1)
  assert.equal(await page.locator('#docov svg.rf-svg').count(), 0, 'the graphic was replaced, not stacked')
  await feed(page, plant())   // a feed update with the graphic gone must not throw or redraw anything
  assert.equal(await page.locator('#docov svg.rf-svg').count(), 0)
  await page.close()
})
