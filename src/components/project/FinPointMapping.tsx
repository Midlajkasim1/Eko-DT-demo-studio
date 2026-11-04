import { useMemo, useState } from 'react'
import type { FinResource } from '@/lib/finProjects'
import { newRowId, parseImport, type JsonObject } from '@/lib/mappingRows'
import type { ItemResult } from '@/lib/mappingValidation'
import { StatusBadge, type EditorState } from '@/components/project/FinMappingEditors'
import {
  GROUP_MARSA,
  GROUP_UNUSED,
  HISTORY_GROUPS,
  LIVE_GROUPS,
  catalogEntry,
  catalogFor,
  historyExpression,
  isStandardHistory,
  normalizeRef,
  pointRefOf,
  pointTitle,
  pointViews,
  rankPoints,
  type CatalogEntry,
  type MappingBlock,
  type PointView,
} from '@/lib/finMappingCatalog'

interface Row {
  id: number
  key: string
  text: string
  /** a key the catalog does not describe, named by the user */
  own: boolean
}

interface FinPointMappingProps {
  block: MappingBlock
  value: JsonObject | undefined
  onChange: (state: EditorState) => void
  /** the points of the FIN project chosen in FIN Config */
  points?: FinResource[]
  /** Validate Mapping's result per key */
  results?: Record<string, ItemResult>
  /** the backend's keys for this block; remount when they arrive */
  suggestedKeys?: string[]
}

/** Why a chosen point does not look like this reading: a flag or text where a number is read, or another unit */
function fitProblem(entry: CatalogEntry, v: PointView): string | null {
  if (entry.kind !== 'Str' && (v.kind === 'Bool' || v.kind === 'Str')) return `This point is ${v.kind === 'Bool' ? 'an on/off flag' : 'text'}; this reading needs a number.`
  if (entry.units?.length && v.unit && !entry.units.includes(v.unit)) return `This point is in ${v.unit}; this reading is in ${entry.units.join(' or ')}.`
  return null
}

const textOf = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

function rowsFrom(block: MappingBlock, value: JsonObject | undefined, extraKeys: string[] = []): Row[] {
  const known = catalogFor(block).map(e => e.key)
  const own = [...extraKeys, ...Object.keys(value ?? {})].filter((k, i, all) => !known.includes(k) && all.indexOf(k) === i)
  return [...known, ...own].map(key => ({ id: newRowId(), key, text: value && key in value ? textOf(value[key]) : '', own: !known.includes(key) }))
}

function emitFrom(rows: Row[]): EditorState {
  const out: JsonObject = {}
  for (const r of rows) {
    if (!r.text.trim()) continue
    const key = r.key.trim()
    if (!key) return { error: 'An own key with a FIN point needs a name.' }
    if (key in out) return { error: `The key "${key}" is used twice.` }
    out[key] = r.text.trim()
  }
  return Object.keys(out).length ? { value: out } : {}
}

function Chips({ v }: { v: PointView }) {
  return (
    <span className="fpm-chips">
      {v.unit && <span className="fpm-chip">{v.unit}</span>}
      {v.kind && v.kind !== 'Number' && <span className="fpm-chip" data-kind={v.kind}>{v.kind}</span>}
      {v.his && <span className="fpm-chip" data-his="1">history</span>}
    </span>
  )
}

interface PickerProps {
  block: MappingBlock
  entry?: CatalogEntry
  views: PointView[]
  current: string
  onPick: (value: string) => void
  onClose: () => void
}

