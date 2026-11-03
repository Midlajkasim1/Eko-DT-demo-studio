import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// The real dashboard (templates/index.html + static/dashboard) in a browser, with the settings DashboardOverlay injects
// (INJECTED_PROJECT_CONFIG.hospitalHvac = true only for the ekoHospital FIN project):
//   - the Assets register lists the Hospital roof entry with a Schematic button for Eko Hospital only (no iframe action),
//   - the button opens the native SVG schematic in the popup frame; close, Escape, outside click, zoom and fit work,
//   - values come from the dashboard's live equipment feed: only for confirmed equipment and exactly named, reporting points,
//     refreshed on every feed update; a missing or invalid point is "—",
//   - a confirmed equipment opens its existing asset panel; the O&M / warranty popup still works.
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
async function openFor(kind, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport })
  await page.goto(base + '/')
  await page.waitForFunction(() => window.EKO && window.EKO.data && window.EKO_ROOF)
  // What DashboardOverlay does on each project open: inject the project's settings, then run data-map.js, which maps the live feed
  await page.evaluate(cfg => { window.DASHBOARD_OVERLAY = true; if (cfg) window.INJECTED_PROJECT_CONFIG = cfg; else delete window.INJECTED_PROJECT_CONFIG }, CONFIGS[kind])
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
/** What the page reads of one value: its state and the text on screen */
const value = (page, id) => page.evaluate(id => {
  const g = document.querySelector(`#docov .rf-val[data-item="${id}"]`)
  return g && { state: g.dataset.state, status: g.dataset.status || null, text: g.querySelector('.rf-txt').textContent }
}, id)
const confirm = (page, map) => page.evaluate(map => { window.EKO_ROOF.SLOTS.forEach(s => { if (map[s.id]) s.equip = map[s.id] }) }, map)
const openSchematic = async page => {
  await showRegister(page)
  await page.locator('tr.dgroof button[data-act="roofOpen"]').click()
  await popup(page).locator('svg.rf-svg').waitFor()
}

const TOWER = [point('FAN_SPEED', '62.5', { unit: '%' }), point('FAN_RUN_STATUS', 'On'), point('CW_ENTERING_TEMP', '33.9', { unit: '°C' }), point('CW_LEAVING_TEMP', '29.89', { unit: '°C' }), point('FAN_ENABLE_CMD', 'Enable'), point('FAN_TRIP', 'Normal'), point('HOA', 'AUTO')]
const CHILLER = [point('RUN_STATUS', 'Off'), point('POWER', '94.3'), point('ALARM_STATUS', 'Normal'), point('ENABLE_CMD', 'Enable'), point('OPERATING_HOURS', '1018')]

test('the Hospital roof entry is in the Assets register with a Schematic button for Eko Hospital only, and has no iframe action', async () => {
  const eko = await openFor('eko'); await showRegister(eko)
  assert.equal(await eko.locator('tr.dgroof').count(), 1)
  const btn = eko.locator('tr.dgroof button[data-act="roofOpen"]')
  assert.equal((await btn.innerText()).trim(), 'Schematic')
  assert.ok((await eko.locator('tr.dgroof').innerText()).includes('Hospital Roof'))
  assert.ok(await eko.locator('tr.dgroof svg').count() > 0, 'an icon')
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
  await feed(page, [{ name: 'CT-01', points: TOWER }, { name: 'CH-01', points: CHILLER }])
  await showRegister(page)
  const rows = () => page.locator('table.dg tbody tr:not(.dgroof):not(.dgx)').allInnerTexts()
  const withEntry = await rows()
  assert.equal(withEntry.length, 2, 'the register lists the two assets of the feed')
  await page.evaluate(() => { window.INJECTED_PROJECT_CONFIG.hospitalHvac = false; window.EKO.set({ sub: 'reg2' }); window.EKO.set({ sub: 'reg' }) })
  await page.waitForFunction(() => !document.querySelector('tr.dgroof'))
  assert.deepEqual(await rows(), withEntry, 'the entry adds no row, count or asset')
  await page.close()
})

