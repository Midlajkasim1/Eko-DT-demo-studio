import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// The real dashboard (templates/index.html + static/dashboard) in a browser, with the settings DashboardOverlay injects
// (INJECTED_PROJECT_CONFIG.hospitalHvac = true and roofGraphic = the connected FIN server + the client's route, only for ekoHospital):
//   - the Assets register lists the Hospital roof entry with a Schematic button for Eko Hospital only,
//   - the button opens the CLIENT'S FIN SCREEN in an iframe inside the existing popup frame: exact URL, no new tab, responsive,
//   - the FIN address always comes from the connection (two stand-in servers play FIN before and after its address changed),
//   - with no FIN server it says so and loads nothing; close, Escape and outside click work; O&M / warranty still work,
//   - AUTHENTICATION EVIDENCE: what the browser sends to FIN for the frame, and what happens when FIN redirects to its sign-in page or
//     forbids framing, observed through the stand-in servers' logs and the browser's own console and network errors.
// The stand-in servers are local test servers. This does NOT prove that the real FIN shows the graphic inside the Studio: that needs a
// browser on the Hospital network, signed in to FIN, and FIN's response headers allowing the frame.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }
const ROUTE = '/fin5/ekoHospital?projectRef=@p:ekoHospital:r:326dc5ee-27ca9b5a#targetRef=@p:ekoHospital:r:3260abd5-07a0a7b6'
const FIN_PATH = '/fin5/ekoHospital?projectRef=@p:ekoHospital:r:326dc5ee-27ca9b5a'   // what a server receives: the hash is never sent

let dash, finA, finB, browser, dashBase, A, B
const seen = { A: [], B: [] }
const M = { needSession: false, xfo: false }   // how the stand-in FIN behaves for the current test

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)))
/** A stand-in for FIN: the graphic page, a sign-in page that forbids framing, and a way to hold a FIN session cookie */
const fakeFin = tag => http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const cookie = /finsess=1/.test(req.headers.cookie || '')
  if (u.pathname === '/set-session') {
    const attrs = u.searchParams.get('sa') === 'None' ? 'SameSite=None; Secure' : 'SameSite=Lax'
    res.writeHead(200, { 'set-cookie': `finsess=1; Path=/; ${attrs}`, 'content-type': 'text/html' }).end('signed in to FIN in this browser'); return
  }
  seen[tag].push({ url: req.url, dest: req.headers['sec-fetch-dest'], site: req.headers['sec-fetch-site'], cookie })
  if (u.pathname === '/user/login') { res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' }).end('<title>FIN sign in</title>sign in'); return }
  if (u.pathname === '/fin5/ekoHospital') {
    if (M.needSession && !cookie) { res.writeHead(302, { location: '/user/login' }).end(); return }
    res.writeHead(200, { 'content-type': 'text/html', ...(M.xfo ? { 'x-frame-options': 'DENY' } : {}) }).end(`<!doctype html><title>stand-in FIN graphic ${tag}</title><h1>FIN graphic ${tag}</h1>`); return
  }
  res.writeHead(404).end()
})

before(async () => {
  dash = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const file = p === '/' ? path.join(root, 'templates/index.html') : path.join(root, p)
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  finA = fakeFin('A'); finB = fakeFin('B')
  const [dp, ap, bp] = await Promise.all([listen(dash), listen(finA), listen(finB)])
  // the Studio is on "localhost" and each FIN on "127.0.0.1": different sites, like the Studio host and a FIN IP
  dashBase = `http://localhost:${dp}`; A = `http://127.0.0.1:${ap}`; B = `http://127.0.0.1:${bp}`
  browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
})
after(async () => {
  await browser?.close()
  for (const s of [dash, finA, finB]) { s?.closeAllConnections?.(); await new Promise(r => s?.close(r)) }
})
const reset = () => { seen.A.length = 0; seen.B.length = 0; M.needSession = false; M.xfo = false }

