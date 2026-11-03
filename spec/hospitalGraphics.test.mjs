import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// The Eko Hospital roof HVAC graphic is FIN's own screen, shown in a popup frame. Only the FIN server in front of it changes, so
// its address is taken from the connected FIN server when the graphic is opened and never written down. These tests run the real
// URL and entry code (src/lib/hospitalHvac.ts), no browser and no FIN. The addresses below are made-up TEST INPUTS.

const src = fileURLToPath(new URL('../src', import.meta.url))
const out = await build({
  stdin: { contents: "export * from '@/lib/hospitalHvac'\nexport { dashboardProjectInfo } from '@/lib/finSettings'", resolveDir: src, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': src }, logLevel: 'silent',
})
const { HOSPITAL_ROOF_GRAPHIC_PATH: PATH, finServerOrigin, hospitalGraphicUrl, hospitalGraphics, dashboardProjectInfo } =
  await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

// The path exactly as the client gave it
const STABLE = '/finMobile/ekoHospital#frame?app=graphics&targetRef=@p:ekoHospital:r:3260abd5-07a0a7b6&url=%2Ffin5%2FekoHospital%3FprojectRef%3D%40p%3AekoHospital%3Ar%3A326dc5ee-27ca9b5a%26title%3DshowSettings%23targetRef%3D%40p%3AekoHospital%3Ar%3A3260abd5-07a0a7b6'

test('the stable path is kept exactly: path, query and hash fragment', () => {
  assert.equal(PATH, STABLE)
  const u = new URL('https://fin.example' + PATH)
  assert.equal(u.pathname, '/finMobile/ekoHospital')
  assert.equal(u.search, '')
  assert.equal(u.hash, STABLE.slice(STABLE.indexOf('#')))
})

test('the URL is the connected server\'s origin plus the stable path, whatever the address', () => {
  for (const server of ['https://192.0.2.10', 'https://198.51.100.7', 'http://hospital-fin.local', 'https://fin.example']) {
    assert.equal(hospitalGraphicUrl(server), server + STABLE, server)
  }
})

test('protocol and port as configured are kept; a path, credentials, query or trailing slash on the server address are not', () => {
  assert.equal(hospitalGraphicUrl('https://192.0.2.10:8443'), 'https://192.0.2.10:8443' + STABLE)
  assert.equal(hospitalGraphicUrl('http://192.0.2.10:8080/'), 'http://192.0.2.10:8080' + STABLE)
  assert.equal(hospitalGraphicUrl('  https://192.0.2.10/finMobile/other?x=1#y  '), 'https://192.0.2.10' + STABLE)
  assert.equal(hospitalGraphicUrl('https://user:secret@192.0.2.10'), 'https://192.0.2.10' + STABLE, 'credentials in the address never reach the frame URL')
  assert.equal(finServerOrigin('https://192.0.2.10:443'), 'https://192.0.2.10', 'a default port is not repeated')
})

test('a missing or unusable server address gives no URL: nothing is guessed or defaulted', () => {
  for (const v of [undefined, null, '', '   ', 'not a url', '192.0.2.10', 'ftp://192.0.2.10', 'javascript:alert(1)', 'file:///etc/passwd', 1, {}, []]) {
    assert.equal(hospitalGraphicUrl(v), null, JSON.stringify(v))
    assert.equal(finServerOrigin(v), null, JSON.stringify(v))
  }
})

test('the module holds no FIN address of its own', async () => {
  assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(out.outputFiles[0].text.match(/HOSPITAL_ROOF_GRAPHIC_PATH[\s\S]*?\n/)[0]))
  assert.equal(finServerOrigin(PATH), null, 'the path alone is not an address')
})

const eko = { projectId: 'p-eko', name: 'Eko Hospital', apiSettings: { finProjectName: 'ekoHospital' } }
const marsa = { projectId: 'p-marsa', name: 'Marsa Al Arab', apiSettings: { finProjectName: 'marsaAlArab', dashboardDemo: true } }
const other = { projectId: 'p-other', name: 'ANC09 Tower', apiSettings: { finProjectName: 'anc09' } }

test('the entry is listed for Eko Hospital only; Marsa, other projects and a project with no FIN project have none', () => {
  const g = hospitalGraphics(eko, () => 'https://192.0.2.10')
  assert.equal(g.length, 1)
  assert.equal(g[0].title, 'Hospital Roof – HVAC Graphics')
  assert.equal(g[0].id, 'hospital-roof-hvac')
  for (const p of [marsa, other, { projectId: 'x', name: 'Eko Hospital' }, { projectId: 'x', name: 'x', apiSettings: {} }, undefined, null]) {
    assert.deepEqual(hospitalGraphics(p, () => 'https://192.0.2.10'), [], p?.name ?? String(p))
  }
})

test('the URL follows the FIN connection at the moment it is read: a new address after a reconnect is used, the old one is gone', () => {
  let server = 'https://192.0.2.10'
  const [entry] = hospitalGraphics(eko, () => server)
  assert.equal(entry.url, 'https://192.0.2.10' + STABLE)
  server = 'https://198.51.100.7:8443'   // FIN came back on another address and the user connected again
  assert.equal(entry.url, 'https://198.51.100.7:8443' + STABLE)
  assert.ok(!entry.url.includes('192.0.2.10'), 'no trace of the old address')
  server = null   // signed out
  assert.equal(entry.url, null)
  server = 'garbage'
  assert.equal(entry.url, null)
})

test('listing the entry reads no server address; it is only read when the URL is', () => {
  let reads = 0
  const g = hospitalGraphics(eko, () => { reads++; return 'https://192.0.2.10' })
  assert.equal(reads, 0)
  void g[0].url
  assert.equal(reads, 1)
})

test('what the dashboard is told by dashboardProjectInfo is unchanged: no address in it', () => {
  const info = dashboardProjectInfo({ ...eko, apiSettings: { ...eko.apiSettings, finBaseUrl: 'https://192.0.2.10' } })
  assert.ok(!('graphics' in info))
  assert.ok(!JSON.stringify(info).includes('192.0.2.10'))
})
