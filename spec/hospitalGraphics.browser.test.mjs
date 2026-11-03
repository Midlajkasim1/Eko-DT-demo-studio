import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// The real dashboard (templates/index.html + static/dashboard) in a browser, with the settings DashboardOverlay injects:
//   - the Assets register lists "Hospital Roof – HVAC Graphics" for Eko Hospital only,
//   - clicking it opens the O&M/warranty popup with a frame on the CONNECTED FIN server (two fake FIN servers on different
//     ports stand in for FIN before and after its address changed), keeping the stable path,
//   - loading note, close button, Escape, one popup at a time, frame removed on close, a useful message when there is no server
//     or the frame does not load, and the O&M popup still works.
// The fake FIN servers are local test servers; this does NOT prove real FIN sign-in or framing, which needs the Hospital network.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }
const STABLE_PATH = '/finMobile/ekoHospital'
const STABLE_HASH = '#frame?app=graphics&targetRef=@p:ekoHospital:r:3260abd5-07a0a7b6&url=%2Ffin5%2FekoHospital%3FprojectRef%3D%40p%3AekoHospital%3Ar%3A326dc5ee-27ca9b5a%26title%3DshowSettings%23targetRef%3D%40p%3AekoHospital%3Ar%3A3260abd5-07a0a7b6'

let dash, finA, finB, browser, base
const hits = { A: [], B: [] }
let finMode = 'ok'   // ok | hang

