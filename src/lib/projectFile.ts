/** Reading a project folder's project.json and saying why it failed. Read only: nothing here creates or writes a file. */

export type ProjectFileRead<T> =
  | { meta: T }
  | { problem: 'missing' | 'invalid' | 'unreadable'; errorName: string }

const STALE_STATE = 'state cached in an interface object'

/* missing: the folder or project.json is gone (NotFoundError, TypeMismatchError);
   invalid: the file is there but is not a JSON object; unreadable: anything else (NotReadableError, SecurityError, …) */
export async function readProjectJson<T = Record<string, unknown>>(dir: FileSystemDirectoryHandle, retries = 2): Promise<ProjectFileRead<T>> {
  let text: string
  try {
    const fh = await dir.getFileHandle('project.json')
    text = await (await fh.getFile()).text()
  } catch (err) {
    const e = err as { name?: string; message?: string }
    // Chrome reports a file changed on disk since it was looked up this way; writes already retry it (projectDb.writeJson)
    if (retries > 0 && String(e?.message ?? '').includes(STALE_STATE)) {
      await new Promise(r => setTimeout(r, 250))
      return readProjectJson<T>(dir, retries - 1)
    }
    const name = e?.name || 'Error'
    return { problem: name === 'NotFoundError' || name === 'TypeMismatchError' ? 'missing' : 'unreadable', errorName: name }
  }
  try {
    const meta = JSON.parse(text)
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { problem: 'invalid', errorName: 'NotAnObject' }
    return { meta: meta as T }
  } catch (err) {
    return { problem: 'invalid', errorName: (err as { name?: string })?.name || 'SyntaxError' }
  }
}
