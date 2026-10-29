import { memo, useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import { useModelStore } from '@/store/useModelStore'
import { classifyModel } from '@/lib/layerGroups'
import { setHidden, type VisibilityModel } from '@/lib/visibilityCoordinator'
import {
  buildModelTree, categoryLabel, checkStateOf, disciplineKey, hiddenItems, loadElementNames, mergeByDiscipline,
  partsOfCategories, setCategoriesVisible, setElementVisible, setPartsVisible, tallyParts,
  type CategoryGroup, type CheckState, type DisciplineSource, type MergedCategory, type MergedStorey,
  type ModelTreeData, type Part, type TreeSourceModel,
} from '@/lib/modelTree'

/*
 * The dashboard's Tree Viewer. It takes the Executive Summary panel's place
 * (#ovp) while the toolbar's Tree tool is on. The dashboard rebuilds its markup
 * on every state change, so this renders into a host element that lives outside
 * that markup; app.js moves the host into `#eko-tree-slot` after each render.
 *
 * The top level is the disciplines of the loaded models. Models of one discipline share its
 * storeys and classes; each element row still knows its own model.
 */

const PAGE = 50
const DISCIPLINE_KEY: Record<string, string> = {
  arch: 'layArch', elec: 'layElec', int: 'layInt', mech: 'layMech', str: 'layStr', site: 'laySite', land: 'layLand',
}

type FragModel = TreeSourceModel & VisibilityModel & object
type Entry =
  | { status: 'loading'; model: FragModel }
  | { status: 'error'; model: FragModel }
  | { status: 'ready'; model: FragModel; data: ModelTreeData }

type RowKind = 'discipline' | 'storey' | 'category' | 'element' | 'more' | 'status'

/** An element, with the model group that holds it */
interface Item extends Part {
  id: number
}

interface Row {
  key: string
  kind: RowKind
  level: number
  label: string
  badge?: string
  count?: number
  check?: CheckState
  expandable: boolean
  expanded: boolean
  dim: boolean
  /** Changes whenever what the row shows changes; rows with the same sig are not re-rendered */
  sig: string
  /** What the row's checkbox covers: one group per model holding something below it */
  parts?: Part[]
  /** For an element: its model, the group holding it and its IFC class */
  modelId?: string
  group?: CategoryGroup
  className?: string | null
  elementId?: number
  /** For "more": the category whose list grows */
  pageKey?: string
  retry?: boolean
}

/** Everything that changes without React knowing: tree data, element names, what was asked for */
interface Store {
  entries: Map<string, Entry>
  names: Map<string, Map<number, string>>
  asked: Set<string>
  /** The selected element's row key, for clearing the highlight when its model goes */
  selected: string | null
}

/* One dashboard, one tree. Module scope keeps this out of React's render accounting; entries are keyed by
   model object, so anything left from an earlier overlay is simply rebuilt. */
const store: Store = { entries: new Map(), names: new Map(), asked: new Set(), selected: null }

const resetStore = () => {
  store.entries.clear()
  store.names.clear()
  store.asked.clear()
  store.selected = null
}

const win = () => window as unknown as {
  EKO?: { lang?: string; state: { treeOpen?: boolean; dock?: { level?: string; layer?: string | string[] } }; t: (key: string, vars?: Record<string, unknown>) => string; set?: (patch: object) => void }
  EKO_C?: { icon: (name: string, size?: number) => string }
  EKO_TREE_HOST?: HTMLElement
}
const tr = (key: string, vars?: Record<string, unknown>) => win().EKO?.t(key, vars) ?? key

function treeHost(): HTMLElement {
  const w = win()
  if (!w.EKO_TREE_HOST) {
    const el = document.createElement('div')
    el.id = 'eko-tree-host'
    el.className = 'mthost'
    w.EKO_TREE_HOST = el
  }
  return w.EKO_TREE_HOST
}

const Glyph = memo(function Glyph({ name, size = 14 }: { name: string; size?: number }) {
  const html = win().EKO_C?.icon?.(name, size) ?? ''
  return <span className="mtic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
})

const Check = memo(function Check({ state, label, onChange }: { state: CheckState; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'mixed' }, [state])
  return (
    <input
      ref={ref}
      className="mtcheck"
      type="checkbox"
      checked={state === 'checked'}
      aria-label={label}
      tabIndex={-1}
      onClick={e => e.stopPropagation()}
      onChange={onChange}
    />
  )
})

