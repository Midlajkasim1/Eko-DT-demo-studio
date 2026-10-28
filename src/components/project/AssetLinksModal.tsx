import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '@/store/useProjectStore'
import { useFinStore } from '@/store/useFinStore'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import type { AssetLink } from '@/types'
import {
  KNOWN_TYPES,
  bestMatches,
  defaultType,
  foldName,
  isGuid,
  linksToCsv,
  mergeLinks,
  parseLinks,
  prepareElements,
  suggest,
  type LinkEquipment,
  type ModelElement,
  type Suggestion,
} from '@/lib/assetLinks'
import { guidsInModels, listModelElements } from '@/lib/modelElements'

interface AssetLinksModalProps {
  visible: boolean
  onClose: () => void
  engineRef: React.MutableRefObject<FragmentsEngine | null>
}

type Filter = 'all' | 'linked' | 'unlinked' | 'problems'

interface Row {
  key: string
  eq: LinkEquipment | null
  link: AssetLink | null
  /** Linked under an older FIN name; FIN's record id says it is this equipment */
  renamedFrom?: string
}

type Tone = 'ok' | 'warn' | 'bad' | 'none'

const AUTO_MIN = 0.8
const pct = (score: number) => `${Math.round(score * 100)}%`

export function AssetLinksModal({ visible, onClose, engineRef }: AssetLinksModalProps) {
  const currentProject = useProjectStore(s => s.currentProject)
  if (!visible || !currentProject) return null
  // Mounted per opening and per project, so edits never carry over to another project
  return (
    <AssetLinksDialog
      key={currentProject.projectId}
      initial={currentProject.assetLinks ?? []}
      projectName={currentProject.name}
      onClose={onClose}
      engineRef={engineRef}
    />
  )
}

interface AssetLinksDialogProps {
  initial: AssetLink[]
  projectName: string
  onClose: () => void
  engineRef: React.MutableRefObject<FragmentsEngine | null>
}