const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)))
const fakeFin = tag => http.createServer((req, res) => {
  hits[tag].push(req.url)
  if (finMode === 'hang') return   // never answers
  res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>fake FIN ${tag}</title><body>fake FIN graphic ${tag}</body>`)
})

let finAUrl, finBUrl
before(async () => {
  dash = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const file = p === '/' ? path.join(root, 'templates/index.html') : path.join(root, p)
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  finA = fakeFin('A'); finB = fakeFin('B')
  ;[base, finAUrl, finBUrl] = await Promise.all([listen(dash), listen(finA), listen(finB)])
  browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
})
after(async () => {
  await browser?.close()
  for (const s of [dash, finA, finB]) { s?.closeAllConnections?.(); await new Promise(r => s?.close(r)) }
})

const site = (name, finProject) => ({ name, displayName: '', finProject, timezone: 'Asia/Dubai' })

/** A dashboard page with the config DashboardOverlay injects; `server` is what the connected FIN server is right now (null = none). */
async function openFor(kind) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(base + '/')
  await page.waitForFunction(() => window.EKO && window.EKO.data)
  await page.evaluate(kind => {
    window.__fin = { server: null }
    const eko = kind === 'eko'
    window.INJECTED_PROJECT_CONFIG = {
      projectId: 'p-' + kind, demo: false, hospitalHvac: eko,
      site: { name: eko ? 'Eko Hospital' : 'Marsa Al Arab', displayName: '', finProject: eko ? 'ekoHospital' : 'marsaAlArab', timezone: 'Asia/Dubai' }, basis: {},
      graphics: eko ? [{ id: 'hospital-roof-hvac', title: 'Hospital Roof – HVAC Graphics', get url() { return window.__fin.server ? window.__fin.server + '/finMobile/ekoHospital#frame' : null } }] : [],
    }
  }, kind)
  return page
}
/** The real stable path and hash, appended to whichever server the page says it is connected to */
const connect = (page, server) => page.evaluate(([server, p, h]) => {
  window.__fin.server = server
  const g = window.INJECTED_PROJECT_CONFIG.graphics[0]
  if (g) Object.defineProperty(g, 'url', { configurable: true, get: () => window.__fin.server ? window.__fin.server + p + h : null })
}, [server, STABLE_PATH, STABLE_HASH])
const showRegister = async page => {
  await page.evaluate(() => window.EKO.set({ pageId: 'assets-register', module: 'assets', sub: 'reg', assetSel: null }))
  await page.waitForSelector('table.dg')
}
const rows = page => page.locator('tr.dgfin')
const popup = page => page.locator('#docov')

test('Eko Hospital: the Assets register lists the graphics entry on top, clickable, with an icon; other projects do not', async () => {
  const eko = await openFor('eko')
  await showRegister(eko)
  assert.equal(await rows(eko).count(), 1)
  assert.ok((await rows(eko).innerText()).includes('Hospital Roof – HVAC Graphics'))
  assert.ok(await rows(eko).locator('svg').count() > 0, 'an icon')
  const firstRow = await eko.locator('table.dg tbody tr').first().getAttribute('class')
  assert.equal(firstRow, 'dgfin', 'top of the list')
  await eko.close()

  const marsa = await openFor('marsa')
  await showRegister(marsa)
  assert.equal(await rows(marsa).count(), 0, 'Marsa: hidden')
  await marsa.evaluate(() => { delete window.INJECTED_PROJECT_CONFIG })
  await showRegister(marsa)
  assert.equal(await rows(marsa).count(), 0, 'no injected config (standalone / other project): hidden')
  await marsa.close()
})

test('the entry is not an asset: the register\'s own rows and count are unchanged by it', async () => {
  const eko = await openFor('eko'); await showRegister(eko)
  const marsa = await openFor('marsa'); await showRegister(marsa)
  const count = p => p.locator('table.dg tbody tr[data-row], table.dg tbody tr:not(.dgfin):not(.dgx)').count()
  assert.equal(await count(eko), await count(marsa))
  await eko.close(); await marsa.close()
})

test('click opens the popup with a frame on the connected FIN server and the exact stable path and hash', async () => {
  hits.A.length = 0
  const page = await openFor('eko'); await showRegister(page)
  await connect(page, finAUrl)
  await rows(page).locator('button.dgfinb').click()
  await popup(page).waitFor()
  assert.equal(await popup(page).locator('.doctitle').innerText(), 'Hospital Roof – HVAC Graphics')
  const src = await popup(page).locator('iframe.docframe').getAttribute('src')
  assert.equal(src, finAUrl + STABLE_PATH + STABLE_HASH)
  await page.waitForFunction(() => !document.querySelector('#docov .docstate'), null, { timeout: 10000 })   // loaded: note removed
  assert.ok(hits.A.some(u => u.startsWith(STABLE_PATH)), 'the fake FIN server was asked for the stable path')
  await page.close()
})

test('the whole row opens it too, and a second click leaves one popup and one frame', async () => {
  const page = await openFor('eko'); await showRegister(page); await connect(page, finAUrl)
  await rows(page).locator('td').click({ position: { x: 600, y: 8 } })
  await popup(page).waitFor()
  await page.evaluate(() => document.querySelector('[data-act="graphicOpen"]').click())
  await page.evaluate(() => document.querySelector('[data-act="graphicOpen"]').click())
  assert.equal(await page.locator('#docov').count(), 1)
  assert.equal(await page.locator('#docov iframe').count(), 1)
  await page.close()
})

test('the FIN address changing: after reconnecting to another server the new one is used, nothing of the old one remains', async () => {
  hits.A.length = 0; hits.B.length = 0
  const page = await openFor('eko'); await showRegister(page)
  await connect(page, finAUrl)
  await rows(page).locator('button.dgfinb').click()
  await page.waitForFunction(() => !document.querySelector('#docov .docstate'))
  await page.evaluate(() => document.querySelector('[data-act="docClose"]').click())
  assert.ok(hits.A.length > 0)
  const seenA = hits.A.length

  await connect(page, finBUrl)   // FIN is now on another address; the page was not reloaded
  await rows(page).locator('button.dgfinb').click()
  await page.waitForFunction(() => !document.querySelector('#docov .docstate'))
  const src = await popup(page).locator('iframe.docframe').getAttribute('src')
  assert.equal(src, finBUrl + STABLE_PATH + STABLE_HASH)
  assert.ok(!src.includes(finAUrl), 'no old address')
  assert.ok(hits.B.some(u => u.startsWith(STABLE_PATH)))
  assert.equal(hits.A.length, seenA, 'the old server is not asked again')
  await page.close()
})

test('close button, Escape and a click outside each remove the popup and its frame', async () => {
  const page = await openFor('eko'); await showRegister(page); await connect(page, finAUrl)
  const open = async () => { await rows(page).locator('button.dgfinb').click(); await popup(page).waitFor() }
  await open()
  await popup(page).locator('.docx').click()
  assert.equal(await page.locator('#docov').count(), 0, 'close button')
  assert.equal(await page.locator('iframe.docframe').count(), 0, 'frame removed')
  await open()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.getElementById('docov'))
  await open()
  await page.mouse.click(4, 4)
  await page.waitForFunction(() => !document.getElementById('docov'))
  assert.equal(await page.locator('iframe.docframe').count(), 0)
  await page.close()
})

test('a loading note shows while the frame loads and a clear error replaces it when the frame does not load in time', async () => {
  finMode = 'hang'
  const page = await openFor('eko'); await showRegister(page); await connect(page, finAUrl)
  await page.clock.install()
  await rows(page).locator('button.dgfinb').click()
  await popup(page).waitFor()
  const state = popup(page).locator('.docstate')
  assert.ok((await state.innerText()).includes('Loading'), 'loading note')
  assert.equal(await state.getAttribute('data-err'), null)
  await page.clock.fastForward(31000)
  assert.equal(await state.getAttribute('data-err'), '1')
  const msg = await state.innerText()
  assert.ok(msg.includes('did not load') && msg.includes('X-Frame-Options') && msg.includes('sign in'), msg)
  assert.ok(await state.locator('a[target=_blank]').count() === 1, 'the open-in-new-tab link sits beside the explanation, it does not replace the frame')
  assert.equal(await popup(page).locator('iframe.docframe').count(), 1, 'the frame is still there')
  finMode = 'ok'
  await page.close()
})

test('not connected to FIN: the popup says so, loads no frame source, and nothing is guessed', async () => {
  const page = await openFor('eko'); await showRegister(page)   // server stays null
  await rows(page).locator('button.dgfinb').click()
  await popup(page).waitFor()
  const state = popup(page).locator('.docstate')
  assert.equal(await state.getAttribute('data-err'), '1')
  assert.ok((await state.innerText()).includes('No FIN server'))
  assert.equal(await popup(page).locator('iframe.docframe').getAttribute('src'), null)
  assert.equal(await popup(page).locator('a[target=_blank]').count(), 0, 'no link to a made-up address')
  await page.evaluate(s => { window.__fin.server = s }, 'javascript:alert(1)')
  await popup(page).locator('.docx').click()
  await connect(page, 'javascript:alert(1)')
  await rows(page).locator('button.dgfinb').click()
  assert.equal(await popup(page).locator('iframe.docframe').getAttribute('src'), null, 'a non-http address is refused')
  await page.close()
})

test('switching projects: Eko Hospital -> Marsa -> Eko Hospital shows the entry only where it belongs', async () => {
  const page = await openFor('eko'); await showRegister(page)
  assert.equal(await rows(page).count(), 1)
  await page.evaluate(() => { window.INJECTED_PROJECT_CONFIG = { projectId: 'p-marsa', demo: true, hospitalHvac: false, site: { name: 'Marsa', finProject: 'marsaAlArab', timezone: 'Asia/Dubai' }, basis: {}, graphics: [] }; window.EKO.set({ pageId: 'assets-register', sub: 'reg2' }); window.EKO.set({ sub: 'reg' }) })
  await page.waitForSelector('table.dg')
  assert.equal(await rows(page).count(), 0)
  await page.close()
})

test('the O&M / warranty popup still opens, with a download link and no loading note; a foreign address is still refused', async () => {
  const page = await openFor('marsa')
  await page.evaluate(() => {
    const b = document.createElement('button')
    b.dataset.act = 'docOpen'; b.dataset.title = 'O&M manual'; b.dataset.url = '/api/fin/file?ref=' + encodeURIComponent('@p:marsa:r:1a2b-3c4d')
    b.id = 'omtest'; document.body.appendChild(b)
    const c = document.createElement('button')
    c.dataset.act = 'docOpen'; c.dataset.title = 'x'; c.dataset.url = 'https://evil.example/api/fin/file?ref=%40p%3Amarsa%3Ar%3A1a2b-3c4d'
    c.id = 'evil'; document.body.appendChild(c)
  })
  await page.evaluate(() => document.getElementById('evil').click())
  assert.equal(await page.locator('#docov').count(), 0, 'foreign origin refused')
  await page.evaluate(() => document.getElementById('omtest').click())
  await popup(page).waitFor()
  assert.equal(await popup(page).locator('.doctitle').innerText(), 'O&M manual')
  assert.equal(await popup(page).locator('a[download]').count(), 1)
  assert.equal(await popup(page).locator('.docstate').count(), 0)
  assert.ok((await popup(page).locator('iframe.docframe').getAttribute('src')).startsWith('/api/fin/file?ref='))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.getElementById('docov'))
  await page.close()
})