interface RowViewProps {
  row: Row
  focused: boolean
  selected: boolean
  onToggleOpen: (key: string) => void
  onToggleCheck: (row: Row) => void
  onActivate: (row: Row) => void
  onFocusRow: (key: string) => void
}

const RowView = memo(function RowView({ row, focused, selected, onToggleOpen, onToggleCheck, onActivate, onFocusRow }: RowViewProps) {
  const indent = 4 + row.level * 14
  if (row.kind === 'status') {
    return (
      <div className="mtstatus" role="none" style={{ paddingInlineStart: indent }}>
        <span>{row.label}</span>
        {row.retry && <button type="button" className="btnG btnSm" onClick={() => onActivate(row)}>{tr('treeRetry')}</button>}
      </div>
    )
  }
  if (row.kind === 'more') {
    return (
      <div role="none" style={{ paddingInlineStart: indent }}>
        <button type="button" className="mtmore" onClick={() => onActivate(row)}>{row.label}</button>
      </div>
    )
  }
  return (
    <div
      className="mtrow"
      role="treeitem"
      data-trow={row.key}
      data-kind={row.kind}
      data-dim={row.dim ? 1 : 0}
      data-sel={selected ? 1 : 0}
      aria-level={row.level + 1}
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-selected={row.kind === 'element' ? selected : undefined}
      tabIndex={focused ? 0 : -1}
      style={{ paddingInlineStart: indent }}
      onFocus={() => onFocusRow(row.key)}
      onClick={() => onActivate(row)}
    >
      {row.expandable ? (
        <button
          type="button"
          className="mttog"
          tabIndex={-1}
          aria-label={tr(row.expanded ? 'treeCollapse' : 'treeExpand')}
          onClick={e => { e.stopPropagation(); onToggleOpen(row.key) }}
        >
          <Glyph name={row.expanded ? 'chevD' : 'chevR'} size={12} />
        </button>
      ) : <span className="mttog mttog--none" aria-hidden="true" />}
      {row.check && <Check state={row.check} label={row.label} onChange={() => onToggleCheck(row)} />}
      <span className="mtlbl" title={row.label}>{row.label}</span>
      {row.badge && <span className="mtbadge">{row.badge}</span>}
      {row.count != null && <span className="mtcount tMonoS">{row.count}</span>}
    </div>
  )
}, (a, b) => a.row.sig === b.row.sig && a.focused === b.focused && a.selected === b.selected
  && a.onToggleCheck === b.onToggleCheck && a.onActivate === b.onActivate && a.onToggleOpen === b.onToggleOpen)

interface Props {
  engineRef: React.MutableRefObject<FragmentsEngine | null>
  engineReady: boolean
}

