import { useMemo, useState } from 'react'
import type { FinResource } from '@/lib/finProjects'
import { newRowId } from '@/lib/mappingRows'
import { boardSuggestions, historyExpression, meterSuggestions, pointRefOf, pointTitle, pointViews, type PointView } from '@/lib/finMappingCatalog'
import { Chips, PointPicker } from '@/components/project/FinPointMapping'
import type { MeterLink } from '@/types'

interface MetersEditorProps {
  value: MeterLink[] | undefined
  /** the points of the FIN project chosen in FIN Config */
  points?: FinResource[]
  prefix: string
  onChange: (meters: MeterLink[] | undefined) => void
}

interface Row { id: number; name: string; equip: string; point: string; history: string; main: boolean }

const blank = (): Row => ({ id: newRowId(), name: '', equip: '', point: '', history: '', main: false })

const fold = (s: string) => s.trim().toLowerCase()

function metersFromRows(rows: Row[]): MeterLink[] | undefined {
  const out: MeterLink[] = []
  for (const r of rows) {
    const equip = r.equip.trim(), point = r.point.trim(), name = r.name.trim() || equip
    if (!name && !point) continue
    out.push({ name, equip, ...(point ? { point } : {}), ...(point && r.history ? { history: r.history } : {}), ...(r.main ? { main: true } : {}) })
  }
  return out.length ? out : undefined
}