test('the Schematic button opens the native SVG schematic: no iframe, a connected drawing with all six equipment', async () => {
  const page = await openFor('eko'); await openSchematic(page)
  assert.equal(await popup(page).locator('iframe').count(), 0)
  assert.equal(await popup(page).locator('.doctitle').innerText(), 'Hospital Roof – HVAC')
  const probe = await page.evaluate(() => {
    const svg = document.querySelector('#docov svg.rf-svg')
    const pipes = [...svg.querySelectorAll('.rf-pipes path')].map(p => p.getAttribute('stroke'))
    return { slots: [...svg.querySelectorAll('.rf-eq')].map(g => g.dataset.slot), pipes, panels: svg.querySelectorAll('.rf-panel').length, vals: svg.querySelectorAll('.rf-val').length, vb: svg.getAttribute('viewBox') }
  })
  assert.deepEqual(probe.slots.sort(), ['boiler', 'btu', 'chilledPumps', 'chiller', 'condenserPumps', 'coolingTower'])
  assert.ok(['#3fae49', '#2b8cee', '#e53030'].every(c => probe.pipes.includes(c)), 'green, blue and red pipes')
  assert.equal(probe.panels, 6)
  assert.equal(probe.vb, '0 0 1280 960')
  await page.close()
})

test('without confirmed equipment every value is "—" and says why; the mapping status lists each slot as requiring confirmation', async () => {
  const page = await openFor('eko')
  await feed(page, [{ name: 'CT-01', points: TOWER }, { name: 'CHILLER_01', type: 'CHILLER', points: CHILLER }])   // the feed has the right-looking points: still no guess
  await openSchematic(page)
  const states = await page.evaluate(() => [...document.querySelectorAll('#docov .rf-val')].map(g => [g.dataset.state, g.querySelector('.rf-txt').textContent]))
  assert.ok(states.length > 30)
  assert.ok(states.every(([s, t]) => s === 'unconfirmed' && t === '—'))
  await popup(page).locator('details.roofmap summary').click()
  const items = await popup(page).locator('.roofmaplist li').allInnerTexts()
  assert.equal(items.length, 6)
  assert.ok(items.every(t => t.includes('Requires confirmation')))
  assert.ok(items.some(t => t.includes('Chiller') && t.includes('CHILLER_01')), 'the feed\'s candidate is offered as a suggestion')
  assert.equal(await page.locator('#docov .rf-eq[data-act]').count(), 0, 'unconfirmed equipment is not a link')
  await page.close()
})

test('confirmed equipment shows its live FIN values, refreshed on every feed update; a status change is shown', async () => {
  const page = await openFor('eko')
  await feed(page, [{ name: 'CT-01', points: TOWER }, { name: 'CH-01', points: CHILLER }])
  await confirm(page, { coolingTower: 'CT-01', chiller: 'CH-01' })
  await openSchematic(page)
  assert.deepEqual(await value(page, 'ctFanSpeed'), { state: 'live', status: null, text: '62.5 %' })
  assert.deepEqual(await value(page, 'ctCwLeave'), { state: 'live', status: null, text: '29.9 °C' })
  assert.deepEqual(await value(page, 'ctFanRun'), { state: 'live', status: 'on', text: 'On' })
  assert.equal((await value(page, 'ctFanEnable')).text, 'Enable')
  assert.equal((await value(page, 'chPower')).text, '94.3 kW')
  assert.equal((await value(page, 'chRun')).status, 'off')
  assert.equal((await value(page, 'blRun')).state, 'unconfirmed', 'the boiler is not confirmed')

  // FIN reports new readings
  const next = TOWER.map(p => p.navName === 'FAN_SPEED' ? { ...p, currentValue: '80', text: '80' } : p.navName === 'FAN_RUN_STATUS' ? { ...p, currentValue: 'Fault', text: 'Fault' } : p)
  await feed(page, [{ name: 'CT-01', points: next }, { name: 'CH-01', points: CHILLER }])
  await page.waitForFunction(() => document.querySelector('#docov .rf-val[data-item="ctFanSpeed"] .rf-txt')?.textContent === '80 %')
  assert.deepEqual(await value(page, 'ctFanRun'), { state: 'live', status: 'fault', text: 'Fault' })
  assert.equal(await page.locator('#docov .rf-eq[data-slot="coolingTower"] rect:not(.rf-hit)').first().getAttribute('stroke'), '#c62828', 'the unit is drawn in the fault colour')
  await page.close()
})