const CONFIGS = {
  eko: { projectId: 'p-eko', demo: false, hospitalHvac: true, site: { name: 'Eko Hospital', finProject: 'ekoHospital', timezone: 'Asia/Dubai' }, basis: {} },
  marsa: { projectId: 'p-marsa', demo: true, hospitalHvac: false, site: { name: 'Marsa Al Arab', finProject: 'marsaAlArab', timezone: 'Asia/Dubai' }, basis: {} },
  other: { projectId: 'p-other', demo: false, hospitalHvac: false, site: { name: 'ANC09 Tower', finProject: 'anc09', timezone: 'Asia/Dubai' }, basis: {} },
  missing: { projectId: 'p-old', demo: false, site: { name: 'Saved before the flag', finProject: 'old', timezone: 'Asia/Dubai' }, basis: {} },
  standalone: null,
}

let loads = 0
/** A dashboard page with what DashboardOverlay injects. `window.__finServer` stands for the FIN server the session is connected to. */
async function openFor(kind, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  page.once('close', () => { ctx.close().catch(() => {}) })
  page.logs = []
  page.on('console', m => page.logs.push(m.text()))
  page.fails = []
  page.on('requestfailed', r => page.fails.push(`${r.url().split('#')[0]} ${r.failure()?.errorText || ''}`))
  page.popups = 0
  ctx.on('page', () => { page.popups++ })
  await page.goto(dashBase + '/')
  await page.waitForFunction(() => window.EKO && window.EKO.data)
  await page.evaluate(([cfg, route]) => {
    window.DASHBOARD_OVERLAY = true
    window.__finServer = null
    if (cfg) {
      window.INJECTED_PROJECT_CONFIG = { ...cfg }
      // what hospitalRoofGraphic() gives the dashboard: only for the Hospital project, the URL read from the connection when opened
      if (cfg.hospitalHvac) window.INJECTED_PROJECT_CONFIG.roofGraphic = { title: 'Hospital Roof Graphic', get url() { return window.__finServer ? window.__finServer + route : null } }
      else window.INJECTED_PROJECT_CONFIG.roofGraphic = null
    } else delete window.INJECTED_PROJECT_CONFIG
  }, [CONFIGS[kind], ROUTE])
  await page.addScriptTag({ url: `${dashBase}/static/js/data-map.js?load=${++loads}` })
  return page
}
const connect = (page, server) => page.evaluate(s => { window.__finServer = s }, server)
const showRegister = async page => {
  await page.evaluate(() => window.EKO.set({ pageId: 'assets-register', module: 'assets', sub: 'reg', assetSel: null }))
  await page.waitForSelector('table.dg')
}
const popup = page => page.locator('#docov')
const openGraphic = async page => {
  await showRegister(page)
  await page.locator('tr.dgroof button[data-act="roofOpen"]').click()
  await popup(page).waitFor()
}
const frameSrc = page => popup(page).locator('iframe.roofframe').getAttribute('src')
const settle = page => page.waitForTimeout(1200)   // let the frame's requests finish

test('the Hospital roof entry is in the Assets register with a Schematic button for Eko Hospital only', async () => {
  const eko = await openFor('eko'); await showRegister(eko)
  assert.equal(await eko.locator('tr.dgroof').count(), 1)
  assert.equal((await eko.locator('tr.dgroof button[data-act="roofOpen"]').innerText()).trim(), 'Schematic')
  assert.ok((await eko.locator('tr.dgroof').innerText()).includes('Hospital Roof'))
  assert.equal(await eko.locator('table.dg tbody tr').first().getAttribute('class'), 'dgroof', 'top of the list')
  await eko.close()
  for (const kind of ['marsa', 'other', 'missing', 'standalone']) {
    const page = await openFor(kind); await showRegister(page)
    assert.equal(await page.locator('tr.dgroof').count(), 0, kind)
    await page.close()
  }
})

test('the entry is not an asset: the register\'s own rows are unchanged by it', async () => {
  const page = await openFor('eko')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('dashboard-data', { detail: { type: 'equipment', data: { equipment: [
    { name: 'T', floor: 'Roof', tags: [], type: '', points: [] }, { name: 'C', floor: 'Roof', tags: [], type: '', points: [] }] } } })))
  await showRegister(page)
  const rows = () => page.locator('table.dg tbody tr:not(.dgroof):not(.dgx)').allInnerTexts()
  const withEntry = await rows()
  assert.equal(withEntry.length, 2)
  await page.evaluate(() => { window.INJECTED_PROJECT_CONFIG.hospitalHvac = false; window.EKO.set({ sub: 'reg2' }); window.EKO.set({ sub: 'reg' }) })
  await page.waitForFunction(() => !document.querySelector('tr.dgroof'))
  assert.deepEqual(await rows(), withEntry)
  await page.close()
})