export function DashboardModelTree({ engineRef, engineReady }: Props) {
  const [host] = useState(treeHost)
  /** Bumped whenever the store or a group's hidden set changes, since neither is React state */
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  const models = useModelStore(s => s.models)
  const loaded = useModelStore(s => s.modelsLoadedInEngine)
  const layerShown = useModelStore(s => s.modelVisibility)

  /** Rows whose open state the user flipped from its default (disciplines start open) */
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set())
  const [pages, setPages] = useState<Map<string, number>>(() => new Map())
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const eko = win().EKO
  const open = !!eko?.state?.treeOpen
  const lang = eko?.lang

  // The dashboard tells us after each of its renders (language, tool state, floor and layer filters)
  useEffect(() => {
    window.addEventListener('eko-tree-sync', bump)
    return () => window.removeEventListener('eko-tree-sync', bump)
  }, [])

  // The host exists from now on; if the tree was already open, have the dashboard put it in the panel
  useEffect(() => {
    win().EKO_TREE_HOST = host   // set again here: a remount (StrictMode) runs the cleanup below first
    if (win().EKO?.state?.treeOpen) win().EKO?.set?.({})
    return () => {
      // The tree's checkboxes go with it, so what it hid must not stay hidden with nothing left to undo it
      for (const entry of store.entries.values()) {
        if (entry.status === 'ready') void setHidden(entry.model, 'tree', [])
      }
      host.remove()
      delete win().EKO_TREE_HOST
      resetStore()
    }
  }, [host])

  const pushVisibility = useCallback((modelId: string) => {
    const entry = store.entries.get(modelId)
    if (entry?.status === 'ready') void setHidden(entry.model, 'tree', hiddenItems(entry.data))
  }, [])

  // Reset view in the dashboard brings back what the tree hid, along with floors and layers
  useEffect(() => {
    const reset = () => {
      for (const [id, entry] of store.entries) {
        if (entry.status !== 'ready') continue
        for (const storey of entry.data.storeys) setCategoriesVisible(storey.categories, true)
        pushVisibility(id)
      }
      bump()
    }
    window.addEventListener('eko-tree-reset', reset)
    return () => window.removeEventListener('eko-tree-reset', reset)
  }, [pushVisibility])

  const build = useCallback(async (modelId: string, model: FragModel) => {
    store.entries.set(modelId, { status: 'loading', model })
    bump()
    // The worker registers a model a moment after it loads, so an early query can reject
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const data = await buildModelTree(model, modelId)
        if (store.entries.get(modelId)?.model === model) store.entries.set(modelId, { status: 'ready', model, data })
        break
      } catch (err) {
        if (store.entries.get(modelId)?.model !== model) return
        if (attempt === 3) {
          console.error('Model tree failed', err)
          store.entries.set(modelId, { status: 'error', model })
        } else {
          await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
        }
      }
    }
    bump()
  }, [])

  // Build each loaded model's tree when the tree is first opened; keep it while closed
  useEffect(() => {
    const engine = engineRef.current
    if (!open || !engineReady || !engine) return
    const live = new Set<string>()
    for (const rec of models) {
      if (rec.type === 'glb' || !loaded[rec.modelId]) continue
      const model = engine.fragments.models.list.get(rec.modelId) as FragModel | undefined
      if (!model) continue
      live.add(rec.modelId)
      if (store.entries.get(rec.modelId)?.model !== model) {
        store.names.delete(rec.modelId)
        for (const k of [...store.asked]) if (k.startsWith(rec.modelId + ':')) store.asked.delete(k)
        void build(rec.modelId, model)
      }
    }
    // A model that was removed or replaced takes its tree, names and selection with it
    let dropped = false
    for (const id of [...store.entries.keys()]) {
      if (live.has(id)) continue
      store.entries.delete(id)
      store.names.delete(id)
      dropped = true
      if (store.selected?.startsWith(id + ':')) {
        store.selected = null
        window.dispatchEvent(new CustomEvent('viewer-command', { detail: { action: 'clearHighlight' } }))
      }
    }
    if (dropped) bump()
  }, [open, engineReady, engineRef, models, loaded, build])

  const retry = useCallback((modelId: string) => {
    const model = engineRef.current?.fragments.models.list.get(modelId) as FragModel | undefined
    if (model) void build(modelId, model)
  }, [engineRef, build])

  const dock = eko?.state?.dock
  const layerCount = Array.isArray(dock?.layer) ? dock.layer.length : (dock?.layer && dock.layer !== 'all' ? 1 : 0)
  const filterOn = !!dock && (dock.level !== 'ALL' || layerCount > 0)

  /* ------------------------------- the rows ------------------------------- */
  const q = deferredQuery.trim().toLowerCase()
  const isOpen = (key: string, byDefault: boolean) => byDefault !== flipped.has(key)

  const { rows, pendingNames } = useMemo(() => {
    const want = new Map<string, number[]>()
    if (!open) return { rows: [] as Row[], pendingNames: want }
    const hit = (s: string) => s.toLowerCase().includes(q)
    const nameOf = (modelId: string, id: number) => store.names.get(modelId)?.get(id)
    const plain = (r: Omit<Row, 'expandable' | 'expanded' | 'dim' | 'sig'> & Partial<Row>): Row =>
      ({ expandable: false, expanded: false, dim: false, sig: `${r.kind}|${r.label}`, ...r })

    const storeyLabel = (s: MergedStorey) => (s.unassigned ? tr('treeUnassigned') : (s.name || tr('treeUnnamed')))
    const catLabel = (c: MergedCategory) => categoryLabel(c.category) || tr('treeUncategorised')
    const layerOff = (modelId: string) => layerShown[modelId] === false
    /** A row is dimmed when every model behind it is switched off by the layer picker */
    const allOff = (parts: Part[]) => parts.length > 0 && parts.every(p => layerOff(p.modelId))
    /** Names already loaded that match; an element's name is only known once it has been on screen */
    const namedHits = (c: MergedCategory): Item[] => c.parts.flatMap(({ modelId, group }) => {
      const known = store.names.get(modelId)
      return known ? group.ids.filter(id => { const n = known.get(id); return !!n && hit(n) }).map(id => ({ modelId, group, id })) : []
    })
    /** The first `n` elements of a category, in model order */
    const firstItems = (c: MergedCategory, n: number): Item[] => {
      const out: Item[] = []
      for (const { modelId, group } of c.parts) {
        for (const id of group.ids) {
          if (out.length >= n) return out
          out.push({ modelId, group, id })
        }
      }
      return out
    }

    // Models by discipline, in the order the dashboard lists them
    const sources: DisciplineSource[] = []
    const byDiscipline = new Map<string, { discipline: string | null; label: string; recs: typeof models }>()
    for (const rec of models) {
      // The same classifier as the Layers menu; a name it cannot place stays Unclassified
      const classified = classifyModel(rec.originalFileName || '')
      const discipline = classified.known ? classified.group : null
      const key = disciplineKey(discipline)
      let d = byDiscipline.get(key)
      if (!d) {
        d = { discipline, label: discipline ? tr(DISCIPLINE_KEY[discipline] ?? discipline) : tr('treeUnclassified'), recs: [] }
        byDiscipline.set(key, d)
      }
      d.recs.push(rec)
      const entry = store.entries.get(rec.modelId)
      if (rec.type !== 'glb' && entry?.status === 'ready') sources.push({ modelId: rec.modelId, discipline, data: entry.data })
    }
    const merged = new Map(mergeByDiscipline(sources).map(d => [d.key, d]))
    const disciplines = [...byDiscipline.entries()].sort(([, a], [, b]) => {
      if ((a.discipline == null) !== (b.discipline == null)) return a.discipline == null ? 1 : -1
      return a.label.localeCompare(b.label)
    })

    const blocks: Row[][] = []
    for (const [dKey, d] of disciplines) {
      const storeys = merged.get(dKey)?.storeys ?? []
      const dHit = hit(d.label)
      // Models with nothing to list yet, or nothing to list at all
      const notes = d.recs.flatMap(rec => {
        const entry = store.entries.get(rec.modelId)
        if (rec.type !== 'glb' && entry?.status === 'ready') return []
        const state = rec.type === 'glb' ? 'nodata' : entry?.status === 'error' ? 'error' : 'loading'
        return [{ rec, state }]
      }).filter(({ rec }) => !q || dHit || hit(rec.originalFileName))
      const storeyBelow = (s: MergedStorey) => s.categories.some(c => hit(catLabel(c)) || namedHits(c).length > 0)
      const dBelow = storeys.some(s => hit(storeyLabel(s)) || storeyBelow(s))
      if (q && !dHit && !dBelow && !notes.length) continue

      const dParts = partsOfCategories(storeys.flatMap(s => s.categories))
      const dTally = tallyParts(dParts)
      const dOpen = isOpen(dKey, true) || (q !== '' && (dBelow || notes.length > 0))
      const dDim = d.recs.every(rec => layerOff(rec.modelId))
      const expandable = storeys.length > 0 || notes.length > 0
      const block: Row[] = [{
        key: dKey, kind: 'discipline', level: 0, label: d.label, count: merged.has(dKey) ? dTally.total : undefined,
        check: merged.has(dKey) ? checkStateOf(dTally) : undefined, expandable, expanded: expandable && dOpen, dim: dDim,
        parts: dParts,
        sig: `d|${d.label}|${dTally.total}|${dTally.hidden}|${expandable && dOpen}|${dDim}|${merged.has(dKey)}`,
      }]
      if (dOpen) {
        for (const storey of storeys) {
          const sHit = hit(storeyLabel(storey))
          if (q && !dHit && !sHit && !storeyBelow(storey)) continue
          const sParts = partsOfCategories(storey.categories)
          const sTally = tallyParts(sParts)
          const sOpen = isOpen(storey.key, false) || (q !== '' && storeyBelow(storey))
          const sDim = allOff(sParts)
          block.push({
            key: storey.key, kind: 'storey', level: 1, label: storeyLabel(storey), count: sTally.total,
            check: checkStateOf(sTally), expandable: true, expanded: sOpen, dim: sDim, parts: sParts,
            sig: `s|${storeyLabel(storey)}|${sTally.total}|${sTally.hidden}|${sOpen}|${sDim}`,
          })
          if (!sOpen) continue
          for (const cat of storey.categories) {
            const cHit = hit(catLabel(cat))
            const hits = q ? namedHits(cat) : []
            if (q && !dHit && !sHit && !cHit && !hits.length) continue
            const cTally = tallyParts(cat.parts)
            const cOpen = isOpen(cat.key, false) || (q !== '' && hits.length > 0)
            const cDim = allOff(cat.parts)
            block.push({
              key: cat.key, kind: 'category', level: 2, label: catLabel(cat), count: cat.count,
              check: checkStateOf(cTally), expandable: true, expanded: cOpen, dim: cDim, parts: cat.parts,
              sig: `c|${catLabel(cat)}|${cTally.total}|${cTally.hidden}|${cOpen}|${cDim}`,
            })
            if (!cOpen) continue
            // Under a search that matched above this category, every element is a match
            const all = !q || dHit || sHit || cHit
            const total = all ? cat.count : hits.length
            const shown = (pages.get(cat.key) ?? 1) * PAGE
            const missing = new Map<string, number[]>()
            for (const { modelId, group, id } of all ? firstItems(cat, shown) : hits.slice(0, shown)) {
              const known = nameOf(modelId, id)
              if (known === undefined && !store.asked.has(`${modelId}:${id}`)) missing.set(modelId, [...(missing.get(modelId) ?? []), id])
              const label = known || `${catLabel(cat)} #${id}`
              const isHidden = group.hidden.has(id)
              const eDim = layerOff(modelId)
              block.push({
                key: `${modelId}:${id}`, kind: 'element', level: 3, label, check: isHidden ? 'unchecked' : 'checked',
                expandable: false, expanded: false, dim: eDim, modelId, group, elementId: id, className: cat.category,
                sig: `e|${label}|${isHidden}|${eDim}`,
              })
            }
            missing.forEach((ids, modelId) => want.set(modelId, [...(want.get(modelId) ?? []), ...ids]))
            if (total > shown) {
              block.push(plain({
                key: `${cat.key}:more`, kind: 'more', level: 3, label: tr('treeMore', { n: Math.min(PAGE, total - shown) }),
                pageKey: cat.key, sig: `more|${total - shown}`,
              }))
            }
          }
        }
        for (const { rec, state } of notes) {
          const text = tr(state === 'error' ? 'treeError' : state === 'loading' ? 'treeLoading' : 'treeNoData')
          block.push(plain({
            key: `${dKey}:status:${rec.modelId}`, kind: 'status', level: 1, label: `${rec.originalFileName} · ${text}`,
            sig: `${state}|${rec.originalFileName}|${text}`, retry: state === 'error', modelId: rec.modelId,
          }))
        }
      }
      blocks.push(block)
    }

    if (!models.length) return { rows: [plain({ key: 'empty', kind: 'status', level: 0, label: tr('treeEmpty') })], pendingNames: want }
    const out = blocks.flat()
    if (q && !blocks.length) out.push(plain({ key: 'nomatch', kind: 'status', level: 0, label: tr('treeNoMatch', { q: deferredQuery.trim() }), sig: `nm|${q}` }))
    return { rows: out, pendingNames: want }
    // `version` stands for the store and the groups' hidden sets, which change in place
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, models, layerShown, flipped, pages, q, deferredQuery, lang, version])

  // Names of the elements on screen, one worker call per model per change
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !pendingNames.size) return
    for (const [modelId, ids] of pendingNames) {
      const model = engine.fragments.models.list.get(modelId) as FragModel | undefined
      if (!model) continue
      const unique = [...new Set(ids)]
      unique.forEach(id => store.asked.add(`${modelId}:${id}`))
      loadElementNames(model, unique).then(found => {
        if (store.entries.get(modelId)?.model !== model) return
        const known = store.names.get(modelId) ?? new Map<number, string>()
        found.forEach((name, id) => known.set(id, name))
        store.names.set(modelId, known)
        bump()
      }).catch(() => { unique.forEach(id => store.asked.delete(`${modelId}:${id}`)) })
    }
  }, [pendingNames, engineRef])

  /* ------------------------------- handlers ------------------------------- */
  const toggleOpen = useCallback((key: string) => {
    setFlipped(prev => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  const toggleCheck = useCallback((row: Row) => {
    const touched = new Set<string>()
    if (row.kind === 'element') {
      touched.add(row.modelId!)
      setElementVisible(row.group!, row.elementId!, row.group!.hidden.has(row.elementId!))
    } else if (row.parts) {
      row.parts.forEach(p => touched.add(p.modelId))
      // Anything hidden or partly hidden shows everything below it; a fully visible node hides it
      setPartsVisible(row.parts, checkStateOf(tallyParts(row.parts)) !== 'checked')
    }
    touched.forEach(pushVisibility)
    bump()
  }, [pushVisibility])

  const select = useCallback(async (row: Row) => {
    const model = row.modelId ? engineRef.current?.fragments.models.list.get(row.modelId) : undefined
    if (!model || row.elementId == null) return
    store.selected = row.key
    setSelected(row.key)
    try {
      const [guid] = await model.getGuidsByLocalIds([row.elementId])
      if (!guid) return
      // The same event the Select tool sends, so the dashboard opens the same card. `fromTree` lets it
      // through without arming the tool and keeps the camera where it is.
      window.dispatchEvent(new CustomEvent('viewer-command', {
        detail: { action: 'openAssetByBimId', bimId: guid, expressId: row.elementId, name: row.label, type: '', category: categoryLabel(row.className ?? null), fromTree: true },
      }))
    } catch { /* a miss is not a selection */ }
  }, [engineRef])

  const activate = useCallback((row: Row) => {
    if (row.kind === 'status') {
      if (row.retry && row.modelId) retry(row.modelId)
    } else if (row.kind === 'more') {
      const key = row.pageKey!
      setPages(prev => new Map(prev).set(key, (prev.get(key) ?? 1) + 1))
    } else if (row.kind === 'element') {
      void select(row)
    } else if (row.expandable) {
      toggleOpen(row.key)
    }
  }, [select, toggleOpen, retry])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-trow]') ?? [])]
    const at = items.findIndex(el => el === document.activeElement)
    const row = at >= 0 ? rows.find(r => r.key === items[at].dataset.trow) : undefined
    const move = (i: number) => { const el = items[Math.max(0, Math.min(items.length - 1, i))]; if (el) { e.preventDefault(); el.focus() } }
    if (e.key === 'ArrowDown') move(at + 1)
    else if (e.key === 'ArrowUp') move(at - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(items.length - 1)
    else if (row && e.key === 'ArrowRight' && row.expandable && !row.expanded) { e.preventDefault(); toggleOpen(row.key) }
    else if (row && e.key === 'ArrowLeft' && row.expandable && row.expanded) { e.preventDefault(); toggleOpen(row.key) }
    else if (row && e.key === ' ' && row.check) { e.preventDefault(); toggleCheck(row) }
    else if (row && e.key === 'Enter') { e.preventDefault(); activate(row) }
  }

  // A selection whose model is gone no longer shows as selected
  const liveSelected = selected && store.entries.has(selected.slice(0, selected.lastIndexOf(':'))) ? selected : null
  const tabStop = rows.find(r => r.key === focusKey)?.key ?? rows.find(r => r.kind !== 'status' && r.kind !== 'more')?.key

  if (!open) return null

  return createPortal(
    <div className="mtwrap">
      <div className="mtsearch">
        <Glyph name="search" size={14} />
        <input
          className="vpq mtq"
          type="search"
          value={query}
          placeholder={tr('treeSearch')}
          aria-label={tr('treeSearch')}
          autoComplete="off"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && query) { e.nativeEvent.stopPropagation(); setQuery('') }
            else if (e.key === 'ArrowDown') { e.preventDefault(); scrollRef.current?.querySelector<HTMLElement>('[data-trow]')?.focus() }
          }}
        />
        {query && (
          <button type="button" className="iconbtn icon26" aria-label={tr('treeSearchClear')} onClick={() => setQuery('')}>
            <Glyph name="x" size={13} />
          </button>
        )}
      </div>
      {filterOn && <p className="mtnote tCap">{tr('treeFilter')}</p>}
      <div className="mtscroll" ref={scrollRef} role="tree" aria-label={tr('treeAria')} onKeyDown={onKeyDown}>
        {rows.map(row => (
          <RowView
            key={row.key}
            row={row}
            focused={row.key === tabStop}
            selected={liveSelected === row.key}
            onToggleOpen={toggleOpen}
            onToggleCheck={toggleCheck}
            onActivate={activate}
            onFocusRow={setFocusKey}
          />
        ))}
      </div>
    </div>,
    host,
  )
}
