// The FAKE FIN backend for browser tests, started only when it is provably the one backend the app under
// test can reach. A browser test signs in with made-up credentials and rewrites the session's project
// settings; run against a developer's real backend (usually on :8000, behind `npm run dev`) that would
// replace the real FIN session. So, before anything signs in, this:
//   1. refuses a port that anything already listens on (TCP, not just HTTP),
//   2. starts the fake with a random marker, and
//   3. asks the APP (through its own dev-server /api proxy) for that marker: if the app's proxy points
//      anywhere else, the marker never comes back and the test stops without a single sign-in.
// The port is explicit: FAKE_PORT, else 8010 (never the real backend's 8000). The app must be started
// with the matching proxy: `FAKE_PORT=8010 npm run dev:test` (Vite on :5175), then APP_URL=http://127.0.0.1:5175.
import net from 'node:net'
import crypto from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'

export const FAKE_PORT = Number(process.env.FAKE_PORT || 8010)
export const FAKE_APP_URL = 'http://127.0.0.1:5175'
const MARKER = '/api/fin/__fake_backend__'   // a read-only GET; the real backend answers 404

const sleep = ms => new Promise(r => setTimeout(r, ms))
const listening = port => new Promise(resolve => {
  const s = net.connect({ port, host: '127.0.0.1' })
  s.setTimeout(1500)
  s.once('connect', () => { s.destroy(); resolve(true) })
  s.once('timeout', () => { s.destroy(); resolve(false) })
  s.once('error', () => resolve(false))
})
const markerAt = async base => {
  try {
    const r = await fetch(base + MARKER)
    return r.ok ? (await r.json()).nonce ?? null : null
  } catch { return null }
}

/** @param {{ root: string, appUrl: string, env?: Record<string,string> }} o
 *  @returns {Promise<{ api: string, port: number, stop: () => void }>} */
export async function startFakeBackend({ root, appUrl, env = {} }) {
  const port = FAKE_PORT
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`FAKE_PORT must be a port from 1024 to 65535, got ${process.env.FAKE_PORT}`)
  if (await listening(port)) {
    throw new Error(`port ${port} is already in use: the fake backend will not start on top of it (it could be a real backend). Stop that process or pick another FAKE_PORT.`)
  }
  const nonce = crypto.randomUUID()
  const python = process.env.PYTHON || path.join(root, 'backend', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  const child = spawn(python, ['tests/fake_fin_server.py', '--port', String(port)], {
    cwd: path.join(root, 'backend'), stdio: 'ignore', env: { ...process.env, EKO_FAKE_NONCE: nonce, ...env },
  })
  let exited = null
  child.once('exit', code => { exited = code })
  const stop = () => { try { child.kill() } catch { /* already gone */ } }
  process.once('exit', stop)
  const base = `http://127.0.0.1:${port}`
  try {
    for (let i = 0; (await markerAt(base)) !== nonce; i++) {
      if (exited !== null) throw new Error(`the fake backend exited (code ${exited}) before it answered on :${port}`)
      if (i > 80) throw new Error(`the fake backend did not answer on :${port}`)
      await sleep(250)
    }
    if ((await markerAt(appUrl)) !== nonce) {
      throw new Error(`the app at ${appUrl} does not reach the fake backend on :${port}: its /api proxy points somewhere else (a real backend on :8000?). `
        + `Nothing was signed in to. Start the app with: FAKE_PORT=${port} npm run dev:test  and use APP_URL=${FAKE_APP_URL}`)
    }
  } catch (e) {
    stop()
    throw e
  }
  return { api: base, port, stop }
}