/** The point list for one key: its best matches first, then every point, searchable; or a value typed by hand */
function PointPicker({ block, entry, views, current, onPick, onClose }: PickerProps) {
  const [query, setQuery] = useState('')
  const [typed, setTyped] = useState(current)
  const currentRef = pointRefOf(current)
  const pool = block === 'history' ? views.filter(v => v.his) : views
  const best = useMemo(() => (entry ? rankPoints(entry, views, 6) : []), [entry, views])
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const found = terms.length ? pool.filter(v => terms.every(t => v.search.includes(t))) : pool
  const shown = found.slice(0, 120)
  const pick = (v: PointView) => onPick(block === 'history' ? historyExpression(v.ref) : v.ref)
  const applyTyped = () => {
    const t = typed.trim()
    if (!t) return
    const ref = normalizeRef(t)
    onPick(block === 'history' ? (t.startsWith('/') ? t : ref ? historyExpression(ref) : t) : (ref ?? t))
  }
  const option = (v: PointView) => (
    <button key={v.ref} type="button" className="fpm-opt" data-on={v.ref === currentRef} onClick={() => pick(v)}>
      <span className="fpm-pname">{pointTitle(v)}</span>
      <Chips v={v} />
      <code className="fpm-ref">{v.ref}</code>
    </button>
  )
  return (
    <div className="fpm-picker" onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <input
        autoFocus
        className="fpm-search"
        placeholder="Search equipment or point"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {!views.length && (
        <p className="fpm-note">Points not loaded. Choose the FIN project, or type a point ID.</p>
      )}
      {!terms.length && best.length > 0 && (
        <>
          <div className="fpm-lh">Best matches{entry ? ` for ${entry.label}` : ''}</div>
          <div className="fpm-list fpm-best">{best.map(option)}</div>
        </>
      )}
      {views.length > 0 && (
        <>
          <div className="fpm-lh">
            {terms.length ? `${found.length} found` : `All points${block === 'history' ? ' that keep history' : ''} (${pool.length})`}
          </div>
          <div className="fpm-list">
            {shown.map(option)}
            {found.length > shown.length && <p className="fpm-note">Showing {shown.length} of {found.length}. Type to narrow the list.</p>}
            {!found.length && <p className="fpm-note">No point matches.</p>}
          </div>
        </>
      )}
      <div className="fpm-manual">
        <input
          placeholder={block === 'history' ? 'Point ID, or a full history query starting with /api/' : 'Point ID, e.g. p:{project}:r:3263834f-25aeafd4'}
          value={typed}
          onChange={e => setTyped(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') applyTyped() }}
        />
        <button type="button" className="ds-btn ds-btn-secondary fpm-btn" disabled={!typed.trim()} onClick={applyTyped}>Use typed value</button>
        <button type="button" className="ds-btn ds-btn-secondary fpm-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

/** One row per dashboard reading and the FIN point it reads. Remount (change `key`) to load a new value. */
export function FinPointMapping({ block, value, onChange, points, results, suggestedKeys }: FinPointMappingProps) {
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(block, value, suggestedKeys))
  const [open, setOpen] = useState<number | null>(null)
  const [filter, setFilter] = useState('')
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const views = useMemo(() => pointViews(points), [points])
  const byRef = useMemo(() => new Map(views.map(v => [v.ref, v])), [views])

  const commit = (next: Row[]) => {
    setRows(next)
    onChange(emitFrom(next))
  }
  const setText = (id: number, text: string) => commit(rows.map(r => (r.id === id ? { ...r, text } : r)))

  const groups = block === 'live' ? LIVE_GROUPS : HISTORY_GROUPS
  const terms = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const visible = (r: Row) => {
    if (!terms.length) return true
    const e = catalogEntry(block, r.key)
    const v = byRef.get(pointRefOf(r.text) ?? '')
    const hay = `${r.key} ${e?.label ?? ''} ${e?.shows ?? ''} ${v ? pointTitle(v) : ''} ${r.text}`.toLowerCase()
    return terms.every(t => hay.includes(t))
  }
  const usedRows = rows.filter(r => { const e = catalogEntry(block, r.key); return !!e?.used && e.group !== GROUP_MARSA })
  const mapped = usedRows.filter(r => r.text.trim()).length

  const row = (r: Row) => {
    const entry = catalogEntry(block, r.key)
    const ref = pointRefOf(r.text)
    const view = ref ? byRef.get(ref) : undefined
    const best = !r.text.trim() && entry?.used ? rankPoints(entry, views, 1)[0] : undefined
    const result = results?.[r.key.trim()]
    const misfit = view && entry ? fitProblem(entry, view) : null
    const isOpen = open === r.id
    return (
      <div key={r.id} className="fpm-item" data-open={isOpen}>
        <div className="fpm-row">
          <div className="fpm-what">
            {r.own ? (
              <input
                className="fpm-keyin"
                aria-label="Key"
                placeholder="key name, e.g. gf_energy"
                value={r.key}
                onChange={e => commit(rows.map(x => (x.id === r.id ? { ...x, key: e.target.value } : x)))}
              />
            ) : (
              <div className="fpm-label">{entry?.label}</div>
            )}
            {entry?.shows && <div className="fpm-shows">{entry.shows}</div>}
            {!r.own && <code className="fpm-key">{r.key}</code>}
          </div>
          <div className="fpm-val">
            <button type="button" className="fpm-pick" data-empty={!r.text.trim()} onClick={() => setOpen(isOpen ? null : r.id)}>
              {view ? (
                <><span className="fpm-pname">{pointTitle(view)}</span><Chips v={view} /></>
              ) : r.text.trim() ? (
                <code className="fpm-rawval">{ref ?? r.text}</code>
              ) : (
                <span>Choose a FIN point</span>
              )}
              <span className="fpm-caret" aria-hidden="true">▾</span>
            </button>
            {r.text.trim() && (
              <div className="fpm-sub">
                {block === 'history' && !isStandardHistory(r.text) ? (
                  <span title={r.text}>Own history query: <code>{r.text}</code></span>
                ) : (
                  <code title={r.text}>{ref ?? r.text}</code>
                )}
                {!view && views.length > 0 && <span className="fpm-warn"> · not in this FIN project's point list</span>}
              </div>
            )}
            {misfit && <div className="fpm-warn fpm-misfit">{misfit}</div>}
            {result && <div className="fpm-status"><StatusBadge status={result.status} detail={result.detail} /></div>}
            {best && (
              <div className="fpm-suggest">
                Best match: <b>{pointTitle(best)}</b>{best.unit ? ` (${best.unit})` : ''}
                <button type="button" className="fpm-use" onClick={() => setText(r.id, block === 'history' ? historyExpression(best.ref) : best.ref)}>Use</button>
              </div>
            )}
          </div>
          <div className="fpm-side">
            {(r.text.trim() || r.own) && (
              <button
                type="button"
                className="fpm-x"
                title={r.own ? 'Remove this key' : 'Clear this mapping'}
                aria-label={r.own ? `Remove ${r.key || 'key'}` : `Clear ${entry?.label ?? r.key}`}
                onClick={() => (r.own ? commit(rows.filter(x => x.id !== r.id)) : setText(r.id, ''))}
              >
                ✕
              </button>
            )}
          </div>
        </div>
        {isOpen && (
          <PointPicker
            block={block}
            entry={entry}
            views={views}
            current={r.text}
            onPick={v => { setText(r.id, v); setOpen(null) }}
            onClose={() => setOpen(null)}
          />
        )}
      </div>
    )
  }

  const runPaste = () => {
    const parsed = parseImport(pasteText, 'string')
    if (parsed.error || !parsed.entries) { setNotice(parsed.error ?? 'Nothing to import.'); return }
    let next = rows.map(r => ({ ...r }))
    let n = 0
    for (const [key, v] of Object.entries(parsed.entries)) {
      const at = next.findIndex(r => r.key.trim() === key)
      if (at >= 0) next[at] = { ...next[at], text: String(v) }
      else next = [...next, { id: newRowId(), key, text: String(v), own: true }]
      n++
    }
    commit(next)
    setPasting(false)
    setPasteText('')
    setNotice(`${n} entries taken from the pasted text.`)
  }
  const copyJson = () => {
    navigator.clipboard?.writeText(JSON.stringify(emitFrom(rows).value ?? {}, null, 2)).then(
      () => setNotice('JSON copied.'),
      () => setNotice('Could not copy.'),
    )
  }

  const ownRows = rows.filter(r => !catalogEntry(block, r.key) || r.own)
  return (
    <div className="fpm" data-testid={`fpm-${block}`}>
      <div className="fpm-top">
        <span className="fpm-count">{mapped} of {usedRows.length} dashboard {block === 'live' ? 'readings' : 'charts'} mapped</span>
        <input className="fpm-filter" placeholder="Find a reading or point" value={filter} onChange={e => setFilter(e.target.value)} />
      </div>
      {groups.map(g => {
        const list = rows.filter(r => !r.own && catalogEntry(block, r.key)?.group === g && visible(r))
        if (!list.length) return null
        const folded = g === GROUP_UNUSED || g === GROUP_MARSA
        const body = list.map(row)
        if (!folded) return (
          <section key={g} className="fpm-group">
            <h4 className="fpm-gh">{g}</h4>
            {body}
          </section>
        )
        const anySet = list.some(r => r.text.trim())
        return (
          <details key={g} className="fpm-group" open={anySet || terms.length > 0}>
            <summary className="fpm-gh">{g} ({list.length})</summary>
            <p className="fpm-note">{g === GROUP_UNUSED ? 'Not on a page yet.' : 'Marsa Al Arab boards.'}</p>
            {body}
          </details>
        )
      })}
      <section className="fpm-group">
        <h4 className="fpm-gh">Your own keys</h4>
        <p className="fpm-note">Your own key. List a board under Power Boards.</p>
        {ownRows.filter(visible).map(row)}
        <button type="button" className="ds-btn ds-btn-secondary fpm-btn"
          onClick={() => { const id = newRowId(); commit([...rows, { id, key: '', text: '', own: true }]); setOpen(id) }}>
          + Add your own key
        </button>
      </section>
      <details className="fpm-group fpm-adv">
        <summary className="fpm-gh">Paste or copy as JSON</summary>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '6px 0' }}>
          <button type="button" className="ds-btn ds-btn-secondary fpm-btn" onClick={() => setPasting(v => !v)}>Paste JSON or KEY=VALUE lines</button>
          <button type="button" className="ds-btn ds-btn-secondary fpm-btn" onClick={copyJson}>Copy JSON</button>
        </div>
        {pasting && (
          <div>
            <textarea className="fpm-paste" rows={5} spellCheck={false} value={pasteText} onChange={e => setPasteText(e.target.value)}
              placeholder={'{ "peak_demand": "p:{project}:r:3263834f-25aeafd4" }\nor peak_demand=p:{project}:r:3263834f-25aeafd4'} />
            <button type="button" className="ds-btn ds-btn-primary fpm-btn" onClick={runPaste}>Take these entries</button>
          </div>
        )}
      </details>
      {notice && <p className="fpm-note">{notice}</p>}
    </div>
  )
}