function AssetLinksDialog({ initial, projectName, onClose, engineRef }: AssetLinksDialogProps) {
  const equipment = useFinStore(s => s.equipment)
  const finConnected = useFinStore(s => s.isConnected)

  const [links, setLinks] = useState<AssetLink[]>(initial)
  const [elements, setElements] = useState<ModelElement[] | null>(null)
  const [scan, setScan] = useState<{ state: 'idle' | 'scanning' | 'error'; message?: string }>({ state: 'scanning' })
  const [scanRun, setScanRun] = useState(0)
  const [present, setPresent] = useState<Set<string> | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [importText, setImportText] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadingFin, setLoadingFin] = useState(false)

  useEffect(() => {
    const engine = engineRef.current
    const job = engine ? listModelElements(engine) : Promise.reject(new Error('the 3D viewer is not ready.'))
    let cancelled = false
    job.then(
      found => {
        if (cancelled) return
        setElements(found)
        setScan({ state: 'idle' })
      },
      (e: unknown) => {
        if (cancelled) return
        setElements(null)
        setScan({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => { cancelled = true }
  }, [scanRun, engineRef])

  useEffect(() => {
    const fin = useFinStore.getState()
    if (fin.isConnected && !fin.equipment.length) void fin.fetchEquipment()
  }, [])

  const rescan = () => {
    setScan({ state: 'scanning' })
    setScanRun(n => n + 1)
  }

  const reloadFin = async () => {
    setLoadingFin(true)
    try { await useFinStore.getState().fetchEquipment() } finally { setLoadingFin(false) }
  }

  const guidKey = useMemo(() => [...new Set(links.map(l => l.guid))].sort().join(','), [links])
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !guidKey) return
    let cancelled = false
    guidsInModels(engine, guidKey.split(',')).then(
      found => { if (!cancelled) setPresent(found) },
      () => { if (!cancelled) setPresent(null) },
    )
    return () => { cancelled = true }
  }, [guidKey, elements, engineRef])

  const prepared = useMemo(() => (elements ? prepareElements(elements) : []), [elements])
  const byGuid = useMemo(() => new Map((elements ?? []).map(e => [e.guid, e])), [elements])

  const finList = useMemo(() => {
    const seen = new Map<string, LinkEquipment>()
    for (const e of equipment) {
      if (!e?.name) continue
      const key = foldName(e.name)
      if (!seen.has(key)) seen.set(key, { name: e.name, floor: e.floor, type: e.type, bimId: e.bimId, finId: e.finId })
    }
    return [...seen.values()]
  }, [equipment])

  const suggestions = useMemo(() => {
    const out = new Map<string, Suggestion[]>()
    if (prepared.length) for (const eq of finList) out.set(foldName(eq.name), suggest(eq, prepared))
    return out
  }, [finList, prepared])

  const rows = useMemo<Row[]>(() => {
    const finKeys = new Set(finList.map(eq => foldName(eq.name)))
    const byFold = new Map(links.map(l => [foldName(l.equip), l]))
    const byFinId = new Map(links.filter(l => l.finId).map(l => [l.finId as string, l]))
    const used = new Set<AssetLink>()
    const out: Row[] = []
    for (const eq of finList) {
      const key = foldName(eq.name)
      let link = byFold.get(key) ?? null
      let renamedFrom: string | undefined
      if (!link && eq.finId) {
        const moved = byFinId.get(eq.finId)
        if (moved && !used.has(moved) && !finKeys.has(foldName(moved.equip))) {
          link = moved
          renamedFrom = moved.equip
        }
      }
      if (link) used.add(link)
      out.push({ key, eq, link, renamedFrom })
    }
    for (const link of links) if (!used.has(link)) out.push({ key: foldName(link.equip), eq: null, link })
    const nameOf = (r: Row) => r.eq?.name ?? r.link?.equip ?? ''
    return out.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }))
  }, [links, finList])

  const linkedBy = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const l of links) out.set(l.guid, [...(out.get(l.guid) ?? []), l.equip])
    return out
  }, [links])

  const label = (guid: string) => {
    const el = byGuid.get(guid)
    return el ? el.name || el.objectType || el.category : undefined
  }

  const statusOf = (row: Row): { tone: Tone; text: string } => {
    if (row.link) {
      if (present && !present.has(row.link.guid) && !byGuid.has(row.link.guid)) return { tone: 'bad', text: 'Not in model' }
      if (row.renamedFrom) return { tone: 'warn', text: `Renamed in FIN (was ${row.renamedFrom})` }
      if (!row.eq && finList.length) return { tone: 'warn', text: 'Not in FIN' }
      return { tone: 'ok', text: 'Linked' }
    }
    const best = suggestions.get(row.key)?.[0]
    return best ? { tone: 'none', text: `Suggested ${pct(best.score)}` } : { tone: 'none', text: 'Not linked' }
  }

  const linkRow = (row: Row, guid: string) => {
    const name = row.eq?.name ?? row.link?.equip
    if (!name) return
    const el = byGuid.get(guid)
    const finId = row.eq?.finId ?? row.link?.finId
    const next: AssetLink = {
      equip: name,
      guid,
      type: row.link?.type || defaultType(row.eq ?? { name }),
      ...(finId ? { finId } : {}),
      ...(el ? { element: el.name || el.objectType } : {}),
    }
    setLinks(prev => [...prev.filter(l => l !== row.link && foldName(l.equip) !== row.key), next])
    setPicks(prev => ({ ...prev, [row.key]: '' }))
  }

  const unlink = (row: Row) => setLinks(prev => prev.filter(l => l !== row.link))
  const setType = (row: Row, type: string) => setLinks(prev => prev.map(l => (l === row.link ? { ...l, type: type.toUpperCase() } : l)))
  const followRename = (row: Row) => setLinks(prev => prev.map(l => (l === row.link && row.eq ? { ...l, equip: row.eq.name } : l)))

  const pickedGuid = (text: string | undefined): string | null => {
    const t = (text ?? '').trim()
    if (isGuid(t)) return t
    const hits = (elements ?? []).filter(e => e.name === t)
    return hits.length === 1 ? hits[0].guid : null
  }

  const unlinked = rows.filter(r => r.eq && !r.link).map(r => r.eq as LinkEquipment)
  const autoMatches = bestMatches(unlinked, suggestions, new Set(links.map(l => l.guid)), AUTO_MIN)

  const linkAll = () => {
    const added: AssetLink[] = autoMatches.map(({ eq, s }) => {
      const el = byGuid.get(s.guid)
      return {
        equip: eq.name,
        guid: s.guid,
        type: defaultType(eq),
        ...(eq.finId ? { finId: eq.finId } : {}),
        ...(el ? { element: el.name || el.objectType } : {}),
      }
    })
    setLinks(prev => [...prev, ...added])
    setNotice(`Linked ${added.length} equipment from suggestions of ${pct(AUTO_MIN)} or more. Check them, then save.`)
  }

  const doImport = () => {
    const parsed = parseLinks(importText ?? '')
    if (!parsed.links) {
      setError(parsed.error ?? 'Nothing to import.')
      return
    }
    const merged = mergeLinks(links, parsed.links)
    setLinks(merged.links)
    setImportText(null)
    setError(null)
    setNotice(`Imported ${merged.added} new and ${merged.replaced} replaced links. Save to keep them.`)
  }

  const readFile = async (file: File | undefined) => {
    if (file) setImportText(await file.text())
  }

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([linksToCsv(links)], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName || 'project'}-asset-links.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await useProjectStore.getState().saveAssetLinks(links)
      onClose()
    } catch (e) {
      setError(`Not saved. ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const statuses = new Map(rows.map(r => [r, statusOf(r)]))
  const q = query.trim().toLowerCase()
  const shown = rows.filter(r => {
    const st = statuses.get(r)!
    if (filter === 'linked' && !r.link) return false
    if (filter === 'unlinked' && r.link) return false
    if (filter === 'problems' && st.tone !== 'bad' && st.tone !== 'warn') return false
    if (!q) return true
    const text = `${r.eq?.name ?? ''} ${r.link?.equip ?? ''} ${r.eq?.floor ?? ''} ${r.link ? label(r.link.guid) ?? r.link.element ?? '' : ''} ${r.link?.guid ?? ''}`
    return text.toLowerCase().includes(q)
  })
  const problemCount = rows.filter(r => ['bad', 'warn'].includes(statuses.get(r)!.tone)).length

  const scanText = scan.state === 'scanning'
    ? 'Reading the model…'
    : scan.state === 'error'
      ? `Model not read: ${scan.message}`
      : elements
        ? `${elements.length.toLocaleString()} equipment elements in the loaded models`
        : 'No model read yet'

  return createPortal(
    <div className="dashboard-settings-overlay" onClick={onClose}>
      <div className="dashboard-settings-modal asset-links-modal" onClick={e => e.stopPropagation()}>
        <div className="dashboard-settings-header">
          <h2>
            <i className="bx bx-link" style={{ marginRight: '8px' }}></i>
            Asset Links
          </h2>
          <button className="ds-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="dashboard-settings-body">
          <p className="ds-hint" style={{ marginTop: 0 }}>
            Links each FIN equipment to its model element by IFC GlobalId. A revised model keeps its GlobalIds, so the links carry over; any that do not are listed as Not in model.
          </p>

          <div className="al-sources">
            <span>
              {finConnected
                ? `FIN: ${finList.length} equipment`
                : 'FIN not connected: connect to list its equipment. Links can still be imported and edited.'}
              {finConnected && (
                <button className="ds-btn ds-btn-secondary al-small" onClick={reloadFin} disabled={loadingFin}>
                  {loadingFin ? 'Loading…' : 'Reload'}
                </button>
              )}
            </span>
            <span>
              {scanText}
              <button className="ds-btn ds-btn-secondary al-small" onClick={rescan} disabled={scan.state === 'scanning'}>Rescan</button>
            </span>
          </div>

          <div className="al-toolbar">
            <div className="al-filters">
              {([
                ['all', `All ${rows.length}`],
                ['linked', `Linked ${links.length}`],
                ['unlinked', `Not linked ${unlinked.length}`],
                ['problems', `Problems ${problemCount}`],
              ] as [Filter, string][]).map(([id, text]) => (
                <button key={id} className={`ds-toggle-btn ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{text}</button>
              ))}
            </div>
            <input className="al-search" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} />
          </div>

          <div className="al-actions">
            <button className="ds-btn ds-btn-primary al-small" onClick={linkAll} disabled={!autoMatches.length}
              title={`Links each unlinked equipment to its best suggestion of ${pct(AUTO_MIN)} or more`}>
              Link {autoMatches.length} suggestions ≥ {pct(AUTO_MIN)}
            </button>
            <button className="ds-btn ds-btn-secondary al-small" onClick={() => setImportText(importText === null ? '' : null)}>Import</button>
            <button className="ds-btn ds-btn-secondary al-small" onClick={exportCsv} disabled={!links.length}>Export CSV</button>
          </div>

          {importText !== null && (
            <div className="al-import">
              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={'CSV with a header row (equip,guid,type,finId,element), a JSON list of links, or the old { "FCU-…": { "bimId": "…", "type": "FCU" } } table'}
              />
              <div className="al-import-row">
                <input type="file" accept=".csv,.json,.txt" onChange={e => readFile(e.target.files?.[0])} />
                <button className="ds-btn ds-btn-primary al-small" onClick={doImport} disabled={!importText.trim()}>Add to links</button>
              </div>
            </div>
          )}

          {notice && <p className="al-notice">{notice}</p>}
          {error && <p className="al-error">{error}</p>}

          <table className="al-table">
            <thead>
              <tr>
                <th>FIN equipment</th>
                <th>Type</th>
                <th>Model element</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(row => {
                const st = statuses.get(row)!
                const sugg = suggestions.get(row.key) ?? []
                const pick = picks[row.key] ?? ''
                const pickGuid = pickedGuid(pick)
                const shared = row.link ? (linkedBy.get(row.link.guid) ?? []).filter(n => n !== row.link?.equip) : []
                return (
                  <tr key={`${row.key}:${row.link?.guid ?? ''}`}>
                    <td>
                      <div className="al-name">{row.eq?.name ?? row.link?.equip}</div>
                      <div className="al-sub">{[row.eq?.floor, row.eq?.type && row.eq.type !== 'other' ? row.eq.type : null].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>
                      {row.link
                        ? <input className="al-type" list="al-types" value={row.link.type} onChange={e => setType(row, e.target.value)} />
                        : <span className="al-sub">{row.eq ? defaultType(row.eq) : ''}</span>}
                    </td>
                    <td>
                      {row.link ? (
                        <div>
                          <div>{label(row.link.guid) ?? row.link.element ?? '—'}</div>
                          <code className="al-guid">{row.link.guid}</code>
                          {shared.length > 0 && <div className="al-sub">Also linked to {shared.join(', ')}</div>}
                        </div>
                      ) : (
                        <div className="al-pick">
                          {sugg.map(s => (
                            <button key={s.guid} className="al-chip" onClick={() => linkRow(row, s.guid)}
                              title={`${s.reason}\n${s.guid}${linkedBy.has(s.guid) ? `\nAlready linked to ${linkedBy.get(s.guid)!.join(', ')}` : ''}`}>
                              <b>{pct(s.score)}</b> {label(s.guid)}{linkedBy.has(s.guid) ? ' (in use)' : ''}
                            </button>
                          ))}
                          <span className="al-search-row">
                            <input list="al-elements" placeholder="Element name or GlobalId" value={pick}
                              onChange={e => setPicks(prev => ({ ...prev, [row.key]: e.target.value }))} />
                            <button className="ds-btn ds-btn-secondary al-small" disabled={!pickGuid} onClick={() => pickGuid && linkRow(row, pickGuid)}>Link</button>
                          </span>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`al-status al-${st.tone}`}>{st.text}</span>
                      {row.renamedFrom && (
                        <button className="ds-btn ds-btn-secondary al-small" onClick={() => followRename(row)}>Use new name</button>
                      )}
                    </td>
                    <td>
                      {row.link && <button className="ds-btn ds-btn-secondary al-small" onClick={() => unlink(row)}>Unlink</button>}
                    </td>
                  </tr>
                )
              })}
              {!shown.length && (
                <tr><td colSpan={5} className="al-sub" style={{ textAlign: 'center', padding: '24px' }}>
                  {rows.length ? 'Nothing matches.' : 'No FIN equipment or links yet. Connect to FIN, or import links.'}
                </td></tr>
              )}
            </tbody>
          </table>

          <datalist id="al-types">
            {KNOWN_TYPES.map(t => <option key={t} value={t} />)}
          </datalist>
          <datalist id="al-elements">
            {(elements ?? []).map(e => (
              <option key={e.guid} value={e.guid} label={`${e.name || e.objectType} · ${e.category} · ${e.modelName}`} />
            ))}
          </datalist>
        </div>

        <div className="dashboard-settings-footer">
          <button className="ds-btn ds-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="ds-btn ds-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Links'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