test('a missing, not reporting or invalid point is "—", and a vanished unit does not keep its old value', async () => {
  const page = await openFor('eko')
  await feed(page, [{ name: 'CT-01', points: [point('FAN_SPEED', '62.5'), point('CW_ENTERING_TEMP', 'On'), point('CW_LEAVING_TEMP', '30', { reporting: false })] }])
  await confirm(page, { coolingTower: 'CT-01' })
  await openSchematic(page)
  assert.equal((await value(page, 'ctFanSpeed')).text, '62.5 %')
  assert.deepEqual(await value(page, 'ctFanRun'), { state: 'no-point', status: null, text: '—' })
  assert.deepEqual(await value(page, 'ctCwEnter'), { state: 'invalid', status: null, text: '—' })
  assert.deepEqual(await value(page, 'ctCwLeave'), { state: 'not-reporting', status: null, text: '—' })
  await feed(page, [{ name: 'OTHER-01', points: [point('FAN_SPEED', '10')] }])   // the confirmed equipment is no longer in the feed
  await page.waitForFunction(() => document.querySelector('#docov .rf-val[data-item="ctFanSpeed"]')?.dataset.state === 'not-in-feed')
  assert.equal((await value(page, 'ctFanSpeed')).text, '—')
  await page.close()
})

test('clicking a confirmed equipment opens its own asset panel by its existing asset id; unconfirmed equipment does nothing', async () => {
  const page = await openFor('eko')
  await feed(page, [{ name: 'CT-01', points: TOWER }, { name: 'CH-01', points: CHILLER }])
  await confirm(page, { coolingTower: 'CT-01' })
  await openSchematic(page)
  await page.locator('#docov .rf-eq[data-slot="boiler"]').click({ force: true })
  assert.equal(await popup(page).count(), 1, 'the unconfirmed boiler is not a link')
  assert.equal(await page.evaluate(() => window.EKO.state.assetSel), null)
  await page.locator('#docov .rf-eq[data-slot="coolingTower"]').click()
  await page.waitForFunction(() => !document.getElementById('docov'))
  assert.equal(await page.evaluate(() => window.EKO.state.assetSel), 'CT-01')
  await page.waitForSelector('#assetpanel')
  await page.close()
})

