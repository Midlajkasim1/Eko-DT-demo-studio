import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Start_Viewer_Windows.bat is written into every exported ZIP by src/lib/startViewerBat.ts (called from exportProjectAsZip). Phase 4 adds ONE optional step to
// it, between the dependency install and the server start: backend/local_ai_setup.py (Ollama and qwen3:8b). These tests check
//   - the original script is unchanged: every original line, in order, the Python check and the pip line included
//   - the new step is optional and cannot stop Eko-DT: it never exits the script, a failing, crashing or missing helper only prints a warning, and
//     EKO_SKIP_LOCAL_AI=1 skips it
//   - the export carries the helper, and config.json opts in with chat.local_ai = "auto" without touching an administrator's "off"
// On Windows the generated file is also RUN on the real cmd.exe, in a temp folder, with stub helpers (the real helper's Ollama logic is tested in
// backend/tests/test_local_ai_setup.py, against a fake Ollama).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'src')
const out = await build({
  stdin: {
    contents: "export * from '@/lib/startViewerBat'\nexport { exportedSiteConfig } from '@/lib/finSettings'\nexport { BACKEND_EXPORT_FILES } from '@/lib/backendExport'",
    resolveDir: src,
  },
  bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': src }, logLevel: 'silent',
})
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
const bat = M.startViewerWindowsBat()
const lines = bat.split('\r\n')

// the script as it was before the local AI step (exportProjectAsZip's winBat), line for line
const ORIGINAL = [
  '@echo off',
  'echo ============================================',
  'echo   EKO Digital Twin Viewer + FIN Backend',
  'echo ============================================',
  'echo.',
  'echo Checking Python...',
  'python --version >nul 2>&1 || (echo Python not found. Please install Python 3.10+ && pause && exit /b 1)',
  'echo.',
  'echo Installing backend dependencies...',
  'cd /d "%~dp0backend"',
  'pip install -r requirements.txt --quiet',
  'echo.',
  'echo Starting server on port 8000.',
  'echo   This device:    http://127.0.0.1:8000/',
  'echo   Other devices:  http://[this-machine-ip]:8000/',
  'echo.',
  'echo Sign in when the page opens. Press Ctrl+C to stop.',
  'echo.',
  'python start_viewer.py',
  'pause',
]

test('every line of the original script is still there, unchanged and in the same order', () => {
  let at = -1
  for (const original of ORIGINAL) {
    const found = lines.indexOf(original, at + 1)
    assert.ok(found > at, `missing or moved: ${original}`)
    at = found
  }
  assert.equal(lines[0], '@echo off')
  assert.equal(lines.at(-1), 'pause')
  assert.ok(bat.includes('\r\n') && !/[^\r]\n/.test(bat), 'CRLF line endings throughout')
})

test('the Python check and the dependency install are not touched and run before the local AI step', () => {
  const python = lines.indexOf('python --version >nul 2>&1 || (echo Python not found. Please install Python 3.10+ && pause && exit /b 1)')
  const pip = lines.indexOf('pip install -r requirements.txt --quiet')
  const helper = lines.findIndex(l => l.includes('local_ai_setup.py'))
  const start = lines.indexOf('python start_viewer.py')
  assert.ok(python > 0 && python < pip && pip < helper && helper < start, `order ${python} ${pip} ${helper} ${start}`)
  assert.equal(lines.filter(l => /pip install|python --version/.test(l)).length, 2, 'no second dependency or Python logic')
})

test('the local AI step is optional and never ends the script', () => {
  const begin = lines.findIndex(l => /EKO_SKIP_LOCAL_AI/.test(l))
  const end = lines.indexOf('python start_viewer.py')
  const step = lines.slice(begin, end).join('\n')
  assert.ok(begin > 0, 'the skip switch is there')
  assert.ok(!/\bexit\b/i.test(step), 'no exit in the step')
  assert.ok(!/\bpause\b/i.test(step), 'no pause in the step')
  assert.match(step, /if not exist "local_ai_setup\.py"/, 'a folder without the helper (an older export) is not an error')
  assert.match(step, /python local_ai_setup\.py/)
  assert.match(step, /if errorlevel 1 echo WARNING: .*rules-based answers only/i)
  assert.ok(!/ollama(\.exe)?\s+(pull|serve|run|list|show|create)|OllamaSetup|curl|Invoke-WebRequest|bitsadmin/i.test(step), 'no Ollama command or download in the batch file: that logic is in the helper')
})

test('loopback stays out of a configured proxy for the backend, through the helper', () => {
  assert.ok(lines.some(l => /for \/f .*local_ai_setup\.py --print-no-proxy.*set "NO_PROXY=%%A"/.test(l)), 'NO_PROXY is set from the helper')
  const set = lines.findIndex(l => /--print-no-proxy/.test(l))
  assert.ok(set > lines.indexOf('pip install -r requirements.txt --quiet') && set < lines.indexOf('python start_viewer.py'))
})

