import { useId, useState, type ReactNode } from 'react'
import type { FinResource } from '@/lib/finProjects'
import {
  mergeEntries,
  newRowId,
  objectFromRows,
  parseImport,
  rowsFromObject,
  type JsonObject,
  type MappingRow,
  type ValueKind,
} from '@/lib/mappingRows'
import { STATUS_LABEL, type BlockResult, type ItemResult, type MappingStatus } from '@/lib/mappingValidation'

/** What an editor reports upward: the object to save (undefined = not set) or a problem */
export interface EditorState {
  value?: JsonObject
  error?: string
}

const smallBtn = { padding: '4px 12px', fontSize: '12px' } as const
const inputStyle = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '6px 10px',
  borderRadius: '6px',
  fontSize: '13px',
  fontFamily: 'monospace',
  minWidth: 0,
} as const

const STATUS_COLOR: Record<MappingStatus, string> = {
  valid: 'var(--green, #2e9d5b)',
  not_found: 'var(--red)',
  cannot_validate: '#d9a400',
  not_configured: 'var(--text-secondary)',
}

/** One mapping's validation result: ✓ Valid / ✕ Not Found / ⚠ Cannot Validate / — Not Configured */
export function StatusBadge({ status, detail }: { status: MappingStatus; detail?: string }) {
  return (
    <span
      data-status={status}
      title={detail}
      style={{ color: STATUS_COLOR[status], fontSize: '12px', whiteSpace: 'nowrap', alignSelf: 'center', minWidth: '110px' }}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

/** The keys an editor does not own, carried through to the saved value unchanged */
function withoutKeys(obj: JsonObject | undefined, keys: string[]): JsonObject {
  const rest = { ...(obj ?? {}) }
  for (const k of keys) delete rest[k]
  return rest
}

interface KeyValueEditorProps {
  value: JsonObject | undefined
  kind: ValueKind
  onChange: (state: EditorState) => void
  /** Validation result per row key, shown beside the row. Never changes the value. */
  results?: Record<string, ItemResult>
  /** Points of the selected FIN project, offered as choices for a Value field. Typing is still
   *  free: a suggestion is never applied on its own, and nothing is matched to a key by guessing. */
  suggestions?: FinResource[]
}

/** One configuration entry per row. Edits, deletes, adds and pasted imports all rebuild the
 *  same object the backend already expects. Remount (change `key`) to load a new value. */
export function KeyValueEditor({ value, kind, onChange, results, suggestions }: KeyValueEditorProps) {
  const listId = useId()
  const [rows, setRows] = useState<MappingRow[]>(() => rowsFromObject(value, kind))
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const commit = (next: MappingRow[]) => {
    setRows(next)
    onChange(objectFromRows(next, kind))
  }
  const edit = (id: number, patch: Partial<MappingRow>) =>
    commit(rows.map(r => (r.id === id ? { ...r, ...patch } : r)))

  const runImport = () => {
    const parsed = parseImport(importText, kind)
    if (parsed.error || !parsed.entries) {
      setImportError(parsed.error ?? 'Nothing to import.')
      return
    }
    const merged = mergeEntries(rows, parsed.entries, kind)
    commit(merged.rows)
    setImporting(false)
    setImportText('')
    setImportError(null)
    setNotice(`Imported ${merged.added} new, ${merged.updated} updated.`)
  }

  const copyJson = () => {
    const { value: current } = objectFromRows(rows, kind)
    navigator.clipboard?.writeText(JSON.stringify(current ?? {}, null, 2)).then(
      () => setNotice('JSON copied.'),
      () => setNotice('Could not copy.')
    )
  }

  const dupKeys = new Set(rows.map(r => r.key.trim()).filter((k, i, all) => k && all.indexOf(k) !== i))

  return (
    <div>
      {suggestions?.length ? (
        <datalist id={listId}>
          {suggestions.map(r => (
            <option key={r.id} value={r.ref}>
              {[r.name, r.equip, r.unit].filter(Boolean).join(' · ')}
            </option>
          ))}
        </datalist>
      ) : null}
      {rows.length === 0 && <p className="ds-hint" style={{ margin: '0 0 8px' }}>Not Configured. This project has no mapping here.</p>}

      {rows.map(row => (
        <div key={row.id} style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
          <input
            type="text"
            aria-label="Key"
            placeholder="key"
            value={row.key}
            onChange={e => edit(row.id, { key: e.target.value })}
            style={{ ...inputStyle, flex: '0 0 32%', borderColor: dupKeys.has(row.key.trim()) ? 'var(--red)' : undefined }}
          />
          <input
            type="text"
            aria-label="Value"
            placeholder={kind === 'list' ? 'comma, separated, values' : 'value'}
            value={row.text}
            list={suggestions?.length ? listId : undefined}
            onChange={e => edit(row.id, { text: e.target.value })}
            style={{ ...inputStyle, flex: 1 }}
          />
          {results?.[row.key.trim()] && (
            <StatusBadge status={results[row.key.trim()].status} detail={results[row.key.trim()].detail} />
          )}
          <button
            type="button"
            className="ds-btn ds-btn-secondary"
            style={smallBtn}
            title="Delete this entry"
            aria-label={`Delete ${row.key || 'entry'}`}
            onClick={() => commit(rows.filter(r => r.id !== row.id))}
          >
            ✕
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '8px', margin: '10px 0', flexWrap: 'wrap' }}>
        <button type="button" className="ds-btn ds-btn-secondary" style={smallBtn}
          onClick={() => commit([...rows, { id: newRowId(), key: '', text: '' }])}>
          + Add mapping
        </button>
        <button type="button" className="ds-btn ds-btn-secondary" style={smallBtn}
          onClick={() => { setImporting(v => !v); setImportError(null) }}>
          Import / Paste
        </button>
        <button type="button" className="ds-btn ds-btn-secondary" style={smallBtn} onClick={copyJson} disabled={!rows.length}>
          Copy JSON
        </button>
      </div>

      {importing && (
        <div style={{ marginBottom: '10px' }}>
          <textarea
            rows={6}
            spellCheck={false}
            autoFocus
            placeholder={kind === 'list'
              ? 'Paste JSON, e.g. { "system_tags": ["ahu", "fcu"] }\nor one KEY=a, b, c per line'
              : 'Paste JSON, e.g. { "total_power": "point-001" }\nor one KEY=VALUE per line'}
            value={importText}
            onChange={e => setImportText(e.target.value)}
            style={{ ...inputStyle, width: '100%' }}
          />
          {importError && <div style={{ color: 'var(--red)', fontSize: '12px', marginTop: '4px' }}>{importError}</div>}
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button type="button" className="ds-btn ds-btn-primary" style={smallBtn} onClick={runImport}>Parse &amp; Import</button>
            <button type="button" className="ds-btn ds-btn-secondary" style={smallBtn}
              onClick={() => { setImporting(false); setImportError(null) }}>Cancel</button>
          </div>
        </div>
      )}

      {notice && <div className="ds-hint" style={{ margin: 0 }}>{notice}</div>}
    </div>
  )
}

interface MeterProfileEditorProps {
  value: JsonObject | undefined
  onChange: (state: EditorState) => void
  /** "prefix" and each metric key -> validation result */
  results?: Record<string, ItemResult>
}

/** prefix + point_map. Any other key in the saved profile is carried through untouched. */
export function MeterProfileEditor({ value, onChange, results }: MeterProfileEditorProps) {
  const [prefix, setPrefix] = useState(() => (typeof value?.prefix === 'string' ? value.prefix : ''))
  const [extras] = useState<JsonObject>(() => withoutKeys(value, ['prefix', 'point_map']))
  const initialMap = value?.point_map && typeof value.point_map === 'object' && !Array.isArray(value.point_map)
    ? (value.point_map as JsonObject)
    : undefined
  const [map, setMap] = useState<EditorState>({ value: initialMap })

  const emit = (nextPrefix: string, nextMap: EditorState) => {
    const out: JsonObject = { ...extras }
    if (nextPrefix) out.prefix = nextPrefix
    if (nextMap.value) out.point_map = nextMap.value
    onChange({ value: Object.keys(out).length ? out : undefined, error: nextMap.error })
  }

  return (
    <div>
      <div className="ds-field">
        <label>Meter name prefix</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={prefix}
            placeholder="e.g. PMU"
            onChange={e => { setPrefix(e.target.value); emit(e.target.value, map) }}
          />
          {results?.prefix && <StatusBadge status={results.prefix.status} detail={results.prefix.detail} />}
        </div>
      </div>
      <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Point name aliases per metric</label>
      <KeyValueEditor
        value={initialMap}
        kind="list"
        results={results}
        onChange={state => { setMap(state); emit(prefix, state) }}
      />
    </div>
  )
}

/** order / critical / warning. Any other key in the saved block is carried through untouched. */
export function SeverityEditor({ value, onChange }: MeterProfileEditorProps) {
  const [order, setOrder] = useState(() => (typeof value?.order === 'string' ? value.order : ''))
  const [critical, setCritical] = useState(() => (value?.critical !== undefined ? String(value.critical) : ''))
  const [warning, setWarning] = useState(() => (value?.warning !== undefined ? String(value.warning) : ''))
  const [extras] = useState<JsonObject>(() => withoutKeys(value, ['order', 'critical', 'warning']))

  const emit = (o: string, c: string, w: string) => {
    const out: JsonObject = { ...extras }
    let error: string | undefined
    if (o) out.order = o
    for (const [name, text] of [['critical', c], ['warning', w]] as const) {
      if (text.trim() === '') continue
      const n = Number(text)
      if (Number.isFinite(n)) out[name] = n
      else error = `${name} must be a number.`
    }
    onChange({ value: Object.keys(out).length ? out : undefined, error })
  }

  return (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      <div className="ds-field" style={{ flex: 1, minWidth: '140px' }}>
        <label>Direction</label>
        <select value={order} onChange={e => { setOrder(e.target.value); emit(e.target.value, critical, warning) }}>
          <option value="">Not set</option>
          <option value="desc">desc — higher number is more severe</option>
          <option value="asc">asc — lower number is more severe</option>
        </select>
      </div>
      <div className="ds-field" style={{ flex: 1, minWidth: '100px' }}>
        <label>Critical</label>
        <input type="text" inputMode="numeric" value={critical}
          onChange={e => { setCritical(e.target.value); emit(order, e.target.value, warning) }} />
      </div>
      <div className="ds-field" style={{ flex: 1, minWidth: '100px' }}>
        <label>Warning</label>
        <input type="text" inputMode="numeric" value={warning}
          onChange={e => { setWarning(e.target.value); emit(order, critical, e.target.value) }} />
      </div>
    </div>
  )
}

interface Preset {
  label: string
  value: object
}

interface MappingSectionProps {
  title: string
  hint: string
  presets: Preset[]
  hasValue: boolean
  error?: string
  onLoad: (value: JsonObject | undefined) => void
  /** The latest Validate Mapping result for this block, if any */
  result?: BlockResult
  children: ReactNode
}

/** Title, description, presets and Clear around one mapping editor. Presets and Clear call
 *  onLoad; the parent remounts the editor so its rows show the new value. */
export function MappingSection({ title, hint, presets, hasValue, error, onLoad, result, children }: MappingSectionProps) {
  return (
    <div className="ds-field" style={{ marginTop: '28px' }}>
      <h3 className="ds-section-title">{title}</h3>
      <p className="ds-hint">{hint}</p>
      {/* Only the open project's own mapping is shown here. A backend default is never loaded into the editor. */}
      {!hasValue && (
        <p className="ds-hint" style={{ margin: '0 0 8px' }}>
          <StatusBadge status="not_configured" />
          {result?.backend_default && " The backend uses its own default for this block. It is not shown here and is not this project's mapping."}
        </p>
      )}
      {hasValue && result && (result.items && Object.keys(result.items).length === 0) && (
        <p className="ds-hint" style={{ margin: '0 0 8px' }}>
          <StatusBadge status={result.status} detail={result.detail} />
          {result.detail && ` ${result.detail}`}
        </p>
      )}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {presets.map(p => (
          <button key={p.label} type="button" className="ds-btn ds-btn-secondary" style={smallBtn}
            onClick={() => onLoad(JSON.parse(JSON.stringify(p.value)))}>
            {p.label}
          </button>
        ))}
        <button type="button" className="ds-btn ds-btn-secondary" style={smallBtn} disabled={!hasValue}
          title="Remove this project's setting so the backend default applies"
          onClick={() => onLoad(undefined)}>
          Clear
        </button>
      </div>
      {children}
      {error && <div style={{ color: 'var(--red)', fontSize: '12px', marginTop: '6px' }}>{error}</div>}
    </div>
  )
}