test('the Schematic button opens the client\'s FIN screen in an iframe inside the existing popup: exact URL, no new tab, no native drawing', async () => {
  reset()
  const page = await openFor('eko'); await connect(page, A)
  await openGraphic(page)
  assert.equal(await popup(page).locator('iframe.roofframe').count(), 1)
  assert.equal(await frameSrc(page), A + ROUTE, 'the connected FIN server + the client\'s exact path, query and hash')
  assert.equal(await popup(page).locator('iframe.roofframe').getAttribute('title'), 'Hospital Roof Graphic')
  assert.equal(await popup(page).locator('.doctitle').innerText(), 'Hospital Roof – HVAC')
  assert.equal(await popup(page).locator('svg, a[target="_blank"], .rf-svg').count(), 0, 'no native schematic and no link to another tab')
  await page.waitForFunction(() => !document.querySelector('#docov .roofload'))   // the frame reported loaded
  await settle(page)
  const hit = seen.A.find(r => r.url === FIN_PATH)
  assert.ok(hit, 'FIN was asked for the client\'s route (the hash stays in the browser): ' + JSON.stringify(seen.A))
  assert.equal(hit.dest, 'iframe')
  assert.equal(page.popups, 0, 'no new tab or window was opened')
  const css = await page.evaluate(() => { const f = document.querySelector('#docov .roofframe'); const c = getComputedStyle(f); return { border: c.borderTopWidth, display: c.display } })
  assert.deepEqual(css, { border: '0px', display: 'block' })
  await page.close()
})

test('the FIN address comes from the connection: after FIN moves and the user reconnects, the new address is used and the old one is never asked again', async () => {
  reset()
  const page = await openFor('eko'); await connect(page, A)
  await openGraphic(page)
  assert.equal(await frameSrc(page), A + ROUTE)
  await settle(page)
  const askedA = seen.A.length
  assert.ok(askedA > 0)
  await popup(page).locator('.docx').click()
  await connect(page, B)   // the same page, no reload: the next open reads the new connection
  await page.locator('tr.dgroof button[data-act="roofOpen"]').click()
  await popup(page).waitFor()
  assert.equal(await frameSrc(page), B + ROUTE)
  assert.ok(!(await frameSrc(page)).includes(A), 'no trace of the old address')
  await settle(page)
  assert.ok(seen.B.some(r => r.url === FIN_PATH))
  assert.equal(seen.A.length, askedA, 'the old server is not asked again')
  await page.close()
})

test('not connected to FIN: the popup says so and loads nothing; an unusable address is refused; nothing is guessed', async () => {
  reset()
  const page = await openFor('eko')   // __finServer stays null
  await openGraphic(page)
  assert.equal(await popup(page).locator('iframe').count(), 0)
  const msg = await popup(page).locator('.roofnone').innerText()
  assert.ok(msg.includes('No FIN server') && msg.includes('Connect to FIN'))
  assert.equal(await popup(page).locator('a').count(), 0, 'no link to a made-up address')
  for (const bad of ['javascript:alert(1)', 'ftp://x', 'not a url']) {
    await popup(page).locator('.docx').click()
    await page.evaluate(b => { window.INJECTED_PROJECT_CONFIG.roofGraphic = { title: 'x', url: b } }, bad)
    await page.locator('tr.dgroof button[data-act="roofOpen"]').click()
    await popup(page).waitFor()
    assert.equal(await popup(page).locator('iframe').count(), 0, bad)
  }
  assert.deepEqual(seen.A.concat(seen.B), [], 'FIN was never contacted')
  await page.close()
})