/** Remount (change `key`) to load a new value. */
export function MetersEditor({ value, points, prefix, onChange }: MetersEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => (value ?? []).map(m => ({
    id: newRowId(), name: m.name ?? '', equip: m.equip ?? '', point: m.point ?? '', history: m.history ?? '', main: m.main === true,
  })))
  const [open, setOpen] = useState<number | null>(null)
  const views = useMemo(() => pointViews(points), [points])
  const byRef = useMemo(() => new Map(views.map(v => [v.ref, v])), [views])
  const equipNames = useMemo(() => [...new Set(views.map(v => v.equip).filter(Boolean))].sort(), [views])
  const found = useMemo(() => meterSuggestions(views, prefix), [views, prefix])

  const commit = (next: Row[]) => {
    setRows(next)
    onChange(metersFromRows(next))
  }
  const edit = (id: number, patch: Partial<Row>) => commit(rows.map(r => (r.id === id ? { ...r, ...patch } : r)))
  const pointPatch = (text: string): Partial<Row> => {
    const ref = pointRefOf(text) ?? text.trim()
    return { point: ref, history: ref.startsWith('p:') ? historyExpression(ref) : '' }
  }
  const fromFin = (m: { equip: string; point?: PointView }): Row =>
    ({ ...blank(), name: m.equip, equip: m.equip, ...(m.point ? pointPatch(m.point.ref) : {}) })
  const fromEnergy = (name: string, view: PointView): Row =>
    ({ ...blank(), name, equip: view.equip, ...pointPatch(view.ref) })

  const listed = new Set(rows.map(r => fold(r.equip)).filter(Boolean))
  const usedPoints = new Set(rows.map(r => pointRefOf(r.point)).filter(Boolean))
  const offered = found.filter(m => !listed.has(fold(m.equip)))
  const energy = boardSuggestions(views).filter(s => !usedPoints.has(s.view.ref))
  const names = rows.map(r => fold(r.name || r.equip)).filter(Boolean)
  const twice = new Set(names.filter((n, i) => names.indexOf(n) !== i))

  const row = (r: Row, i: number) => {
    const ref = pointRefOf(r.point)
    const view = ref ? byRef.get(ref) : undefined
    const isOpen = open === r.id
    return (
      <div key={r.id} className="fpm-item" data-open={isOpen}>
        <div className="fpm-row">
          <div className="fpm-what">
            <input className="fpm-keyin fpb-name" aria-label={`Meter ${i + 1} name`} placeholder="Name on the dashboard, e.g. PMU01"
              value={r.name} onChange={e => edit(r.id, { name: e.target.value })} />
            <input className="fpm-keyin fpb-meter" aria-label={`Meter ${i + 1} FIN equipment`} placeholder="FIN equipment, e.g. PMU01_MSB_1"
              list="fmt-equip" value={r.equip} onChange={e => edit(r.id, { equip: e.target.value })} />
            <label className="fpm-sub" style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input type="checkbox" checked={r.main} style={{ width: 'auto' }} onChange={e => edit(r.id, { main: e.target.checked })} />
              Main meter
            </label>
            {twice.has(fold(r.name || r.equip)) && <div className="fpm-warn">Another meter has this name. Give each meter its own name.</div>}
          </div>
          <div className="fpm-val">
            <button type="button" className="fpm-pick" data-empty={!r.point} onClick={() => setOpen(isOpen ? null : r.id)}>
              {view ? (
                <><span className="fpm-pname">{pointTitle(view)}</span><Chips v={view} /></>
              ) : r.point ? (
                <code className="fpm-rawval">{r.point}</code>
              ) : (
                <span>Choose its energy point</span>
              )}
              <span className="fpm-caret" aria-hidden="true">▾</span>
            </button>
            {r.point && r.history && <div className="fpm-sub">The anomaly chart reads this point's history.</div>}
            {r.point && !r.history && view && (
              <div className="fpm-warn fpm-misfit">FIN keeps no history for this point: the meter shows its live readings, with no chart.</div>
            )}
            {!r.point && <div className="fpm-sub">No energy point: live readings only.</div>}
          </div>
          <div className="fpm-side">
            <button type="button" className="fpm-x" title="Delete this meter" aria-label={`Delete meter ${i + 1}`}
              onClick={() => commit(rows.filter(x => x.id !== r.id))}>
              ✕
            </button>
          </div>
        </div>
        {isOpen && (
          <PointPicker
            block="history"
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
    <div className="fpm" data-testid="meters-editor">
      {rows.length === 0 && <p className="fpm-note">No meters yet. Add the ones FIN has below, or add an empty row and fill it in.</p>}
      {rows.map(row)}
      {!points && <p className="fpm-note">Load the FIN project's points (FIN Config) to find its meters.</p>}
      {points && !found.length && !energy.length && (
        <p className="fpm-note">No FIN equipment starts with {prefix} or has voltage, current and energy points. Add prefixes in Meter Profile (e.g. PMU, EM), or add meters by hand.</p>
      )}
      {(offered.length > 0 || energy.length > 0) && (
        <div className="fpm-suggest" data-testid="meter-suggestions">
          From FIN:
          {offered.length + energy.length > 1 && (
          <button type="button" className="fpm-use" onClick={() => commit([...rows, ...offered.map(fromFin), ...energy.map(s => fromEnergy(s.name, s.view))])}>
            + All {offered.length + energy.length}
          </button>
          )}
          {offered.map(m => (
            <button key={m.equip} type="button" className="fpm-use"
              title={`${m.byName ? 'Name matches the Meter Profile prefix' : 'Has voltage, current and energy points'}. ${m.point ? pointTitle(m.point) : 'No energy point with history.'}`}
              onClick={() => commit([...rows, fromFin(m)])}>
              + {m.equip}
            </button>
          ))}
          {energy.map(s => (
            <button key={s.view.ref} type="button" className="fpm-use" title={pointTitle(s.view)}
              onClick={() => commit([...rows, fromEnergy(s.name, s.view)])}>
              + {s.name}
            </button>
          ))}
        </div>
      )}
      <datalist id="fmt-equip">
        {equipNames.map(n => <option key={n} value={n} />)}
      </datalist>
      <div>
        <button type="button" className="ds-btn ds-btn-secondary fpm-btn"
          onClick={() => commit([...rows, blank()])}>
          + Add meter
        </button>
      </div>
    </div>
  )
}
