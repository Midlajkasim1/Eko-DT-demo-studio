import { useMemo, useState } from 'react'
import type { FinResource } from '@/lib/finProjects'
import { newRowId } from '@/lib/mappingRows'
import { powerBoardRows, powerBoardsFromRows, type PowerBoardRow } from '@/lib/finSettings'
import { boardSuggestions, historyExpression, pointRefOf, pointTitle, pointViews } from '@/lib/finMappingCatalog'
import { Chips, PointPicker } from '@/components/project/FinPointMapping'
import type { PowerBoard } from '@/types'

interface PowerBoardsEditorProps {
  value: PowerBoard[] | undefined
  /** the points of the FIN project chosen in FIN Config */
  points?: FinResource[]
  onChange: (boards: PowerBoard[] | undefined) => void
}

type Row = PowerBoardRow & { id: number }

const blank = (): Row => ({ id: newRowId(), name: '', liveKey: '', historyKey: '', meter: '', point: '', history: '' })

/** One board per row: its name and its FIN point. Remount (change `key`) to load a new value. */
export function PowerBoardsEditor({ value, points, onChange }: PowerBoardsEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => powerBoardRows(value).map(r => ({ ...r, id: newRowId() })))
  const [open, setOpen] = useState<number | null>(null)
  const views = useMemo(() => pointViews(points), [points])
  const byRef = useMemo(() => new Map(views.map(v => [v.ref, v])), [views])
  const suggestions = useMemo(() => boardSuggestions(views), [views])

  const commit = (next: Row[]) => {
    setRows(next)
    onChange(powerBoardsFromRows(next))
  }
  const edit = (id: number, patch: Partial<PowerBoardRow>) => commit(rows.map(r => (r.id === id ? { ...r, ...patch } : r)))
  const pointPatch = (text: string): Partial<PowerBoardRow> => {
    const ref = pointRefOf(text) ?? text.trim()
    return { point: ref, history: byRef.get(ref)?.his ? historyExpression(ref) : '', liveKey: '', historyKey: '' }
  }
  const used = new Set(rows.map(r => pointRefOf(r.point)).filter(Boolean))
  const names = new Set(rows.map(r => r.name.trim().toLowerCase()))
  const offered = suggestions.filter(s => !used.has(s.view.ref))
  const addSuggested = (name: string, ref: string, equip: string) => {
    const unique = names.has(name.toLowerCase()) ? `${name} (${equip})` : name
    commit([...rows, { ...blank(), name: unique, ...pointPatch(ref) }])
  }

  const row = (r: Row, i: number) => {
    const ref = pointRefOf(r.point)
    const view = ref ? byRef.get(ref) : undefined
    const isOpen = open === r.id
    return (
      <div key={r.id} className="fpm-item" data-open={isOpen}>
        <div className="fpm-row">
          <div className="fpm-what">
            <input className="fpm-keyin fpb-name" aria-label={`Board ${i + 1} name`} placeholder="Board name, e.g. HVAC"
              value={r.name} onChange={e => edit(r.id, { name: e.target.value })} />
            <input className="fpm-keyin fpb-meter" aria-label={`Board ${i + 1} meter`} placeholder="Meter (optional), e.g. PMU09"
              value={r.meter} onChange={e => edit(r.id, { meter: e.target.value })} />
          </div>
          <div className="fpm-val">
            <button type="button" className="fpm-pick" data-empty={!r.point} onClick={() => setOpen(isOpen ? null : r.id)}>
              {view ? (
                <><span className="fpm-pname">{pointTitle(view)}</span><Chips v={view} /></>
              ) : r.point ? (
                <code className="fpm-rawval">{r.point}</code>
              ) : (
                <span>Choose a FIN point</span>
              )}
              <span className="fpm-caret" aria-hidden="true">▾</span>
            </button>
            {r.point && r.history && <div className="fpm-sub">Charts read the same point's history.</div>}
            {r.point && !r.history && view && (
              <div className="fpm-warn fpm-misfit">FIN keeps no history for this point: the board shows its latest reading, with no chart.</div>
            )}
            {r.point && !view && (
              <div className="fpm-sub">
                <code>{r.point}</code>
                {views.length > 0 && <span className="fpm-warn"> · not in this FIN project's point list</span>}
              </div>
            )}
            {!r.point && r.liveKey && (
              <div className="fpm-sub">
                Reads Live readings key <code>{r.liveKey}</code>{r.historyKey && <> and Chart history key <code>{r.historyKey}</code></>}
              </div>
            )}
          </div>
          <div className="fpm-side">
            <button type="button" className="fpm-x" title="Delete this board" aria-label={`Delete board ${i + 1}`}
              onClick={() => commit(rows.filter(x => x.id !== r.id))}>
              ✕
            </button>
          </div>
        </div>
        {isOpen && (
          <PointPicker
            block="live"
            views={views}
            current={r.point}
            onPick={text => { edit(r.id, pointPatch(text)); setOpen(null) }}
            onClose={() => setOpen(null)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="fpm" data-testid="power-boards-editor">
      {rows.length === 0 && <p className="fpm-note">No boards yet. Add one from FIN below, or add an empty row and choose its point.</p>}
      {rows.map(row)}
      {offered.length > 0 && (
        <div className="fpm-suggest" data-testid="board-suggestions">
          From FIN:
          {offered.map(s => (
            <button key={s.view.ref} type="button" className="fpm-use" title={pointTitle(s.view)}
              onClick={() => addSuggested(s.name, s.view.ref, s.view.equip)}>
              + {s.name}
            </button>
          ))}
        </div>
      )}
      <div>
        <button type="button" className="ds-btn ds-btn-secondary fpm-btn"
          onClick={() => { const r = blank(); commit([...rows, r]); setOpen(r.id) }}>
          + Add board
        </button>
      </div>
    </div>
  )
}