test('close button, Escape and a click outside close the popup and remove the frame; reopening leaves one popup and one frame', async () => {
  reset()
  const page = await openFor('eko'); await connect(page, A)
  await openGraphic(page)
  await popup(page).locator('.docx').click()
  assert.equal(await page.locator('#docov').count(), 0)
  assert.equal(await page.locator('iframe.roofframe').count(), 0, 'frame removed')
  const open = async () => { await page.locator('tr.dgroof button[data-act="roofOpen"]').click(); await popup(page).locator('iframe.roofframe').waitFor() }
  await open(); await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.getElementById('docov'))
  await open(); await page.mouse.click(4, 4)
  await page.waitForFunction(() => !document.getElementById('docov'))
  await open()
  await page.evaluate(() => { document.querySelector('[data-act="roofOpen"]').click(); document.querySelector('[data-act="roofOpen"]').click() })
  assert.equal(await page.locator('#docov').count(), 1)
  assert.equal(await page.locator('#docov iframe').count(), 1)
  await page.close()
})

test('responsive: 100% wide, 850px tall as the starting size, filling a bigger popup and shrinking in a smaller one', async () => {
  reset()
  const measure = async viewport => {
    const page = await openFor('eko', viewport); await connect(page, A)
    await openGraphic(page)
    const m = await page.evaluate(() => {
      const f = document.querySelector('#docov .roofframe').getBoundingClientRect(), w = document.querySelector('#docov .roofframewrap').getBoundingClientRect(), b = document.querySelector('#docov .docbox').getBoundingClientRect()
      return { fw: f.width, fh: f.height, ww: w.width, wh: w.height, bw: b.width, bh: b.height, vw: innerWidth, scrollX: document.documentElement.scrollWidth > innerWidth }
    })
    await page.close()
    return m
  }
  const big = await measure({ width: 1920, height: 1300 })
  assert.ok(Math.abs(big.fw - big.ww) <= 1, 'full width of the popup')
  assert.ok(big.fh >= 850, `a roomy popup gives at least the 850px reference (${Math.round(big.fh)})`)
  assert.ok(Math.abs(big.fh - big.wh) <= 1, 'and it fills the popup')
  const mid = await measure({ width: 1440, height: 900 })
  assert.ok(mid.fh < 850 && Math.abs(mid.fh - mid.wh) <= 1, `a shorter screen shrinks it to fit (${Math.round(mid.fh)}) instead of overflowing`)
  assert.ok(Math.abs(mid.fw - mid.ww) <= 1)
  const phone = await measure({ width: 390, height: 800 })
  assert.ok(Math.abs(phone.fw - phone.ww) <= 1 && phone.fw > 300, `full width on a phone (${Math.round(phone.fw)})`)
  assert.ok(phone.fh > 300 && phone.fh <= phone.wh + 1)
  assert.equal(phone.scrollX, false, 'no horizontal page scroll')
  assert.ok(mid.bw >= 1440 * 0.9 && mid.bh >= 900 * 0.9, 'the popup takes most of the screen')
})

// ── authentication / framing evidence: what the browser does with the frame, observed against stand-in FIN servers ──

test('EVIDENCE · a browser with no FIN session: FIN redirects the frame to its sign-in page, and that page forbids framing, so the frame is blank', async () => {
  reset(); M.needSession = true
  const page = await openFor('eko'); await connect(page, A)
  await openGraphic(page)
  await settle(page)
  const first = seen.A.find(r => r.url === FIN_PATH)
  assert.equal(first.cookie, false, 'no FIN session cookie was sent for the frame')
  assert.ok(seen.A.some(r => r.url === '/user/login' && r.dest === 'iframe'), 'FIN sent the frame to /user/login: ' + JSON.stringify(seen.A))
  assert.ok(page.logs.some(l => /Refused to display .*X-Frame-Options/.test(l)), 'the browser says it refused the sign-in page in a frame: ' + JSON.stringify(page.logs.slice(-4)))
  assert.ok(page.fails.some(f => /\/user\/login .*ERR_BLOCKED_BY_RESPONSE/.test(f)), 'and the network log shows ERR_BLOCKED_BY_RESPONSE: ' + JSON.stringify(page.fails))
  // The page cannot tell: the frame fired `load`, so the loading note is gone although nothing is showing. This is why the popup never claims success.
  assert.equal(await page.locator('#docov .roofload').count(), 0)
  await page.close()
})

