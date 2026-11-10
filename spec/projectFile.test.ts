import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readProjectJson } from '../src/lib/projectFile.ts'

// Opening a project folder's project.json (src/lib/projectFile.ts): every way it can fail is told apart, a transient Chrome read error is retried,
// and nothing is ever created or written. The folder handles are stand-ins for the File System Access API.

const domErr = (name: string, message = name) => Object.assign(new Error(message), { name })
/* a folder handle whose project.json reads as `content` (a string) or fails with `fail` (an error, or a list used one per call) */
function folder(opts: { content?: string; fail?: Error | Error[] }) {
  const calls: { name: string; create?: boolean }[] = []
  let failures = Array.isArray(opts.fail) ? [...opts.fail] : opts.fail ? [opts.fail] : []
  const keep = !Array.isArray(opts.fail)
  return {
    calls,
    getFileHandle: async (name: string, o?: { create?: boolean }) => {
      calls.push({ name, create: o?.create })
      const f = keep ? failures[0] : failures.shift()
      if (f) throw f
      return { getFile: async () => ({ text: async () => opts.content ?? '' }) }
    },
  } as unknown as FileSystemDirectoryHandle & { calls: { name: string; create?: boolean }[] }
}

test('a readable project.json opens, with every setting as written', async () => {
  const meta = { projectId: 'eko-1', name: 'Eko Hospital', apiSettings: { finProject: 'ekoHospital' }, assetLinks: [{ equip: 'AHU_01', guid: '2wLf9$IGsICFYFjFAcUnf2', type: 'AHU' }] }
  const dir = folder({ content: JSON.stringify(meta) })
  assert.deepEqual(await readProjectJson(dir), { meta })
  assert.deepEqual(dir.calls, [{ name: 'project.json', create: undefined }], 'read only: never asked to create')
})

test('a moved, renamed or deleted folder or file is missing', async () => {
  assert.deepEqual(await readProjectJson(folder({ fail: domErr('NotFoundError') })), { problem: 'missing', errorName: 'NotFoundError' })
  assert.deepEqual(await readProjectJson(folder({ fail: domErr('TypeMismatchError') })), { problem: 'missing', errorName: 'TypeMismatchError' })
})

test('a damaged project.json is invalid, never treated as absent', async () => {
  assert.deepEqual(await readProjectJson(folder({ content: '{"projectId": "eko-1", ' })), { problem: 'invalid', errorName: 'SyntaxError' })
  assert.deepEqual(await readProjectJson(folder({ content: '' })), { problem: 'invalid', errorName: 'SyntaxError' })
  assert.deepEqual(await readProjectJson(folder({ content: '[1,2]' })), { problem: 'invalid', errorName: 'NotAnObject' })
  assert.deepEqual(await readProjectJson(folder({ content: 'null' })), { problem: 'invalid', errorName: 'NotAnObject' })
})

test('a file that cannot be read (offline drive, security) is unreadable', async () => {
  assert.deepEqual(await readProjectJson(folder({ fail: domErr('NotReadableError') })), { problem: 'unreadable', errorName: 'NotReadableError' })
  assert.deepEqual(await readProjectJson(folder({ fail: domErr('SecurityError') })), { problem: 'unreadable', errorName: 'SecurityError' })
})

test('Chrome\'s transient "state cached" error is retried, then reported', async () => {
  const stale = domErr('InvalidStateError', 'An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.')
  const ok = folder({ fail: [stale], content: '{"projectId":"eko-1"}' })
  assert.deepEqual(await readProjectJson(ok), { meta: { projectId: 'eko-1' } })
  assert.equal(ok.calls.length, 2)
  const never = folder({ fail: stale })
  assert.deepEqual(await readProjectJson(never), { problem: 'unreadable', errorName: 'InvalidStateError' })
  assert.equal(never.calls.length, 3, 'two retries, then the real error')
})

test('the open flow never writes project.json while reading it', async () => {
  const fs = await import('node:fs')
  const store = fs.readFileSync(new URL('../src/store/useProjectStore.ts', import.meta.url), 'utf8')
  const open = store.slice(store.indexOf('openRecentProject: async'), store.indexOf('closeProject:', store.indexOf('openRecentProject: async')))
  assert.doesNotMatch(open, /saveProjectMeta|writeJson|create: true/)
  assert.doesNotMatch(open, /console\.warn\([^)]*meta/, 'never logs project content')
  assert.match(open, /loadProjectDetailed/)
})
