/** How a mapping's value is edited: a plain string, or a list shown as "a, b, c" */
export type ValueKind = 'string' | 'list'

export interface MappingRow {
  id: number
  key: string
  text: string
  /** The value as loaded. Kept while the text is untouched, so nothing is re-encoded on save. */
  original?: unknown
}

export type JsonObject = Record<string, unknown>

let nextRowId = 1
export const newRowId = () => nextRowId++

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')

/** Text shown for a value. Lists that are not plain string arrays fall back to their JSON. */
function textOf(value: unknown, kind: ValueKind): string {
  if (kind === 'string') return typeof value === 'string' ? value : JSON.stringify(value)
  return isStringArray(value) ? value.join(', ') : JSON.stringify(value)
}

export function rowsFromObject(obj: JsonObject | undefined, kind: ValueKind): MappingRow[] {
  return Object.entries(obj ?? {}).map(([key, value]) => ({
    id: newRowId(),
    key,
    text: textOf(value, kind),
    original: value,
  }))
}

function parseText(row: MappingRow, kind: ValueKind): { value?: unknown; error?: string } {
  // Untouched text keeps the exact value that was loaded
  if ('original' in row && row.text === textOf(row.original, kind)) return { value: row.original }
  if (kind === 'string') return { value: row.text }
  // A list whose source was not a plain string array is edited as JSON
  if ('original' in row && !isStringArray(row.original)) {
    try {
      return { value: JSON.parse(row.text) }
    } catch {
      return { error: `"${row.key}" must be valid JSON.` }
    }
  }
  return { value: row.text.split(',').map(s => s.trim()).filter(Boolean) }
}

export interface RowsResult {
  /** undefined when there are no rows: the setting is "not set" */
  value?: JsonObject
  error?: string
}

/** Rows back into the exact object the backend expects, or the first problem found */
export function objectFromRows(rows: MappingRow[], kind: ValueKind): RowsResult {
  const out: JsonObject = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) return { error: 'Every mapping needs a key.' }
    if (key in out) return { error: `Duplicate key "${key}".` }
    const parsed = parseText(row, kind)
    if (parsed.error) return { error: parsed.error }
    out[key] = parsed.value
  }
  return rows.length ? { value: out } : {}
}

export interface ImportResult {
  entries?: JsonObject
  error?: string
}

/** Pasted text → entries. JSON object, or one KEY=VALUE per line (list values comma separated). */
export function parseImport(text: string, kind: ValueKind): ImportResult {
  const trimmed = text.trim()
  if (!trimmed) return { error: 'Nothing to import.' }
  const entries: JsonObject = {}

  if (trimmed.startsWith('{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (e) {
      return { error: `Invalid JSON. ${e instanceof Error ? e.message : ''}`.trim() }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { error: 'Expected a JSON object.' }
    }
    for (const [key, value] of Object.entries(parsed as JsonObject)) {
      const ok = kind === 'string' ? typeof value === 'string' : isStringArray(value)
      if (!ok) {
        return { error: `The value of "${key}" must be ${kind === 'string' ? 'a string' : 'an array of strings'}.` }
      }
      entries[key] = value
    }
  } else {
    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    for (const [i, line] of lines.entries()) {
      const eq = line.indexOf('=')
      if (eq < 1) return { error: `Line ${i + 1} is not KEY=VALUE, and the text is not a JSON object.` }
      const key = line.slice(0, eq).trim()
      const raw = line.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2')
      if (key in entries) return { error: `Duplicate key "${key}" in the pasted text.` }
      entries[key] = kind === 'string' ? raw : raw.split(',').map(s => s.trim()).filter(Boolean)
    }
  }

  return Object.keys(entries).length ? { entries } : { error: 'No entries found.' }
}

/** Add imported entries; a key that already exists takes the imported value in place. */
export function mergeEntries(rows: MappingRow[], entries: JsonObject, kind: ValueKind) {
  const next = rows.map(r => ({ ...r }))
  let added = 0
  let updated = 0
  for (const [key, value] of Object.entries(entries)) {
    const at = next.findIndex(r => r.key.trim() === key)
    if (at >= 0) {
      next[at] = { ...next[at], text: textOf(value, kind), original: value }
      updated++
    } else {
      next.push({ id: newRowId(), key, text: textOf(value, kind), original: value })
      added++
    }
  }
  return { rows: next, added, updated }
}