test('EVIDENCE · signed in to FIN in a normal tab: a Lax session cookie is NOT sent for the cross-site frame, so it still ends at the sign-in page', async () => {
  reset(); M.needSession = true
  const page = await openFor('eko'); await connect(page, A)
  const tab = await page.context().newPage()
  await tab.goto(A + '/set-session?sa=Lax')   // the user has signed in to FIN in this browser
  await tab.close()
  await openGraphic(page)
  await settle(page)
  const req = seen.A.find(r => r.url === FIN_PATH)
  assert.equal(req.site, 'cross-site')
  assert.equal(req.cookie, false, 'the browser withheld the SameSite=Lax session cookie from the cross-site frame')
  assert.ok(seen.A.some(r => r.url === '/user/login'), 'so FIN redirected to sign in')
  await page.close()
})

test('EVIDENCE · a session cookie set with SameSite=None; Secure IS sent for the frame, and the graphic is served', async () => {
  reset(); M.needSession = true
  const page = await openFor('eko'); await connect(page, A)
  const tab = await page.context().newPage()
  await tab.goto(A + '/set-session?sa=None')
  await tab.close()
  await openGraphic(page)
  await settle(page)
  const req = seen.A.find(r => r.url === FIN_PATH)
  assert.equal(req.cookie, true, 'the session cookie reached FIN from inside the frame')
  assert.ok(!seen.A.some(r => r.url === '/user/login'), 'no redirect to sign in')
  assert.ok(!page.logs.some(l => /Refused to display/.test(l)), 'no framing refusal')
  await page.close()
})

test('EVIDENCE · FIN forbidding framing on the graphic itself: the browser refuses it, with a console message naming the header', async () => {
  reset(); M.xfo = true
  const page = await openFor('eko'); await connect(page, A)
  await openGraphic(page)
  await settle(page)
  assert.ok(page.logs.some(l => /Refused to display .*X-Frame-Options/.test(l)), JSON.stringify(page.logs.slice(-4)))
  assert.ok(page.fails.some(f => f.includes('/fin5/ekoHospital') && /ERR_BLOCKED_BY_RESPONSE/.test(f)))
  assert.equal(await popup(page).locator('a[target="_blank"]').count(), 0, 'and the popup does not turn into a link to another tab')
  await page.close()
})

test('switching projects: Eko Hospital -> Marsa -> Eko Hospital shows the entry only where it belongs', async () => {
  const page = await openFor('eko'); await showRegister(page)
  assert.equal(await page.locator('tr.dgroof').count(), 1)
  await page.evaluate(cfg => { window.INJECTED_PROJECT_CONFIG = { ...cfg, roofGraphic: null }; window.EKO.set({ sub: 'reg2' }); window.EKO.set({ sub: 'reg' }) }, CONFIGS.marsa)
  await page.waitForSelector('table.dg')
  assert.equal(await page.locator('tr.dgroof').count(), 0)
  await page.evaluate(cfg => { window.INJECTED_PROJECT_CONFIG = { ...cfg, roofGraphic: { title: 'x', url: null } }; window.EKO.set({ sub: 'reg2' }); window.EKO.set({ sub: 'reg' }) }, CONFIGS.eko)
  await page.waitForSelector('table.dg')
  assert.equal(await page.locator('tr.dgroof').count(), 1)
  await page.close()
})

test('regression: the O&M / warranty popup still opens with its download and new-tab links; a foreign address is refused; Escape closes it', async () => {
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

test('regression: opening the roof graphic and then an O&M popup leaves exactly one popup', async () => {
  reset()
  const page = await openFor('eko'); await connect(page, A)
  await openGraphic(page)
  await page.evaluate(() => {
    const b = document.createElement('button'); b.dataset.act = 'docOpen'; b.dataset.title = 'Warranty'; b.dataset.url = '/api/fin/file?ref=' + encodeURIComponent('@p:ekoHospital:r:1a2b-3c4d'); b.id = 'wty'; document.body.appendChild(b); b.click()
  })
  await page.waitForSelector('#docov iframe.docframe')
  assert.equal(await page.locator('#docov').count(), 1)
  assert.equal(await page.locator('#docov iframe.roofframe').count(), 0, 'the graphic was replaced, not stacked')
  await page.close()
})