test('the helper is part of every export, and config.json opts in without overriding an administrator', () => {
  assert.ok(M.BACKEND_EXPORT_FILES.includes('local_ai_setup.py'))
  const base = { project_name: 'x', chat: { enabled: false, provider: 'rules', model: 'qwen3:4b', allowed_projects: ['a'] } }
  const cfg = M.exportedSiteConfig(base, {})
  assert.equal(cfg.chat.local_ai, 'auto')
  assert.deepEqual({ ...cfg.chat, local_ai: undefined }, { ...base.chat, local_ai: undefined }, 'the other chat settings are the repo file\'s')
  assert.equal(M.exportedSiteConfig({ ...base, chat: { ...base.chat, local_ai: 'off' } }, {}).chat.local_ai, 'off')
  assert.equal(M.exportedSiteConfig({ ...base, chat: { ...base.chat, local_ai: 'auto' } }, {}).chat.local_ai, 'auto')
  assert.deepEqual(M.exportedSiteConfig({ project_name: 'x' }, {}).chat, { local_ai: 'auto' })
  assert.equal(base.chat.local_ai, undefined, 'the input is not modified')
})

// ── the real thing: the generated file on cmd.exe ────────────────────────────

const windows = process.platform === 'win32'
const HELPER = fs.readFileSync(path.join(root, 'backend', 'local_ai_setup.py'), 'utf8')
const OVERLAY = fs.readFileSync(path.join(root, 'backend', 'config_overlay.py'), 'utf8')

function stub(rc, extra = '') {
  return `import os, sys\nif '--print-no-proxy' in sys.argv:\n    sys.exit(0)\nopen(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'helper-ran.txt'), 'w').write('ran')\n` +
    `print('[stub] local ai step')\n${extra}\nsys.exit(${rc})\n`
}

/** A folder like an unzipped export: the batch file, backend/requirements.txt (empty: pip has nothing to fetch), a start_viewer.py that records and returns. */
function folder({ helper, config, local, env = {}, pathOnly } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eko-bat-'))
  const backend = path.join(dir, 'backend')
  fs.mkdirSync(backend)
  fs.writeFileSync(path.join(dir, 'Start_Viewer_Windows.bat'), bat)
  fs.writeFileSync(path.join(backend, 'requirements.txt'), '')
  fs.writeFileSync(path.join(backend, 'start_viewer.py'), "import os\nopen('started.txt', 'w').write(os.environ.get('NO_PROXY', ''))\n")
  if (helper !== undefined) fs.writeFileSync(path.join(backend, 'local_ai_setup.py'), helper)
  if (helper === HELPER) fs.writeFileSync(path.join(backend, 'config_overlay.py'), OVERLAY)   // shipped beside it in every export
  if (config !== undefined) fs.writeFileSync(path.join(backend, 'config.json'), JSON.stringify(config))
  if (local !== undefined) fs.writeFileSync(path.join(backend, 'config.local.json'), local)
  const childEnv = { ...process.env, EKO_LOCAL_AI_LOG_DIR: path.join(dir, 'logs'), EKO_SKIP_LOCAL_AI: '', NO_PROXY: '', HTTP_PROXY: '', HTTPS_PROXY: '', ...env }   // (not LOCALAPPDATA: the Store python alias is very slow without it)

  if (pathOnly) childEnv.PATH = pathOnly
  const run = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${path.join(dir, 'Start_Viewer_Windows.bat')}"`],
    { cwd: dir, env: childEnv, input: '', encoding: 'utf8', windowsVerbatimArguments: true, timeout: 180000 })
  const read = f => (fs.existsSync(path.join(backend, f)) ? fs.readFileSync(path.join(backend, f), 'utf8') : null)
  return { dir, out: `${run.stdout}${run.stderr}`, code: run.status, helperRan: read('helper-ran.txt') !== null, started: read('started.txt') }
}

test('a helper that succeeds: its messages are shown, no warning, and Eko-DT starts', { skip: !windows }, () => {
  const r = folder({ helper: stub(0) })
  assert.match(r.out, /\[stub\] local ai step/)
  assert.ok(!/WARNING/.test(r.out), r.out)
  assert.ok(r.helperRan && r.started !== null, r.out)
})

test('a helper that reports a problem only warns: Eko-DT still starts', { skip: !windows }, () => {
  const r = folder({ helper: stub(1) })
  assert.match(r.out, /WARNING: the local AI assistant is not ready/i)
  assert.match(r.out, /rules-based answers only/i)
  assert.ok(r.started !== null, r.out)
})

