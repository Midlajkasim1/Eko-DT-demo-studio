import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// The Eko Hospital roof graphic is the CLIENT'S OWN FIN SCREEN, shown in an iframe inside the existing popup (the native SVG schematic
// was removed at the client's request). Only the FIN server in front of its route changes (the address changes regularly), so the
// server is taken from the FIN connection when the graphic is opened and never written down. These tests run the real URL and entry
// code (src/lib/hospitalHvac.ts) with no browser and no FIN. The addresses below are made-up TEST INPUTS, except where the client's
// own reference address is used as an input to prove the URL is the client's exact one.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const src = path.join(root, 'src')
const out = await build({
  stdin: { contents: "export * from '@/lib/hospitalHvac'", resolveDir: src, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': src }, logLevel: 'silent',
})
const { HOSPITAL_ROOF_FIN_ROUTE: ROUTE, finServerOrigin, hospitalRoofUrl, hospitalRoofGraphic, hospitalHvacEnabled } =
  await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

// The client's reference iframe src, character for character
const CLIENT_SRC = 'https://10.207.200.85/fin5/ekoHospital?projectRef=@p:ekoHospital:r:326dc5ee-27ca9b5a#targetRef=@p:ekoHospital:r:3260abd5-07a0a7b6'
const CLIENT_ROUTE = '/fin5/ekoHospital?projectRef=@p:ekoHospital:r:326dc5ee-27ca9b5a#targetRef=@p:ekoHospital:r:3260abd5-07a0a7b6'

test('the route is the client\'s exact one: path, query and hash, with nothing rewritten or re-encoded', () => {
  assert.equal(ROUTE, CLIENT_ROUTE)
  const u = new URL('https://fin.example' + ROUTE)
  assert.equal(u.pathname, '/fin5/ekoHospital')
  assert.equal(u.search, '?projectRef=@p:ekoHospital:r:326dc5ee-27ca9b5a')
  assert.equal(u.hash, '#targetRef=@p:ekoHospital:r:3260abd5-07a0a7b6')
})

test('given the client\'s own server, the URL is the client\'s reference src, character for character', () => {
  assert.equal(hospitalRoofUrl('https://10.207.200.85'), CLIENT_SRC)
})

test('the URL is the connected server\'s origin plus the route, whatever the address', () => {
  for (const server of ['https://192.0.2.10', 'https://198.51.100.7', 'http://hospital-fin.local', 'https://fin.example']) {
    assert.equal(hospitalRoofUrl(server), server + CLIENT_ROUTE, server)
  }
})

test('protocol and port as configured are kept; a path, credentials, query or trailing slash on the server address are not', () => {
  assert.equal(hospitalRoofUrl('https://192.0.2.10:8443'), 'https://192.0.2.10:8443' + CLIENT_ROUTE)
  assert.equal(hospitalRoofUrl('http://192.0.2.10:8080/'), 'http://192.0.2.10:8080' + CLIENT_ROUTE)
  assert.equal(hospitalRoofUrl('  https://192.0.2.10/finMobile/other?x=1#y  '), 'https://192.0.2.10' + CLIENT_ROUTE)
  assert.equal(hospitalRoofUrl('https://user:secret@192.0.2.10'), 'https://192.0.2.10' + CLIENT_ROUTE, 'credentials in the address never reach the frame URL')
  assert.equal(finServerOrigin('https://192.0.2.10:443'), 'https://192.0.2.10', 'a default port is not repeated')
})

test('a missing or unusable server address gives no URL: nothing is guessed or defaulted', () => {
  for (const v of [undefined, null, '', '   ', 'not a url', '192.0.2.10', 'ftp://192.0.2.10', 'javascript:alert(1)', 'file:///etc/passwd', 1, {}, []]) {
    assert.equal(hospitalRoofUrl(v), null, JSON.stringify(v))
    assert.equal(finServerOrigin(v), null, JSON.stringify(v))
  }
  assert.equal(finServerOrigin(ROUTE), null, 'the route alone is not an address')
})

const eko = { projectId: 'p-eko', name: 'Eko Hospital', apiSettings: { finProjectName: 'ekoHospital' } }
const marsa = { projectId: 'p-marsa', name: 'Marsa Al Arab', apiSettings: { finProjectName: 'marsaAlArab', dashboardDemo: true } }
const other = { projectId: 'p-other', name: 'ANC09 Tower', apiSettings: { finProjectName: 'anc09' } }

test('the graphic exists for Eko Hospital only; Marsa, other projects and a project with no FIN project have none', () => {
  const g = hospitalRoofGraphic(eko, () => 'https://192.0.2.10')
  assert.equal(g.title, 'Hospital Roof Graphic')
  assert.equal(hospitalHvacEnabled(eko), true)
  for (const p of [marsa, other, { projectId: 'x', name: 'Eko Hospital' }, { projectId: 'x', name: 'x', apiSettings: {} }, undefined, null]) {
    assert.equal(hospitalRoofGraphic(p, () => 'https://192.0.2.10'), null, p?.name ?? String(p))
  }
})

test('the URL follows the FIN connection at the moment it is read: a new address after a reconnect is used, the old one is gone', () => {
  let server = 'https://192.0.2.10'
  const g = hospitalRoofGraphic(eko, () => server)
  assert.equal(g.url, 'https://192.0.2.10' + CLIENT_ROUTE)
  server = 'https://198.51.100.7:8443'   // FIN came back on another address and the user connected again
  assert.equal(g.url, 'https://198.51.100.7:8443' + CLIENT_ROUTE)
  assert.ok(!g.url.includes('192.0.2.10'), 'no trace of the old address')
  server = null   // signed out: there is no address
  assert.equal(g.url, null)
  server = 'garbage'
  assert.equal(g.url, null)
})

test('listing the graphic reads no server address; it is only read when the URL is', () => {
  let reads = 0
  const g = hospitalRoofGraphic(eko, () => { reads++; return 'https://192.0.2.10' })
  assert.equal(reads, 0)
  void g.url
  assert.equal(reads, 1)
})

test('no FIN address is written anywhere in the source: the server always comes from the connection', () => {
  const ip = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/
  for (const f of ['src/lib/hospitalHvac.ts', 'src/components/viewer/DashboardOverlay.tsx', 'static/dashboard/js/app.js', 'static/dashboard/js/layouts/grids.js']) {
    const text = read(f).replace(/127\.0\.0\.1/g, '')
    assert.ok(!ip.test(text), `${f} holds no IP address`)
  }
  const overlay = read('src/components/viewer/DashboardOverlay.tsx')
  assert.ok(/hospitalRoofGraphic\(currentProject, \(\) =>/.test(overlay), 'the Studio hands the dashboard a getter, not an address')
  assert.ok(/fin\.isConnected && fin\.status\?\.connected \? fin\.status\.server_url : null/.test(overlay), 'the address is the connected FIN server\'s, or none')
  assert.ok(!/finBaseUrl[\s\S]{0,40}roofGraphic|roofGraphic[\s\S]{0,80}finBaseUrl/.test(overlay), 'not the saved base URL, which can be stale')
})

test('the popup is an iframe in the existing frame: no new tab, no sign-in, no proxy, no stored credentials', () => {
  const app = read('static/dashboard/js/app.js')
  const fn = app.slice(app.indexOf('function openRoofFrame'), app.indexOf('const ACTS = {'))
  assert.ok(fn.includes('class="roofframe"') && fn.includes("ov.id = 'docov'"), 'an iframe in the #docov popup')
  assert.ok(!/target="_blank"|window\.open|location\.(href|assign)/.test(fn), 'the user is never sent to another tab')
  assert.ok(!/fetch\s*\(|XMLHttpRequest|Authorization|authToken|cookie|localStorage|sessionStorage|\/api\//i.test(fn.replace(/\/\*[\s\S]*?\*\//g, '')), 'no request, sign-in, token or storage')
  assert.ok(!/sandbox|referrerpolicy/i.test(fn), 'FIN gets the frame as the client wrote it')
  assert.ok(/roofOpen\(\)\s*\{.*roofGraphic/.test(app), 'the Schematic button opens the graphic the Studio listed')
})

test('the frame is 100% wide and 850px tall as the starting size, and shrinks or grows with the popup', () => {
  const css = read('static/dashboard/css/components.css')
  const rule = css.match(/\.roofframe \{([^}]*)\}/)[1]
  assert.ok(/width:100%/.test(rule) && /height:850px/.test(rule) && /border:0/.test(rule))
  assert.ok(/flex:1 1 850px/.test(rule) && /min-height:0/.test(rule), 'the 850px is the starting size inside a flexible popup')
})

test('the native Hospital roof schematic is gone: no module, no styles, no animations, no mapping, no details panel', () => {
  assert.ok(!fs.existsSync(path.join(root, 'static/dashboard/js/layouts/hospital-roof.js')))
  const tpl = read('templates/index.html')
  assert.ok(!/hospital-roof/.test(tpl))
  const css = read('static/dashboard/css/components.css')
  assert.ok(!/\.rf-|\.rd-|roofdet|roofsvg|rfwrap|@keyframes rf-/.test(css), 'no native schematic styles or animations')
  const app = read('static/dashboard/js/app.js')
  assert.ok(!/EKO_ROOF|roofAsset/.test(app))
  for (const f of ['static/dashboard/js/i18n/en.js', 'static/dashboard/js/i18n/ar.js']) {
    const keys = [...read(f).matchAll(/"(roof\w+)"/g)].map(m => m[1]).sort()
    assert.deepEqual(keys, ['roofBtn', 'roofKind', 'roofLoading', 'roofNoFin', 'roofNoFinWhy', 'roofTitle'], f + ': only the keys the iframe popup uses')
  }
})

test('the old iframe tests and scripts are gone, the O&M / warranty popup is untouched, and the scripts name these test files', () => {
  assert.ok(!fs.existsSync(path.join(root, 'spec/hospitalGraphics.test.mjs')) && !fs.existsSync(path.join(root, 'spec/hospitalGraphics.browser.test.mjs')))
  const app = read('static/dashboard/js/app.js')
  assert.ok(/docOpen\(el\)/.test(app) && /function openFramePopup/.test(app) && /\/api\/fin\/file/.test(app), 'O&M / warranty: docOpen and its popup helper')
  const pkg = JSON.parse(read('package.json'))
  assert.ok(pkg.scripts['test:hospital-hvac'].includes('spec/hospitalRoof.test.mjs'))
  assert.ok(pkg.scripts['test:hospital-hvac:browser'].includes('spec/hospitalRoof.browser.test.mjs'))
})