test('the equipment is also reachable by keyboard', async () => {
  const page = await openFor('eko')
  await feed(page, [{ name: 'CH-01', points: CHILLER }])
  await confirm(page, { chiller: 'CH-01' })
  await openSchematic(page)
  await page.locator('#docov .rf-eq[data-slot="chiller"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.getElementById('docov'))
  assert.equal(await page.evaluate(() => window.EKO.state.assetSel), 'CH-01')
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

test('zoom in, zoom out and fit change the view, within the drawing', async () => {
  const page = await openFor('eko'); await openSchematic(page)
  const vb = () => page.locator('#docov svg.rf-svg').getAttribute('viewBox').then(v => v.split(' ').map(Number))
  assert.deepEqual(await vb(), [0, 0, 1280, 960])
  await popup(page).locator('[data-rf="in"]').click()
  const zoomed = await vb()
  assert.ok(zoomed[2] < 1280 && zoomed[3] < 960)
  await popup(page).locator('[data-rf="in"]').click(); await popup(page).locator('[data-rf="in"]').click()
  const deep = await vb()
  assert.ok(deep[2] >= 1280 / 8 - 0.01, 'zoom has a limit')
  assert.ok(deep[0] >= 0 && deep[1] >= 0 && deep[0] + deep[2] <= 1280.01 && deep[1] + deep[3] <= 960.01, 'the view stays inside the drawing')
  await popup(page).locator('[data-rf="out"]').click()
  assert.ok((await vb())[2] > deep[2])
  await popup(page).locator('[data-rf="fit"]').click()
  assert.deepEqual(await vb(), [0, 0, 1280, 960])
  await page.close()
})

for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
  test(`rendering (${name}): the schematic fits its popup and the text fits its boxes`, async () => {
    const page = await openFor('eko', viewport)
    await feed(page, [{ name: 'CT-01', points: TOWER }, { name: 'CH-01', points: CHILLER }])
    await confirm(page, { coolingTower: 'CT-01', chiller: 'CH-01' })
    await openSchematic(page)
    const r = await page.evaluate(() => {
      const box = document.querySelector('#docov .docbox').getBoundingClientRect()
      const svg = document.querySelector('#docov svg.rf-svg').getBoundingClientRect()
      // a diagram value is a caption strip over a value box; a panel row is a caption beside its value box (one rect)
      const vals = [...document.querySelectorAll('#docov .rf-val')].map(g => {
        const rects = [...g.querySelectorAll('rect')], cap = g.querySelector('.rf-cap'), txt = g.querySelector('.rf-txt')
        const cb = cap.getBBox(), tb = txt.getBBox()
        const panelRow = rects.length === 1
        const body = rects[rects.length - 1], strip = rects[0]
        const capRoom = panelRow ? +body.getAttribute('x') - 3 - cb.x : +strip.getAttribute('x') + +strip.getAttribute('width') - cb.x
        return { id: g.dataset.item, capW: cb.width, capRoom, txtW: tb.width, bodyW: +body.getAttribute('width') }
      })
      const rs = [...document.querySelectorAll('#docov .rf-val')].map(g => ({ id: g.dataset.item, ...g.getBoundingClientRect().toJSON() }))
      let overlaps = []
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j]
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push(a.id + '/' + b.id)
      }
      return { box: box.toJSON(), svg: svg.toJSON(), vals, overlaps, scrollX: document.documentElement.scrollWidth > innerWidth }
    })
    assert.ok(r.svg.left >= r.box.left - 1 && r.svg.right <= r.box.right + 1 && r.svg.top >= r.box.top - 1 && r.svg.bottom <= r.box.bottom + 1, 'the drawing is inside the popup')
    assert.ok(r.svg.width > 250 && r.svg.height > 150, `the drawing has a usable size (${Math.round(r.svg.width)}x${Math.round(r.svg.height)})`)
    assert.deepEqual(r.overlaps, [], 'no two values overlap on screen')
    for (const v of r.vals) {
      assert.ok(v.capW <= v.capRoom + 0.5, `${v.id}: the caption fits its room (${v.capW.toFixed(1)} > ${v.capRoom.toFixed(1)})`)
      assert.ok(v.txtW <= v.bodyW + 0.5, `${v.id}: the value fits its box (${v.txtW.toFixed(1)} > ${v.bodyW})`)
    }
    assert.equal(r.scrollX, false, 'no horizontal page scroll')
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

test('regression: opening the schematic and then an O&M popup leaves exactly one popup', async () => {
  const page = await openFor('eko'); await openSchematic(page)
  await page.evaluate(() => {
    const b = document.createElement('button'); b.dataset.act = 'docOpen'; b.dataset.title = 'Warranty'; b.dataset.url = '/api/fin/file?ref=' + encodeURIComponent('@p:ekoHospital:r:1a2b-3c4d'); b.id = 'wty'; document.body.appendChild(b); b.click()
  })
  await page.waitForSelector('#docov iframe.docframe')
  assert.equal(await page.locator('#docov').count(), 1)
  assert.equal(await page.locator('#docov svg.rf-svg').count(), 0, 'the schematic was replaced, not stacked')
  await page.close()
})