test('a helper that crashes only warns: Eko-DT still starts', { skip: !windows }, () => {
  const r = folder({ helper: stub(0, "raise RuntimeError('boom')") })
  assert.match(r.out, /WARNING/)
  assert.ok(r.started !== null, r.out)
})

test('EKO_SKIP_LOCAL_AI=1 skips the step and says so', { skip: !windows }, () => {
  const r = folder({ helper: stub(0), env: { EKO_SKIP_LOCAL_AI: '1' } })
  assert.ok(!r.helperRan, 'the helper was not run')
  assert.match(r.out, /skipped/i)
  assert.ok(r.started !== null, r.out)
})

test('an export without the helper (an older one) starts as it always did', { skip: !windows }, () => {
  const r = folder({})
  assert.ok(!/WARNING|not recognized|cannot find/i.test(r.out), r.out)
  assert.ok(r.started !== null, r.out)
})

test('without Python the original message appears and nothing else runs', { skip: !windows }, () => {
  const r = folder({ helper: stub(0), pathOnly: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') })
  assert.match(r.out, /Python not found\. Please install Python 3\.10\+/)
  assert.equal(r.code, 1)
  assert.ok(!r.helperRan && r.started === null)
})

test('with a proxy configured, loopback is added to NO_PROXY for the backend and the existing entries are kept', { skip: !windows }, () => {
  const r = folder({ helper: HELPER, env: { HTTPS_PROXY: 'http://proxy.corp:8080', NO_PROXY: 'corp.local' } })
  assert.equal(r.started, 'corp.local,127.0.0.1,localhost', r.out)
})

test('without a proxy NO_PROXY is left as it was', { skip: !windows }, () => {
  assert.equal(folder({ helper: HELPER }).started, '')
  assert.equal(folder({ helper: HELPER, env: { NO_PROXY: 'corp.local' } }).started, 'corp.local')
})

test('the real helper with chat.local_ai off installs nothing, downloads nothing and starts Eko-DT', { skip: !windows }, () => {
  const r = folder({ helper: HELPER, config: { chat: { enabled: false, provider: 'rules', local_ai: 'off' } } })
  assert.match(r.out, /Local AI setup skipped: chat\.local_ai is off/)
  assert.ok(!/WARNING/.test(r.out), r.out)
  assert.ok(r.started !== null)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.dir, 'backend', 'config.json'), 'utf8')), { chat: { enabled: false, provider: 'rules', local_ai: 'off' } })
})

// ── updates: the operator's file is never part of an export, and an update leaves it alone ──────────────────────────────────

test('no part of an export can write config.local.json: not the file list, not the zip code, not the batch file', () => {
  assert.ok(M.BACKEND_EXPORT_FILES.includes('config_overlay.py'), 'the overlay the backend needs is exported')
  assert.ok(!M.BACKEND_EXPORT_FILES.some(f => /config\.local/.test(f)))
  const source = fs.readFileSync(path.join(src, 'lib', 'projectDb.ts'), 'utf8')
  const writes = [...source.matchAll(/zip\.(?:file|folder)\(([^)]*)\)/g)].map(m => m[1])
  assert.ok(writes.length > 5, 'the export\'s writes were found')
  assert.ok(!writes.some(w => /config\.local/.test(w)), 'projectDb.ts never adds config.local.json to the zip')
  assert.ok(!/config\.local/.test(bat), 'the batch file never writes, copies or deletes it')
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.match(gitignore, /backend\/config\.local\.json/, 'and a developer\'s own copy is never committed')
})

test('an update over an installation: config.json is replaced, config.local.json (administrator off) is untouched and Eko-DT starts', { skip: !windows }, () => {
  const local = JSON.stringify({ chat: { local_ai: 'off' } })
  const r = folder({ helper: HELPER, config: { chat: { enabled: false, provider: 'rules', local_ai: 'auto' } }, local })
  assert.match(r.out, /Local AI setup skipped: chat\.local_ai is off/)
  assert.ok(!/WARNING/.test(r.out), r.out)
  assert.ok(r.started !== null)
  assert.equal(fs.readFileSync(path.join(r.dir, 'backend', 'config.local.json'), 'utf8'), local)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.dir, 'backend', 'config.json'), 'utf8')), { chat: { enabled: false, provider: 'rules', local_ai: 'auto' } })
})

test('a config.local.json that cannot be read is reported and Eko-DT still starts', { skip: !windows }, () => {
  const r = folder({ helper: HELPER, config: { chat: { local_ai: 'auto' } }, local: '{ oops' })
  assert.match(r.out, /config\.local\.json could not be read/)
  assert.match(r.out, /WARNING: the local AI assistant is not ready/i)
  assert.ok(r.started !== null)
  assert.equal(fs.readFileSync(path.join(r.dir, 'backend', 'config.local.json'), 'utf8'), '{ oops')
})
