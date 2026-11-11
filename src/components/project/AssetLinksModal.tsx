import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useProjectStore } from '@/store/useProjectStore'
import { hospitalHvacEnabled } from '@/lib/hospitalHvac'
import { useFinStore } from '@/store/useFinStore'
import { useModelStore } from '@/store/useModelStore'
import { useLoadingProgressStore } from '@/store/useLoadingProgressStore'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import type { AssetLink } from '@/types'
import type { FinEquipment } from '@/types/fin'
import {
  CLIPS,
  KNOWN_TYPES,
  bestMatches,
  defaultClip,
  defaultType,
  elementLabel,
  foldName,
  isCctv,
  isGuid,
  levelRank,
  linksToCsv,
  listClips,
  mergeLinks,
  parseLinks,
  prepareElements,
  sortLevels,
  spaceLabel,
  suggestAll,
  typeWords,
  type LinkEquipment,
  type ModelElement,
} from '@/lib/assetLinks'
import { holdFinWatch } from '@/lib/finWatch'
import { defaultSpaceModelKeys, guidsInModel, guidsInModels, listModelElements, listScannedModels, roomsContaining, type ScannedModel } from '@/lib/modelElements'

interface AssetLinksModalProps {
  visible: boolean
  onClose: () => void
  engineRef: React.MutableRefObject<FragmentsEngine | null>
}

type Mode = 'equip' | 'cctv' | 'space'
type Filter = 'all' | 'linked' | 'unlinked' | 'noroom' | 'problems' | 'added' | 'open'

interface Row {
  key: string
  eq: LinkEquipment | null
  link: AssetLink | null
  /** Linked under an older FIN name; FIN's record id says it is this equipment */
  renamedFrom?: string
}

interface SpaceRow {
  guid: string
  label: string
  el: ModelElement | null
  link: AssetLink | null
}

type Tone = 'ok' | 'auto' | 'warn' | 'bad' | 'none'

const AUTO_MIN = 0.8
const ALL_LEVELS = '*'
const levelLabel = (key: string) => key || 'No level'
const isCctvRow = (r: Row) => (r.eq ? !!r.eq.cctv : r.link?.kind === 'cctv')
const pct = (score: number) => `${Math.round(score * 100)}%`
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const fileLabel = (name: string) => name.split(/[/\\]/).pop() || name
const PICKER_LIMIT = 60

function toLinkEquipment(equipment: FinEquipment[]): LinkEquipment[] {
  const seen = new Map<string, LinkEquipment>()
  for (const e of equipment) {
    if (!e?.name) continue
    const key = foldName(e.name)
    if (!seen.has(key)) seen.set(key, { name: e.name, floor: e.floor, type: e.type, bimId: e.bimId, finId: e.finId, cctv: isCctv(e) })
  }
  return [...seen.values()]
}

function newLink(eq: LinkEquipment, guid: string, nameWords: boolean, el?: ModelElement): AssetLink {
  return {
    equip: eq.name,
    guid,
    type: eq.cctv ? 'CCTV' : defaultType(eq, nameWords),
    ...(eq.cctv ? { kind: 'cctv' as const } : {}),
    ...(eq.finId ? { finId: eq.finId } : {}),
    ...(el ? { element: el.name || el.objectType } : {}),
  }
}

const HINTS: Record<Mode, string> = {
  equip: 'Link each FIN equipment to its element in the model, or add one by name and GlobalId. A link keeps the IFC GlobalId, so it carries over to a revised model.',
  cctv: 'Link each FIN camera to its element in the model, or add a camera by name and GlobalId, then set the room it is in. FIN’s bimId is suggested first. Rooms come from the Spaces tab.',
  space: 'Rooms for the heatmap, grouped by level. Choose a FIN sensor or a piece of equipment for a room, or type a name such as IS-01. Rooms with no sensor of their own share the sample sensors.',
}

export function AssetLinksModal({ visible, onClose, engineRef }: AssetLinksModalProps) {
  const currentProject = useProjectStore(s => s.currentProject)
  if (!visible || !currentProject) return null
  // Mounted per opening and per project, so edits never carry over to another project
  return (
    <AssetLinksDialog
      key={currentProject.projectId}
      initial={currentProject.assetLinks ?? []}
      initialSource={currentProject.apiSettings?.dashboardCameraSource === 'model' ? 'model' : 'fin'}
      projectName={currentProject.name}
      nameWords={hospitalHvacEnabled(currentProject)}
      onClose={onClose}
      engineRef={engineRef}
    />
  )
}

type CameraSource = 'fin' | 'model'

interface AssetLinksDialogProps {
  initial: AssetLink[]
  initialSource: CameraSource
  projectName: string
  /** Hospital HVAC graphics on: a unit FIN gives no type is typed by the whole word in its name (AHU, FCU) */
  nameWords: boolean
  onClose: () => void
  engineRef: React.MutableRefObject<FragmentsEngine | null>
}

function AssetLinksDialog({ initial, initialSource, projectName, nameWords, onClose, engineRef }: AssetLinksDialogProps) {
  const equipment = useFinStore(s => s.equipment)
  const finConnected = useFinStore(s => s.isConnected)

  const [links, setLinks] = useState<AssetLink[]>(initial)
  const [mode, setMode] = useState<Mode>('equip')
  const [elements, setElements] = useState<ModelElement[] | null>(null)
  const [scan, setScan] = useState<{ state: 'idle' | 'scanning' | 'error'; message?: string }>({ state: 'idle' })
  const [scanRun, setScanRun] = useState(0)
  const [spaceScanRun, setSpaceScanRun] = useState(0)
  const spaceCache = useRef<ModelElement[] | null>(null)
  const modelSigSeen = useRef<string | null>(null)
  const modelSig = useModelStore(s => s.models.map(m => `${m.modelId}:${m.originalFileName ?? ''}`).join('|'))
  const loadingModels = useLoadingProgressStore(s => s.sessionActive)
  const [present, setPresent] = useState<Set<string> | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState(ALL_LEVELS)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [manualName, setManualName] = useState('')
  const [manualGuid, setManualGuid] = useState('')
  const [modelChoices, setModelChoices] = useState<ScannedModel[]>([])
  const [pickedKeys, setPickedKeys] = useState<string[]>([])
  const [savedByModel, setSavedByModel] = useState<Record<string, string[]>>({})
  const spacePick = useRef<string[] | null>(null)
  const [importText, setImportText] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadingFin, setLoadingFin] = useState(false)
  const [findingRooms, setFindingRooms] = useState(false)
  const [undo, setUndo] = useState<{ before: AssetLink[]; after: AssetLink[]; auto?: string[]; rooms?: string[] } | null>(null)
  const [autoKeys, setAutoKeys] = useState<Map<string, string>>(new Map())
  const [autoRooms, setAutoRooms] = useState<Set<string>>(new Set())
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerAll, setPickerAll] = useState(false)
  const [finFor, setFinFor] = useState<string | null>(null)
  const [finQuery, setFinQuery] = useState('')
  const [finKind, setFinKind] = useState<'all' | 'sensor' | 'equip'>('all')
  const spaceFold = useRef('')
  const linksRef = useRef(links)
  const scannedRef = useRef<ModelElement[] | null>(null)
  const declinedRef = useRef<Set<string>>(new Set())
  const declinedRoomsRef = useRef<Set<string>>(new Set())
  const [confirmClose, setConfirmClose] = useState(false)
  const [cameraSource, setCameraSource] = useState<CameraSource>(initialSource)
  const [exportOpen, setExportOpen] = useState(false)
  const exportMenu = useRef<HTMLDivElement>(null)
  const spaceMode = mode === 'space'

  const initialText = useMemo(() => JSON.stringify(initial), [initial])
  const dirty = useMemo(() => JSON.stringify(links) !== initialText || cameraSource !== initialSource, [links, initialText, cameraSource, initialSource])
  const requestClose = () => (dirty ? setConfirmClose(true) : onClose())

  useEffect(() => {
    if (confirmClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (pickerFor) setPickerFor(null)
      else if (finFor) setFinFor(null)
      else if (exportOpen) setExportOpen(false)
      else if (dirty) setConfirmClose(true)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, confirmClose, onClose, pickerFor, finFor, exportOpen])

  useEffect(() => {
    if (!exportOpen) return
    const onPointer = (e: MouseEvent) => {
      if (!exportMenu.current?.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [exportOpen])

  useEffect(() => { linksRef.current = links }, [links])
  useEffect(() => {
    if (pickerFor) document.querySelector('.al-picker')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [pickerFor])

  // Links sure matches and camera rooms; never redoes what the user undid
  const runAuto = useCallback(async (found: ModelElement[], equipment: FinEquipment[]) => {
    const finL = toLinkEquipment(equipment)
    if (!found.length || !finL.length) return
    const engine = engineRef.current
    const bimIds = finL.flatMap(eq => (isGuid(eq.bimId) ? [eq.bimId] : []))
    const presentSet = engine && bimIds.length ? await guidsInModels(engine, bimIds).catch(() => null) : null
    const sugg = suggestAll(finL, prepareElements(found), presentSet, nameWords)
    const current = linksRef.current
    const machines = current.filter(l => l.kind !== 'space')
    const named = new Set(machines.map(l => foldName(l.equip)))
    const finIds = new Set(machines.flatMap(l => (l.finId ? [l.finId] : [])))
    const open = finL.filter(eq => !named.has(foldName(eq.name)) && !(eq.finId && finIds.has(eq.finId)) && !declinedRef.current.has(foldName(eq.name)))
    // Only FIN's own bimId links by itself; name likeness stays a suggestion
    const matches = bestMatches(open, sugg, new Set(machines.map(l => l.guid)), 1)
    const byG = new Map(found.map(e => [e.guid, e]))
    const added = matches.map(({ eq, s }) => newLink(eq, s.guid, nameWords, byG.get(s.guid)))

    const cameras = new Set(finL.filter(eq => eq.cctv).map(eq => foldName(eq.name)))
    const isCam = (l: AssetLink) => l.kind === 'cctv' || cameras.has(foldName(l.equip))
    const rooms = current.filter(l => l.kind === 'space').map(l => l.guid)
    const needRoom = [...machines, ...added].filter(l => isCam(l) && !l.room && !declinedRoomsRef.current.has(foldName(l.equip)))
    const roomOf = engine && rooms.length && needRoom.length
      ? await roomsContaining(engine, needRoom.map(l => l.guid), rooms).catch(() => new Map<string, string>())
      : new Map<string, string>()
    // Edited meanwhile: leave it to the buttons
    if ((!added.length && !roomOf.size) || linksRef.current !== current) return
    const withRoom = (l: AssetLink): AssetLink => {
      const room = l.kind !== 'space' && isCam(l) && !l.room ? roomOf.get(l.guid) : undefined
      return room ? { ...l, kind: 'cctv', room } : l
    }
    const next = [...current.map(withRoom), ...added.map(withRoom)]
    const keys = matches.map(m => foldName(m.eq.name))
    const roomKeys = needRoom.filter(l => roomOf.has(l.guid)).map(l => foldName(l.equip))
    setUndo({ before: current, after: next, auto: keys, rooms: roomKeys })
    setLinks(next)
    setAutoKeys(prev => new Map([...prev, ...matches.map(m => [foldName(m.eq.name), m.s.reason] as [string, string])]))
    setAutoRooms(prev => new Set([...prev, ...roomKeys]))
    setNotice(null)
    setError(null)
  }, [engineRef, nameWords])

  const fillRoom = async (key: string, guid: string) => {
    const engine = engineRef.current
    const rooms = linksRef.current.filter(l => l.kind === 'space').map(l => l.guid)
    if (!engine || !rooms.length) return
    const room = (await roomsContaining(engine, [guid], rooms).catch(() => new Map<string, string>())).get(guid)
    if (!room) return
    setLinks(prev => prev.map(l => (l.kind !== 'space' && l.guid === guid && foldName(l.equip) === key && !l.room ? { ...l, kind: 'cctv', room } : l)))
    setAutoRooms(prev => new Set(prev).add(key))
  }

  // Undo holds until the next edit
  const bulk = (next: AssetLink[], message: string) => {
    setUndo({ before: links, after: next })
    setLinks(next)
    setNotice(message)
    setError(null)
  }
  const canUndo = !!undo && undo.after === links
  const undoBulk = () => {
    if (!undo || undo.after !== links) return
    setLinks(undo.before)
    if (undo.auto?.length) {
      for (const key of undo.auto) declinedRef.current.add(key)
      setAutoKeys(prev => new Map([...prev].filter(([k]) => !undo.auto!.includes(k))))
    }
    if (undo.rooms?.length) {
      for (const key of undo.rooms) declinedRoomsRef.current.add(key)
      setAutoRooms(prev => new Set([...prev].filter(k => !undo.rooms!.includes(k))))
    }
    setUndo(null)
    setNotice('Undone.')
  }

  useEffect(() => {
    if (spaceMode || loadingModels) return
    const engine = engineRef.current
    const job = !engine
      ? Promise.reject(new Error('the 3D viewer is not ready.'))
      : listModelElements(engine, 'equip')
    let cancelled = false
    job.then(
      found => {
        if (cancelled) return
        scannedRef.current = found
        setElements(found)
        setScan({ state: 'idle' })
        void runAuto(found, useFinStore.getState().equipment)
      },
      (e: unknown) => {
        if (cancelled) return
        setElements(null)
        setScan({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => { cancelled = true }
  }, [scanRun, engineRef, spaceMode, loadingModels, runAuto])

  /* Names of the loaded files only. The rooms themselves wait for Scan. */
  useEffect(() => {
    if (mode !== 'space') return
    const engine = engineRef.current
    if (!engine) return
    const models = listScannedModels(engine)
    const known = new Set(models.map(m => m.key))
    const picked = spacePick.current == null
      ? defaultSpaceModelKeys(models)
      : spacePick.current.filter(k => known.has(k))
    spacePick.current = picked
    setModelChoices(models)
    setPickedKeys(picked)
    if (modelSigSeen.current == null) {
      modelSigSeen.current = modelSig
      return
    }
    if (modelSigSeen.current !== modelSig) {
      modelSigSeen.current = modelSig
      setNotice('A model was added or changed. Scan to update the room list. Saved rooms stay as they are.')
    }
  }, [mode, modelSig, engineRef])

  useEffect(() => {
    if (!spaceScanRun || mode !== 'space') return
    const engine = engineRef.current
    const job = !engine
      ? Promise.reject(new Error('the 3D viewer is not ready.'))
      : listModelElements(engine, 'space', spacePick.current ?? [])
    let cancelled = false
    job.then(
      found => {
        if (cancelled) return
        spaceCache.current = found
        setElements(found)
        setScan({ state: 'idle' })
      },
      (e: unknown) => {
        if (cancelled) return
        setScan({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => { cancelled = true }
  }, [spaceScanRun, mode, engineRef])

  const [clipFiles, setClipFiles] = useState<{ names: string[]; listed: boolean }>({ names: CLIPS, listed: false })
  useEffect(() => {
    let live = true
    void listClips().then(found => { if (live) setClipFiles(found) })
    return () => { live = false }
  }, [])
  const clipOptions = useMemo(() => {
    const saved = links.flatMap(l => (l.kind === 'cctv' && l.clip && l.clip !== 'none' ? [l.clip] : []))
    return [...new Set([...clipFiles.names, ...saved])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [clipFiles, links])

  // FIN equipment is read only while a watch is held
  const [finWaiting, setFinWaiting] = useState(true)
  useEffect(() => {
    if (!finConnected) return
    const release = holdFinWatch()
    const fetchIfEmpty = () => {
      const fin = useFinStore.getState()
      if (fin.equipment.length) return
      void fin.fetchEquipment().then(() => {
        const eq = useFinStore.getState().equipment
        if (eq.length && scannedRef.current) void runAuto(scannedRef.current, eq)
      })
    }
    fetchIfEmpty()
    const poll = setInterval(fetchIfEmpty, 3000)
    const giveUp = setTimeout(() => setFinWaiting(false), 60000)
    return () => {
      release()
      clearInterval(poll)
      clearTimeout(giveUp)
    }
  }, [finConnected, runAuto])
  const readingFin = finConnected && !equipment.length && finWaiting

  const switchMode = (next: Mode) => {
    if (next === mode) return
    setMode(next)
    setQuery('')
    setFilter('all')
    setLevel(ALL_LEVELS)
    setCollapsed(new Set())
    setPickerFor(null)
    setFinFor(null)
    setNotice(null)
    setError(null)
    if (next === 'space') {
      spaceFold.current = ''
      setElements(spaceCache.current)
      setScan({ state: 'idle' })
      return
    }
    // Equipment and CCTV read the same elements
    if (mode !== 'space') return
    setElements(null)
    setScan({ state: 'scanning' })
  }

  const rescan = () => {
    setScan({ state: 'scanning' })
    if (mode === 'space') setSpaceScanRun(n => n + 1)
    else setScanRun(n => n + 1)
  }

  const applySpacePick = (next: string[]) => {
    spacePick.current = next
    setPickedKeys(next)
  }

  const reloadFin = async () => {
    setLoadingFin(true)
    try {
      await useFinStore.getState().fetchEquipment()
      if (scannedRef.current) void runAuto(scannedRef.current, useFinStore.getState().equipment)
    } finally { setLoadingFin(false) }
  }

  const equipLinks = useMemo(() => links.filter(l => l.kind !== 'space'), [links])
  const spaceLinks = useMemo(() => links.filter(l => l.kind === 'space'), [links])
  const spaceGuidKey = useMemo(() => spaceLinks.map(l => l.guid).sort().join(','), [spaceLinks])
  useEffect(() => {
    if (mode !== 'space' || loadingModels) return
    const engine = engineRef.current
    const guids = spaceGuidKey ? spaceGuidKey.split(',') : []
    if (!engine || !guids.length || !modelChoices.length) {
      setSavedByModel({})
      return
    }
    let cancelled = false
    void (async () => {
      const next: Record<string, string[]> = {}
      for (const choice of modelChoices) {
        try {
          const found = await guidsInModel(engine, choice.key, guids)
          if (found.length) next[choice.key] = found
        } catch { /* this file is not ready to answer */ }
        if (cancelled) return
      }
      if (!cancelled) setSavedByModel(next)
    })()
    return () => { cancelled = true }
  }, [mode, loadingModels, spaceGuidKey, modelChoices, engineRef])

  const finBimIds = useMemo(() => equipment.filter(e => e && isGuid(e.bimId)).map(e => e.bimId), [equipment])
  const guidKey = useMemo(() => [...new Set([...links.map(l => l.guid), ...finBimIds])].sort().join(','), [links, finBimIds])
  useEffect(() => {
    const engine = engineRef.current
    if (loadingModels || !engine || !guidKey) return
    let cancelled = false
    guidsInModels(engine, guidKey.split(',')).then(
      found => { if (!cancelled) setPresent(found) },
      () => { if (!cancelled) setPresent(null) },
    )
    return () => { cancelled = true }
  }, [guidKey, elements, engineRef, loadingModels])

  const prepared = useMemo(() => (!spaceMode && elements ? prepareElements(elements) : []), [elements, spaceMode])
  const byGuid = useMemo(() => new Map((elements ?? []).map(e => [e.guid, e])), [elements])

  const finList = useMemo(() => toLinkEquipment(equipment), [equipment])
  const suggestions = useMemo(() => suggestAll(finList, prepared, present, nameWords), [finList, prepared, present, nameWords])

  const allRows = useMemo<Row[]>(() => {
    const finKeys = new Set(finList.map(eq => foldName(eq.name)))
    const byFold = new Map(equipLinks.map(l => [foldName(l.equip), l]))
    const byFinId = new Map(equipLinks.filter(l => l.finId).map(l => [l.finId as string, l]))
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
    for (const link of equipLinks) if (!used.has(link)) out.push({ key: foldName(link.equip), eq: null, link })
    const nameOf = (r: Row) => r.eq?.name ?? r.link?.equip ?? ''
    return out.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }))
  }, [equipLinks, finList])

  const equipRows = useMemo(() => allRows.filter(r => !isCctvRow(r)), [allRows])
  const cctvRows = useMemo(() => allRows.filter(isCctvRow), [allRows])
  const rows = mode === 'cctv' ? cctvRows : equipRows
  const equipLinkedCount = equipRows.filter(r => r.link).length
  const cctvLinkedCount = cctvRows.filter(r => r.link).length
  const roomsByGuid = useMemo(() => new Map(spaceLinks.map(l => [l.guid, l])), [spaceLinks])
  const roomName = (guid: string) => roomsByGuid.get(guid)?.equip

  const spaceRows = useMemo<SpaceRow[]>(() => {
    if (mode !== 'space') return []
    const linked = new Map(spaceLinks.map(l => [l.guid, l]))
    const seen = new Set<string>()
    const out: SpaceRow[] = []
    for (const el of elements ?? []) {
      seen.add(el.guid)
      out.push({ guid: el.guid, label: spaceLabel(el), el, link: linked.get(el.guid) ?? null })
    }
    for (const link of spaceLinks) {
      if (seen.has(link.guid)) continue
      out.push({ guid: link.guid, label: link.element || link.equip, el: null, link })
    }
    const nameOf = (r: SpaceRow) => r.link?.equip || r.label
    return out.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }))
  }, [mode, elements, spaceLinks])

  const rowLevel = (r: Row) => r.eq?.floor || (r.link ? byGuid.get(r.link.guid)?.level : '') || ''
  const spaceLevel = (r: SpaceRow) => r.el?.level || r.link?.level || ''
  const levels = (() => {
    const byKey = new Map<string, { key: string; total: number; done: number; elevation?: number }>()
    const count = (key: string, done: boolean, elevation?: number) => {
      const lv = byKey.get(key) ?? { key, total: 0, done: 0 }
      lv.total++
      if (done) lv.done++
      if (elevation !== undefined) lv.elevation = Math.min(lv.elevation ?? elevation, elevation)
      byKey.set(key, lv)
    }
    if (mode === 'space') for (const r of spaceRows) count(spaceLevel(r), !!r.link, r.el?.elevation)
    else for (const r of rows) count(rowLevel(r), !!r.link, r.link ? byGuid.get(r.link.guid)?.elevation : undefined)
    return sortLevels([...byKey.values()])
  })()
  const levelKey = levels.some(l => l.key === level) ? level : ALL_LEVELS
  const inLevel = (key: string) => levelKey === ALL_LEVELS || key === levelKey
  const scoped = rows.filter(r => inLevel(rowLevel(r)))
  const scopedSpaces = spaceRows.filter(r => inLevel(spaceLevel(r)))
  const where = levelKey === ALL_LEVELS ? '' : ` on ${levelLabel(levelKey)}`
  const scopeText = levelKey === ALL_LEVELS ? 'in this tab' : `on ${levelLabel(levelKey)}`
  const showLevelHeads = mode === 'space'
    ? levels.length > 0
    : levels.length > 1 || (levels.length === 1 && levels[0].key !== '')
  const levelMark = `${levels.length}:${levels.map(l => l.key).join('\0')}`
  useEffect(() => {
    if (mode !== 'space' || !levels.length || spaceFold.current === levelMark) return
    spaceFold.current = levelMark
    setCollapsed(new Set(levels.map(l => l.key)))
  }, [mode, levelMark, levels])

  const groupRows = <T,>(list: T[], levelOf: (r: T) => string) => {
    const byKey = new Map<string, T[]>()
    for (const r of list) byKey.set(levelOf(r), [...(byKey.get(levelOf(r)) ?? []), r])
    return levels.filter(l => byKey.has(l.key)).map(l => ({ key: l.key, rows: byKey.get(l.key)! }))
  }
  const toggleLevel = (key: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const linkedBy = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const l of equipLinks) out.set(l.guid, [...(out.get(l.guid) ?? []), l.equip])
    return out
  }, [equipLinks])

  const label = (guid: string) => {
    const el = byGuid.get(guid)
    return el ? el.name || el.objectType || el.category : undefined
  }

  const statusOf = (row: Row): { tone: Tone; text: string } => {
    if (row.link) {
      if (present && !present.has(row.link.guid) && !byGuid.has(row.link.guid)) return { tone: 'bad', text: 'Not in model' }
      if (row.renamedFrom) return { tone: 'warn', text: `Renamed in FIN (was ${row.renamedFrom})` }
      if (!row.eq && finList.length) return { tone: 'warn', text: 'Not in FIN' }
      if (autoKeys.has(row.key)) return { tone: 'auto', text: 'Linked automatically' }
      return { tone: 'ok', text: 'Linked' }
    }
    const best = suggestions.get(row.key)?.[0]
    return best ? { tone: 'none', text: `Suggested ${pct(best.score)}` } : { tone: 'none', text: 'Not linked' }
  }

  const forget = (key: string) => {
    if (autoKeys.has(key)) setAutoKeys(prev => new Map([...prev].filter(([k]) => k !== key)))
  }

  const spaceStatus = (row: SpaceRow): { tone: Tone; text: string } => {
    if (!row.link) return { tone: 'none', text: 'Not added' }
    if (present && !present.has(row.guid) && !row.el) return { tone: 'bad', text: 'Not in model' }
    return { tone: 'ok', text: 'Added' }
  }

  const linkRow = (row: Row, guid: string) => {
    const name = row.eq?.name ?? row.link?.equip
    if (!name) return
    const el = byGuid.get(guid)
    const finId = row.eq?.finId ?? row.link?.finId
    const cctv = isCctvRow(row)
    const next: AssetLink = {
      equip: name,
      guid,
      type: row.link?.type || (cctv ? 'CCTV' : defaultType(row.eq ?? { name }, nameWords)),
      ...(cctv ? { kind: 'cctv' as const } : {}),
      ...(finId ? { finId } : {}),
      ...(el ? { element: el.name || el.objectType } : {}),
      ...(cctv && row.link?.room && row.link.guid === guid ? { room: row.link.room } : {}),
      ...(cctv && row.link?.clip ? { clip: row.link.clip } : {}),
    }
    setLinks(prev => [...prev.filter(l => l.kind === 'space' || (l !== row.link && foldName(l.equip) !== row.key)), next])
    forget(row.key)
    setPickerFor(null)
    if (cctv && !next.room) {
      setAutoRooms(prev => new Set([...prev].filter(k => k !== row.key)))
      void fillRoom(row.key, guid)
    }
  }

  const unlink = (row: Row) => {
    declinedRef.current.add(row.key)
    forget(row.key)
    setLinks(prev => prev.filter(l => l !== row.link))
  }
  const openPicker = (row: Row) => {
    setPickerFor(pickerFor === row.key ? null : row.key)
    setPickerQuery('')
    setPickerAll(false)
  }
  const setType = (row: Row, type: string) => setLinks(prev => prev.map(l => (l === row.link ? { ...l, type: type.toUpperCase() } : l)))
  const setClip = (row: Row, clip: string) => setLinks(prev => prev.map(l => {
    if (l !== row.link) return l
    const next: AssetLink = { ...l }
    if (clip) next.clip = clip
    else delete next.clip
    return next
  }))
  const followRename = (row: Row) => setLinks(prev => prev.map(l => (l === row.link && row.eq ? { ...l, equip: row.eq.name } : l)))
  const setRoom = (row: Row, room: string | null) => {
    setLinks(prev => prev.map(l => {
      if (l !== row.link) return l
      const next: AssetLink = { ...l, kind: 'cctv' }
      if (room) next.room = room
      else delete next.room
      return next
    }))
    if (!room) declinedRoomsRef.current.add(row.key)
    setAutoRooms(prev => new Set([...prev].filter(k => k !== row.key)))
    setPicks(prev => ({ ...prev, [`room:${row.key}`]: '' }))
  }

  const pickedRoom = (text: string | undefined): string | null => {
    const t = (text ?? '').trim()
    if (isGuid(t)) return t
    const hits = spaceLinks.filter(l => l.equip === t)
    return hits.length === 1 ? hits[0].guid : null
  }

  const findRooms = async () => {
    const engine = engineRef.current
    const cams = scoped.flatMap(r => (r.link && !r.link.room ? [r.link] : []))
    if (!engine || !cams.length || !spaceLinks.length) return
    setFindingRooms(true)
    setError(null)
    try {
      const found = await roomsContaining(engine, cams.map(l => l.guid), spaceLinks.map(l => l.guid))
      const want = new Set(cams.map(l => foldName(l.equip)))
      setLinks(prev => prev.map(l => {
        const room = l.kind !== 'space' && !l.room && want.has(foldName(l.equip)) ? found.get(l.guid) : undefined
        return room ? { ...l, kind: 'cctv' as const, room } : l
      }))
      setAutoRooms(prev => new Set([...prev, ...cams.filter(l => found.has(l.guid)).map(l => foldName(l.equip))]))
      setNotice(`Found the room of ${cams.filter(l => found.has(l.guid)).length} of ${plural(cams.length, 'camera')}${where} from the model. Check them, then save.`)
    } catch (e) {
      setError(`Rooms not found. ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setFindingRooms(false)
    }
  }

  const addSpace = (el: ModelElement, heatName?: string) => {
    const labelText = spaceLabel(el)
    const name = (heatName || labelText).trim()
    if (!name) return
    const next: AssetLink = { kind: 'space', equip: name, guid: el.guid, type: 'SPACE', element: labelText, ...(el.level ? { level: el.level } : {}) }
    setLinks(prev => [...prev.filter(l => !(l.kind === 'space' && l.guid === el.guid)), next])
  }

  const addSpaces = (els: ModelElement[], why = '') => {
    const taken = new Set(spaceLinks.map(l => l.guid))
    const fresh = els.filter(el => el.guid && !taken.has(el.guid))
    if (!fresh.length) return
    const next: AssetLink[] = fresh.map(el => {
      const labelText = spaceLabel(el)
      return { kind: 'space', equip: labelText, guid: el.guid, type: 'SPACE', element: labelText, ...(el.level ? { level: el.level } : {}) }
    })
    const guids = new Set(next.map(l => l.guid))
    bulk([...links.filter(l => !(l.kind === 'space' && guids.has(l.guid))), ...next], `Added ${plural(next.length, 'room')}${why} from the model, each named by its room label. Save to keep them.`)
  }

  const addManualSpace = () => {
    const guid = manualGuid.trim()
    const name = manualName.trim()
    if (!isGuid(guid) || !name) return
    const el = mode === 'space' ? byGuid.get(guid) : undefined
    if (el) addSpace(el, name)
    else {
      const next: AssetLink = { kind: 'space', equip: name, guid, type: 'SPACE', element: name }
      setLinks(prev => [...prev.filter(l => !(l.kind === 'space' && l.guid === guid)), next])
    }
    setManualName('')
    setManualGuid('')
  }

  const addManualLink = () => {
    const guid = manualGuid.trim()
    const name = manualName.trim()
    if (!isGuid(guid) || !name || mode === 'space') return
    const el = byGuid.get(guid)
    const cctv = mode === 'cctv'
    const key = foldName(name)
    const next: AssetLink = {
      equip: name,
      guid,
      type: cctv ? 'CCTV' : defaultType({ name }, nameWords),
      ...(cctv ? { kind: 'cctv' as const } : {}),
      ...(el ? { element: el.name || el.objectType } : { element: name }),
    }
    setLinks(prev => [...prev.filter(l => l.kind === 'space' || foldName(l.equip) !== key), next])
    setManualName('')
    setManualGuid('')
  }

  const setHeatName = (guid: string, name: string, fromFin?: { finId?: string } | null) => {
    setLinks(prev => prev.map(l => {
      if (!(l.kind === 'space' && l.guid === guid)) return l
      const next: AssetLink = { ...l, equip: name }
      const hit = fromFin ?? finList.find(eq => !eq.cctv && foldName(eq.name) === foldName(name))
      if (hit?.finId) next.finId = hit.finId
      else delete next.finId
      return next
    }))
  }

  const sensorEq = (eq: { name: string; type?: string }) => {
    const name = eq.name.toUpperCase()
    return /SENSOR/.test(`${eq.type || ''} ${name}`) || /(?:^|[^A-Z0-9])(?:IAQ|IS)[^A-Z0-9]*\d/.test(name)
  }

  const unlinkSpace = (guid: string) => setLinks(prev => prev.filter(l => !(l.kind === 'space' && l.guid === guid)))
  const removeSpaces = (guids: string[], why = '') => {
    const drop = new Set(guids)
    if (!drop.size) return
    bulk(links.filter(l => !(l.kind === 'space' && drop.has(l.guid))), `Removed ${plural(drop.size, 'room')}${why}. Save to keep this.`)
  }

  const thing = mode === 'cctv' ? { one: 'camera', many: 'cameras' } : { one: 'equipment', many: 'equipment' }
  const unlinked = scoped.filter(r => r.eq && !r.link).map(r => r.eq as LinkEquipment)
  const autoMatches = bestMatches(unlinked, suggestions, new Set(equipLinks.map(l => l.guid)), AUTO_MIN)

  const linkAll = () => {
    const added = autoMatches.map(({ eq, s }) => newLink(eq, s.guid, nameWords, byGuid.get(s.guid)))
    const next = [...links, ...added]
    setUndo({ before: links, after: next, auto: autoMatches.map(m => foldName(m.eq.name)) })
    setLinks(next)
    setAutoKeys(prev => new Map([...prev, ...autoMatches.map(m => [foldName(m.eq.name), m.s.reason] as [string, string])]))
    setNotice(null)
    setError(null)
  }

  const linkKind = (l: AssetLink): Mode => l.kind === 'space' ? 'space' : l.kind === 'cctv' ? 'cctv' : 'equip'
  const doImport = () => {
    const parsed = parseLinks(importText ?? '', nameWords)
    if (!parsed.links) {
      setError(parsed.error ?? 'Nothing to import.')
      return
    }
    const picked = parsed.links.filter(l => linkKind(l) === mode)
    if (!picked.length) {
      const name = mode === 'equip' ? 'equipment' : mode === 'cctv' ? 'camera' : 'room'
      setError(`That file has no ${name} links.`)
      return
    }
    const merged = mergeLinks(links, picked)
    setImportText(null)
    const which = mode === 'equip' ? 'equipment' : mode === 'cctv' ? 'camera' : 'room'
    bulk(merged.links, `Imported ${merged.added} new and ${merged.replaced} replaced ${which} links. Save to keep them.`)
  }

  const readFile = async (file: File | undefined) => {
    if (file) setImportText(await file.text())
  }

  const downloadCsv = (rows: AssetLink[], file: string) => {
    const url = URL.createObjectURL(new Blob([linksToCsv(rows)], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName || 'project'}-${file}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExportOpen(false)
  }
  const equipCsv = links.filter(l => l.kind !== 'space' && l.kind !== 'cctv')
  const cameraCsv = links.filter(l => l.kind === 'cctv')
  const roomCsv = links.filter(l => l.kind === 'space')
  const tabCsv = mode === 'cctv' ? cameraCsv : mode === 'space' ? roomCsv : equipCsv
  const tabFile = mode === 'cctv' ? 'cctv' : mode === 'space' ? 'spaces' : 'equipment'

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      if (cameraSource !== initialSource) {
        const api = { ...(useProjectStore.getState().currentProject?.apiSettings ?? {}) }
        if (cameraSource === 'model') api.dashboardCameraSource = 'model'
        else delete api.dashboardCameraSource
        await useProjectStore.getState().saveApiSettings(api)
      }
      // Backfill levels of rooms saved without one
      const scanned = new Map((spaceCache.current ?? []).map(e => [e.guid, e.level]))
      await useProjectStore.getState().saveAssetLinks(links.map(l => {
        const lv = l.kind === 'space' && !l.level ? scanned.get(l.guid) : undefined
        return lv ? { ...l, level: lv } : l
      }))
      onClose()
    } catch (e) {
      setError(`Not saved. ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const statuses = new Map(rows.map(r => [r, statusOf(r)]))
  const q = query.trim().toLowerCase()
  const shown = scoped.filter(r => {
    const st = statuses.get(r)!
    if (filter === 'linked' && !r.link) return false
    if (filter === 'unlinked' && r.link) return false
    if (filter === 'noroom' && !(r.link && !r.link.room)) return false
    if (filter === 'problems' && st.tone !== 'bad' && st.tone !== 'warn') return false
    if (!q) return true
    const text = `${r.eq?.name ?? ''} ${r.link?.equip ?? ''} ${r.eq?.floor ?? ''} ${r.link ? label(r.link.guid) ?? r.link.element ?? '' : ''} ${r.link?.guid ?? ''} ${r.link?.room ? roomName(r.link.room) ?? '' : ''}`
    return text.toLowerCase().includes(q)
  })
  const problemCount = scoped.filter(r => ['bad', 'warn'].includes(statuses.get(r)!.tone)).length
  const spaceStatuses = new Map(spaceRows.map(r => [r, spaceStatus(r)]))
  const shownSpaces = scopedSpaces.filter(r => {
    if (filter === 'added' && !r.link) return false
    if (filter === 'open' && r.link) return false
    if (!q) return true
    const text = `${r.label} ${r.link?.equip ?? ''} ${r.guid} ${r.el?.modelName ?? ''}`
    return text.toLowerCase().includes(q)
  })
  const addedCount = scopedSpaces.filter(r => r.link).length
  const openCount = scopedSpaces.filter(r => !r.link).length
  const openByModel = new Map<string, ModelElement[]>()
  const addedByModel = new Map<string, string[]>()
  for (const row of spaceRows) {
    if (!row.el) continue
    if (!row.link) {
      const list = openByModel.get(row.el.modelName) ?? []
      list.push(row.el)
      openByModel.set(row.el.modelName, list)
    } else {
      const list = addedByModel.get(row.el.modelName) ?? []
      list.push(row.guid)
      addedByModel.set(row.el.modelName, list)
    }
  }

  const scanText = loadingModels
    ? 'Models are still loading.'
    : scan.state === 'scanning'
    ? 'Reading the model…'
    : scan.state === 'error'
      ? `Model not read: ${scan.message}`
      : mode === 'space'
        ? elements
          ? !modelChoices.length
            ? 'No model is loaded.'
            : pickedKeys.length
              ? `${elements.length.toLocaleString()} spaces from ${pickedKeys.length} of ${modelChoices.length} models`
              : 'No model ticked. Tick a model, then Scan.'
          : spaceLinks.length
            ? `${spaceLinks.length} saved rooms. Scan only to look for new ones.`
            : 'Not scanned. Tick a model, then Scan.'
        : elements
          ? `${elements.length.toLocaleString()} equipment elements in the loaded models`
          : 'No model read yet'
  const camsWithoutRoom = scoped.filter(r => r.link && !r.link.room).length
  const tabAuto = rows.filter(r => r.link && autoKeys.has(r.key)).length
  const tabAutoRooms = mode === 'cctv' ? rows.filter(r => r.link?.room && autoRooms.has(r.key)).length : 0
  const bannerHead = tabAuto
    ? `${plural(tabAuto, thing.one, thing.many)} linked automatically${tabAutoRooms ? `, ${tabAutoRooms} with the room found in the model` : ''}.`
    : `Room found automatically for ${plural(tabAutoRooms, 'camera')}.`
  const tabLinks = scoped.flatMap(r => (r.link ? [r.link] : []))
  const missingLinks = scoped.flatMap(r => (r.link && statuses.get(r)!.tone === 'bad' ? [r.link] : []))
  const roomLinks = scoped.flatMap(r => (r.link?.room ? [r.link] : []))
  const addedSpaces = scopedSpaces.flatMap(r => (r.link ? [r.guid] : []))
  const missingSpaces = scopedSpaces.flatMap(r => (spaceStatuses.get(r)!.tone === 'bad' ? [r.guid] : []))

  const unlinkAll = () => {
    for (const r of scoped) if (r.link) declinedRef.current.add(r.key)
    const drop = new Set(tabLinks)
    if (drop.size) bulk(links.filter(l => !drop.has(l)), `Unlinked ${plural(drop.size, thing.one, thing.many)}${where}. Save to keep this.`)
  }
  const unlinkMissing = () => {
    const drop = new Set(missingLinks)
    if (drop.size) bulk(links.filter(l => !drop.has(l)), `Unlinked ${plural(drop.size, thing.one, thing.many)}${where} whose element is not in the loaded models. Save to keep this.`)
  }
  const clearRooms = () => {
    const clear = new Set(roomLinks)
    if (!clear.size) return
    for (const l of clear) declinedRoomsRef.current.add(foldName(l.equip))
    bulk(links.map(l => {
      if (!clear.has(l)) return l
      const next = { ...l }
      delete next.room
      return next
    }), `Cleared the room of ${plural(clear.size, 'camera')}${where}. Save to keep this.`)
  }

  const linkFilters: [Filter, string][] = [
    ['all', `All ${scoped.length}`],
    ['linked', `Linked ${tabLinks.length}`],
    ['unlinked', `Not linked ${unlinked.length}`],
    ...(mode === 'cctv' ? [['noroom', `No room ${camsWithoutRoom}`] as [Filter, string]] : []),
    ['problems', `Problems ${problemCount}`],
  ]
  const tabs: { id: Mode; label: string; count: string; tip: string }[] = [
    { id: 'equip', label: 'Equipment', count: `${equipLinkedCount}/${equipRows.length}`, tip: 'Linked of all FIN equipment' },
    { id: 'cctv', label: 'CCTV', count: `${cctvLinkedCount}/${cctvRows.length}`, tip: 'Linked of all FIN cameras' },
    { id: 'space', label: 'Spaces', count: String(spaceLinks.length), tip: 'Rooms added for the heatmap' },
  ]

  const roomPick = (row: Row) => picks[`room:${row.key}`] ?? ''

  const renderGroup = (key: string, cols: number, body: ReactNode[]) => {
    const lv = levels.find(l => l.key === key)
    const open = !collapsed.has(key)
    const summary = !lv ? '' : mode === 'space'
      ? `${lv.done} of ${plural(lv.total, 'room')} added${!key && !elements ? ' · Scan to read their level' : ''}`
      : `${lv.done} of ${lv.total} linked`
    return (
      <Fragment key={`level:${key}`}>
        {showLevelHeads && (
          <tr className="al-level-row">
            <td colSpan={cols}>
              <button className="al-level-head" onClick={() => toggleLevel(key)} aria-expanded={open}>
                <i className={`bx bx-chevron-${open ? 'down' : 'right'}`} aria-hidden="true"></i>
                <span className="al-level-name">{levelLabel(key)}</span>
                <span className="al-sub">{summary}</span>
              </button>
            </td>
          </tr>
        )}
        {(open || !showLevelHeads) && body}
      </Fragment>
    )
  }

  const renderPicker = (row: Row) => {
    const type = isCctvRow(row) ? 'CCTV' : row.link?.type || (row.eq ? defaultType(row.eq, nameWords) : '')
    const words = typeWords(type)
    const onlyType = words.length > 0 && !pickerAll
    const here = levelRank(rowLevel(row))
    const q = pickerQuery.trim().toLowerCase()
    const pool = prepared.filter(p => !onlyType || words.some(w => p.hay.includes(` ${w} `)))
    const hits = pool
      .filter(p => !q || `${p.el.name} ${p.el.objectType} ${p.el.guid} ${p.el.level ?? ''} ${p.el.modelName}`.toLowerCase().includes(q))
      .map(p => ({ el: p.el, same: !Number.isNaN(here) && levelRank(p.el.level ?? '') === here, users: (linkedBy.get(p.el.guid) ?? []).filter(n => n !== row.link?.equip) }))
      .sort((a, b) => Number(b.same) - Number(a.same) || Number(!!a.users.length) - Number(!!b.users.length)
        || a.el.name.localeCompare(b.el.name, undefined, { numeric: true }))
    const typeName = type === 'CCTV' ? 'cameras' : `${type} elements`
    const pasted = isGuid(pickerQuery.trim()) && !byGuid.has(pickerQuery.trim()) ? pickerQuery.trim() : null
    return (
      <div className="al-picker">
        <div className="al-picker-head">
          <input
            autoFocus
            className="al-search"
            placeholder="Search by name or GlobalId"
            value={pickerQuery}
            onChange={e => setPickerQuery(e.target.value)}
          />
          {words.length > 0 && (
            <label className="al-picker-only">
              <input type="checkbox" checked={!pickerAll} onChange={() => setPickerAll(!pickerAll)} />
              Only {typeName}
            </label>
          )}
          <span className="al-sub">
            {hits.length > PICKER_LIMIT ? `First ${PICKER_LIMIT} of ${hits.length.toLocaleString()}. Type to narrow.` : `${hits.length.toLocaleString()} found`}
            {!Number.isNaN(here) ? ` · ${levelLabel(rowLevel(row))} first` : ''}
          </span>
          <button className="ds-btn ds-btn-secondary al-small" onClick={() => setPickerFor(null)}>Close</button>
        </div>
        <div className="al-picker-list">
          {hits.slice(0, PICKER_LIMIT).map(h => (
            <button key={h.el.guid} className="al-option" onClick={() => linkRow(row, h.el.guid)}
              title={`${h.el.guid}${h.users.length ? `\nAlready linked to ${h.users.join(', ')}` : ''}`}>
              <span className="al-option-name">{elementLabel(h.el)}</span>
              <span className="al-sub">
                {[h.el.level, h.same ? 'same level' : null, fileLabel(h.el.modelName)].filter(Boolean).join(' · ')}
              </span>
              {h.users.length > 0 && <span className="al-option-used">In use by {h.users.join(', ')}</span>}
            </button>
          ))}
          {pasted && (
            <button className="al-option" onClick={() => linkRow(row, pasted)}>
              <span className="al-option-name">Use GlobalId {pasted}</span>
              <span className="al-sub">Not among the elements read from the model; it is checked against the models after linking</span>
            </button>
          )}
          {!hits.length && !pasted && (
            <div className="al-sub al-empty">
              {onlyType ? `No ${typeName} match. Untick Only ${typeName} to search every element.` : 'No element matches.'}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderLinkRow = (row: Row) => {
    const st = statuses.get(row)!
    const sugg = suggestions.get(row.key) ?? []
    const roomGuid = pickedRoom(roomPick(row))
    const shared = row.link ? (linkedBy.get(row.link.guid) ?? []).filter(n => n !== row.link?.equip) : []
    const linkedEl = row.link ? byGuid.get(row.link.guid) : undefined
    const picking = pickerFor === row.key
    return (
      <Fragment key={`${row.key}:${row.link?.guid ?? ''}`}>
        <tr className={picking ? 'al-row-picking' : undefined}>
          <td>
            <div className="al-name">{row.eq?.name ?? row.link?.equip}</div>
            <div className="al-sub">{[showLevelHeads ? null : row.eq?.floor, row.eq?.type && row.eq.type !== 'other' ? row.eq.type : null].filter(Boolean).join(' · ')}</div>
          </td>
          <td>
            {row.link
              ? <input className="al-type" list="al-types" value={row.link.type} onChange={e => setType(row, e.target.value)} />
              : <span className="al-sub">{isCctvRow(row) ? 'CCTV' : row.eq ? defaultType(row.eq, nameWords) : ''}</span>}
          </td>
          <td>
            {row.link ? (
              <div className="al-linked">
                <div>
                  <div>{linkedEl ? elementLabel(linkedEl) : row.link.element || '—'}</div>
                  <div className="al-sub">{[linkedEl?.level, linkedEl ? fileLabel(linkedEl.modelName) : null].filter(Boolean).join(' · ')}</div>
                  <code className="al-guid">{row.link.guid}</code>
                  {shared.length > 0 && <div className="al-option-used">Also linked to {shared.join(', ')}</div>}
                </div>
                {!picking && (
                  <button className="ds-btn ds-btn-secondary al-small" onClick={() => openPicker(row)} disabled={!prepared.length}>Change</button>
                )}
              </div>
            ) : (
              <div className="al-pick">
                {sugg.map(s => {
                  const el = byGuid.get(s.guid)
                  return (
                    <button key={s.guid} className="al-chip" onClick={() => linkRow(row, s.guid)}
                      title={`${s.reason}\n${s.guid}${linkedBy.has(s.guid) ? `\nAlready linked to ${linkedBy.get(s.guid)!.join(', ')}` : ''}`}>
                      <b>{pct(s.score)}</b> {el ? elementLabel(el) : s.guid}
                      <span className="al-sub">{[el?.level, linkedBy.has(s.guid) ? 'in use' : null].filter(Boolean).join(' · ')}</span>
                    </button>
                  )
                })}
                {!sugg.length && <span className="al-sub">{prepared.length ? 'No match found in the model' : 'Waiting for the model'}</span>}
                {!picking && (
                  <button className="ds-btn ds-btn-secondary al-small al-choose" onClick={() => openPicker(row)} disabled={!prepared.length}>
                    {sugg.length ? 'Choose another…' : 'Choose element…'}
                  </button>
                )}
              </div>
            )}
          </td>
          {mode === 'cctv' && (
            <td>
              {row.link?.room ? (
                <div>
                  <div>{roomName(row.link.room) ?? 'Not in Spaces'}</div>
                  {autoRooms.has(row.key) && <div className="al-sub al-auto">Found from the model</div>}
                  <code className="al-guid">{row.link.room}</code>
                </div>
              ) : row.link ? (
                spaceLinks.length ? (
                  <span className="al-search-row">
                    <input list="al-rooms" placeholder="Room name or GlobalId" value={roomPick(row)}
                      onChange={e => setPicks(prev => ({ ...prev, [`room:${row.key}`]: e.target.value }))} />
                    <button className="ds-btn ds-btn-secondary al-small" disabled={!roomGuid} onClick={() => roomGuid && setRoom(row, roomGuid)}>Set</button>
                  </span>
                ) : <span className="al-sub">Add rooms in Spaces first</span>
              ) : <span className="al-sub">Link the camera first</span>}
            </td>
          )}
          {mode === 'cctv' && (
            <td>
              {row.link ? (
                <select className="al-clip" value={row.link.clip ?? ''} onChange={e => setClip(row, e.target.value)} aria-label={`Footage of ${row.link.equip}`}>
                  <option value="">{defaultClip(row.link.equip)} (in order)</option>
                  {clipOptions.map(c => <option key={c} value={c}>{clipFiles.listed && !clipFiles.names.includes(c) ? `${c} (not in the folder)` : c}</option>)}
                  <option value="none">None</option>
                </select>
              ) : <span className="al-sub">Link the camera first</span>}
            </td>
          )}
          <td>
            <span className={`al-status al-${st.tone}`} title={autoKeys.get(row.key)}>{st.text}</span>
            {row.renamedFrom && (
              <button className="ds-btn ds-btn-secondary al-small" onClick={() => followRename(row)}>Use new name</button>
            )}
          </td>
          <td className="al-row-actions">
            {mode === 'cctv' && row.link?.room && (
              <button className="ds-btn ds-btn-secondary al-small" onClick={() => setRoom(row, null)}>Clear room</button>
            )}
            {row.link && <button className="ds-btn ds-btn-secondary al-small" onClick={() => unlink(row)}>Unlink</button>}
          </td>
        </tr>
        {picking && (
          <tr className="al-picker-row">
            <td colSpan={mode === 'cctv' ? 7 : 5}>{renderPicker(row)}</td>
          </tr>
        )}
      </Fragment>
    )
  }

  const renderFinPick = (guid: string) => {
    const q = finQuery.trim().toLowerCase()
    const pool = finList.filter(eq => !eq.cctv && (finKind === 'all' || (finKind === 'sensor' ? sensorEq(eq) : !sensorEq(eq))))
    const hits = pool.filter(eq => !q || `${eq.name} ${eq.type || ''} ${eq.floor || ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return (
      <div className="al-picker">
        <div className="al-picker-head">
          <input autoFocus className="al-search" placeholder="Search FIN sensors or equipment" value={finQuery} onChange={e => setFinQuery(e.target.value)} />
          <div className="al-filters">
            {(['all', 'sensor', 'equip'] as const).map(id => (
              <button key={id} type="button" className={`ds-toggle-btn ${finKind === id ? 'active' : ''}`} onClick={() => setFinKind(id)}>
                {id === 'all' ? 'All' : id === 'sensor' ? 'Sensors' : 'Equipment'}
              </button>
            ))}
          </div>
          <span className="al-sub">{hits.length > 80 ? `First 80 of ${hits.length.toLocaleString()}` : `${hits.length.toLocaleString()} found`}</span>
          <button type="button" className="ds-btn ds-btn-secondary al-small" onClick={() => setFinFor(null)}>Close</button>
        </div>
        <div className="al-picker-list">
          {hits.slice(0, 80).map(eq => (
            <button key={eq.finId || eq.name} type="button" className="al-option" onClick={() => { setHeatName(guid, eq.name, eq); setFinFor(null) }}>
              <span className="al-option-name">{eq.name}</span>
              <span className="al-sub">{[sensorEq(eq) ? 'Sensor' : 'Equipment', eq.floor, eq.type && eq.type !== 'other' ? eq.type : null].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {!hits.length && <div className="al-sub al-empty">{finConnected ? 'Nothing in FIN matches.' : 'FIN is not connected.'}</div>}
        </div>
      </div>
    )
  }

  const renderSpaceRow = (row: SpaceRow) => {
    const st = spaceStatuses.get(row)!
    const picking = finFor === row.guid
    return (
      <Fragment key={row.guid}>
        <tr className={picking ? 'al-row-picking' : undefined}>
          <td>
            <div className="al-name">{row.label}</div>
            <code className="al-guid">{row.guid}</code>
            {row.el?.modelName && <div className="al-sub">{row.el.modelName}</div>}
          </td>
          <td>
            {row.link ? (
              <span className="al-search-row">
                <input className="al-search" style={{ minWidth: 140 }} list="al-fin-names" value={row.link.equip} onChange={e => setHeatName(row.guid, e.target.value)} />
                <button type="button" className="ds-btn ds-btn-secondary al-small" onClick={() => { setFinFor(picking ? null : row.guid); setFinQuery('') }}>
                  {picking ? 'Close' : 'Choose'}
                </button>
              </span>
            ) : <span className="al-sub">{row.label}</span>}
          </td>
          <td><span className={`al-status al-${st.tone}`}>{st.text}</span></td>
          <td className="al-row-actions">
            {row.link
              ? <button className="ds-btn ds-btn-secondary al-small" onClick={() => unlinkSpace(row.guid)}>Remove</button>
              : <button className="ds-btn ds-btn-secondary al-small" disabled={!row.el} onClick={() => row.el && addSpace(row.el)}>Add</button>}
          </td>
        </tr>
        {picking && (
          <tr className="al-picker-row">
            <td colSpan={4}>{renderFinPick(row.guid)}</td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <>
      {createPortal(
        <div className="dashboard-settings-overlay">
          <div className="dashboard-settings-modal asset-links-modal">
            <div className="dashboard-settings-header">
              <h2>
                <i className="bx bx-link" style={{ marginRight: '8px' }}></i>
                Equipment & Spaces
              </h2>
              <button className="ds-close-btn" onClick={requestClose} aria-label="Close">×</button>
            </div>

            <div className="dashboard-settings-body">
              <div className="al-tabs" role="tablist">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={mode === tab.id}
                    className={`ds-toggle-btn ${mode === tab.id ? 'active' : ''}`}
                    onClick={() => switchMode(tab.id)}
                    title={tab.tip}
                  >
                    {tab.label}<span className="al-count">{tab.count}</span>
                  </button>
                ))}
              </div>

              <p className="ds-hint al-hint">{HINTS[mode]}</p>

              {mode === 'cctv' && (
                <div className="al-setting">
                  <span className="al-setting-label">Dashboard shows</span>
                  <div className="al-filters" role="radiogroup" aria-label="Cameras the dashboard shows">
                    <button role="radio" aria-checked={cameraSource === 'fin'} className={`ds-toggle-btn ${cameraSource === 'fin' ? 'active' : ''}`} onClick={() => setCameraSource('fin')}>
                      FIN cameras linked here ({cctvLinkedCount})
                    </button>
                    <button role="radio" aria-checked={cameraSource === 'model'} className={`ds-toggle-btn ${cameraSource === 'model' ? 'active' : ''}`} onClick={() => setCameraSource('model')}>
                      Every camera in the model
                    </button>
                  </div>
                  <span className="al-sub">
                    {cameraSource === 'fin'
                      ? 'Only the cameras linked below appear in Security: in the camera grid, on the model and in the counts.'
                      : 'Every CCTV camera in the loaded model appears, whether FIN has it or not.'}
                  </span>
                </div>
              )}

              <div className="al-sources">
                {mode !== 'space' ? (
                  <span>
                    {finConnected
                      ? readingFin ? 'FIN: reading equipment…' : `FIN: ${plural(rows.filter(r => r.eq).length, thing.one, thing.many)}`
                      : 'FIN is not connected. Connect to list its equipment; links can still be imported and edited.'}
                    {finConnected && (
                      <button className="ds-btn ds-btn-secondary al-small" onClick={reloadFin} disabled={loadingFin}>
                        {loadingFin ? 'Loading…' : 'Reload FIN'}
                      </button>
                    )}
                  </span>
                ) : <span>{plural(spaceLinks.length, 'room')} added for the heatmap</span>}
                <span>
                  {scanText}
                  <button className="ds-btn ds-btn-secondary al-small" onClick={rescan} disabled={scan.state === 'scanning' || loadingModels}>
                    {scan.state === 'scanning' ? 'Reading…' : mode === 'space' && !elements ? 'Scan' : 'Rescan'}
                  </button>
                </span>
              </div>

              {mode === 'space' && (
                <div className="al-models">
                  <span>Models</span>
                  {modelChoices.length ? modelChoices.map(m => {
                    const pending = openByModel.get(m.name) ?? []
                    const inFile = [...new Set([...(savedByModel[m.key] ?? []), ...(addedByModel.get(m.name) ?? [])])]
                    return (
                      <span key={m.key} className="al-model">
                        <label>
                          <input
                            type="checkbox"
                            checked={pickedKeys.includes(m.key)}
                            onChange={() => applySpacePick(
                              pickedKeys.includes(m.key) ? pickedKeys.filter(k => k !== m.key) : [...pickedKeys, m.key],
                            )}
                          />
                          {fileLabel(m.name)}
                        </label>
                        {pickedKeys.includes(m.key) && (
                          <button
                            type="button"
                            className="ds-btn ds-btn-secondary al-small"
                            disabled={!pending.length || scan.state === 'scanning'}
                            title="Adds the rooms of this file that are not added yet"
                            onClick={() => addSpaces(pending)}
                          >
                            Add all ({pending.length})
                          </button>
                        )}
                        <button
                          type="button"
                          className="ds-btn ds-btn-secondary al-small"
                          disabled={!inFile.length}
                          title="Removes the added rooms that are in this file"
                          onClick={() => removeSpaces(inFile, ` from ${fileLabel(m.name)}`)}
                        >
                          Remove all ({inFile.length})
                        </button>
                      </span>
                    )
                  }) : <span>No model is loaded.</span>}
                  {modelChoices.length > 1 && (
                    <>
                      <button type="button" className="ds-btn ds-btn-secondary al-small" onClick={() => applySpacePick(modelChoices.map(m => m.key))}>Tick all</button>
                      <button type="button" className="ds-btn ds-btn-secondary al-small" onClick={() => applySpacePick([])}>Untick all</button>
                    </>
                  )}
                </div>
              )}

              <div className="al-toolbar">
                <div className="al-filters">
                  {levels.length > 1 && (
                    <select className="al-level" value={levelKey} onChange={e => setLevel(e.target.value)} aria-label="Level"
                      title="Shows one level. The counts and the buttons below then work on that level only.">
                      <option value={ALL_LEVELS}>All levels ({levels.length})</option>
                      {levels.map(l => (
                        <option key={`opt:${l.key}`} value={l.key}>{levelLabel(l.key)} · {l.done}/{l.total}</option>
                      ))}
                    </select>
                  )}
                  {levels.length > 1 && levelKey === ALL_LEVELS && (
                    <button className="ds-btn ds-btn-secondary al-small" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(levels.map(l => l.key)))}>
                      {collapsed.size ? 'Expand all' : 'Collapse all'}
                    </button>
                  )}
                  {(mode !== 'space' ? linkFilters : ([
                    ['all', `All ${spaceRows.length}`],
                    ['added', `Added ${addedCount}`],
                    ['open', `Not added ${openCount}`],
                  ] as [Filter, string][])).map(([id, text]) => (
                    <button key={id} className={`ds-toggle-btn ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{text}</button>
                  ))}
                </div>
                <input className="al-search" placeholder={mode === 'space' ? 'Search rooms' : mode === 'cctv' ? 'Search cameras' : 'Search equipment'} value={query} onChange={e => setQuery(e.target.value)} />
              </div>

              <div className="al-actions">
                {mode !== 'space' ? (
                  <div className="al-group">
                    <button className="ds-btn ds-btn-primary al-small" onClick={linkAll} disabled={!autoMatches.length}
                      title={`Links every unlinked ${thing.one} to its best suggestion of ${pct(AUTO_MIN)} or more`}>
                      Link all suggested ({autoMatches.length})
                    </button>
                    {mode === 'cctv' && (
                      <button
                        className="ds-btn ds-btn-secondary al-small"
                        onClick={findRooms}
                        disabled={!camsWithoutRoom || !spaceLinks.length || findingRooms || loadingModels}
                        title={spaceLinks.length
                          ? 'Sets the room of every linked camera that has none, from where it sits in the model'
                          : 'Add rooms in the Spaces tab first'}
                      >
                        {findingRooms ? 'Finding rooms…' : `Find rooms (${camsWithoutRoom})`}
                      </button>
                    )}
                    <span className="al-sep" aria-hidden="true" />
                    <button className="ds-btn ds-btn-secondary al-small" onClick={unlinkAll} disabled={!tabLinks.length}
                      title={`Removes every ${thing.one} link ${scopeText}`}>
                      Unlink all ({tabLinks.length})
                    </button>
                    <button className="ds-btn ds-btn-secondary al-small" onClick={unlinkMissing} disabled={!missingLinks.length}
                      title="Removes the links whose element is not in any loaded model">
                      Unlink not in model ({missingLinks.length})
                    </button>
                    {mode === 'cctv' && (
                      <button className="ds-btn ds-btn-secondary al-small" onClick={clearRooms} disabled={!roomLinks.length}
                        title="Clears the room of every camera; the camera links stay">
                        Clear rooms ({roomLinks.length})
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="al-group">
                    <button
                      className="ds-btn ds-btn-primary al-small"
                      onClick={() => addSpaces(scopedSpaces.flatMap(r => r.el && !r.link ? [r.el] : []), where)}
                      disabled={!openCount || scan.state === 'scanning'}
                      title="Adds every room read from the ticked models. Rooms already added keep their names."
                    >
                      Add all ({openCount})
                    </button>
                    <span className="al-sep" aria-hidden="true" />
                    <button className="ds-btn ds-btn-secondary al-small" onClick={() => removeSpaces(addedSpaces, where)} disabled={!addedSpaces.length}
                      title={`Removes every added room ${scopeText} from the heatmap`}>
                      Remove all ({addedSpaces.length})
                    </button>
                    <button className="ds-btn ds-btn-secondary al-small" onClick={() => removeSpaces(missingSpaces, `${where} that are not in the loaded models`)} disabled={!missingSpaces.length}
                      title="Removes the rooms that are not in any loaded model">
                      Remove not in model ({missingSpaces.length})
                    </button>
                  </div>
                )}
                <div className="al-group">
                  <button className="ds-btn ds-btn-secondary al-small" onClick={() => setImportText(importText === null ? '' : null)}>
                    {importText === null ? 'Import' : 'Close import'}
                  </button>
                  <div className="al-export" ref={exportMenu}>
                    <button className="ds-btn ds-btn-secondary al-small" onClick={() => downloadCsv(tabCsv, tabFile)} disabled={!tabCsv.length}>Export CSV</button>
                    <button
                      className="ds-btn ds-btn-secondary al-small al-export-more"
                      onClick={() => setExportOpen(open => !open)}
                      disabled={!links.length}
                      aria-haspopup="menu"
                      aria-expanded={exportOpen}
                      title="Export all, or equipment, cameras, or rooms on their own"
                    >
                      <i className="bx bx-chevron-down" aria-hidden="true" />
                    </button>
                    {exportOpen && (
                      <div className="al-export-menu" role="menu">
                        <button role="menuitem" disabled={!links.length} onClick={() => downloadCsv(links, 'equipment-spaces')}>All ({links.length})</button>
                        <button role="menuitem" disabled={!equipCsv.length} onClick={() => downloadCsv(equipCsv, 'equipment')}>Equipment ({equipCsv.length})</button>
                        <button role="menuitem" disabled={!cameraCsv.length} onClick={() => downloadCsv(cameraCsv, 'cctv')}>CCTV ({cameraCsv.length})</button>
                        <button role="menuitem" disabled={!roomCsv.length} onClick={() => downloadCsv(roomCsv, 'spaces')}>Spaces ({roomCsv.length})</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {importText !== null && (
                <div className="al-import">
                  <textarea
                    value={importText}
                    onChange={e => setImportText(e.target.value)}
                    placeholder={'CSV or JSON: equip,guid,type,finId,element,kind,room,level,clip'}
                  />
                  <div className="al-import-row">
                    <input type="file" accept=".csv,.json,.txt" onChange={e => readFile(e.target.files?.[0])} />
                    <button className="ds-btn ds-btn-primary al-small" onClick={doImport} disabled={!importText.trim()}>Add to links</button>
                  </div>
                </div>
              )}

              <div className="al-search-row al-manual">
                <span className="al-sub">{mode === 'space' ? 'Add a room by GlobalId' : mode === 'cctv' ? 'Add a camera by GlobalId' : 'Add equipment by GlobalId'}</span>
                <input
                  placeholder={mode === 'space' ? 'Heatmap name' : mode === 'cctv' ? 'Camera name' : 'Equipment name'}
                  value={manualName}
                  onChange={e => setManualName(e.target.value)}
                />
                <input placeholder="IFC GlobalId" value={manualGuid} onChange={e => setManualGuid(e.target.value)} />
                <button className="ds-btn ds-btn-secondary al-small" disabled={!manualName.trim() || !isGuid(manualGuid.trim())} onClick={mode === 'space' ? addManualSpace : addManualLink}>Add</button>
              </div>

              {mode !== 'space' && (tabAuto > 0 || tabAutoRooms > 0) && (
                <p className="al-banner">
                  <b>{bannerHead}</b>{' '}
                  Check what is marked in blue, and use Change or the room box on anything wrong. Nothing is kept until you Save.
                  {canUndo && (undo?.auto?.length || undo?.rooms?.length) ? <button className="al-undo" onClick={undoBulk}>Undo</button> : null}
                </p>
              )}
              {notice && (
                <p className="al-notice">
                  {notice}
                  {canUndo && <button className="al-undo" onClick={undoBulk}>Undo</button>}
                </p>
              )}
              {error && <p className="al-error">{error}</p>}

              {mode !== 'space' ? (
                <table className="al-table">
                  <thead>
                    <tr>
                      <th>{mode === 'cctv' ? 'FIN camera' : 'FIN equipment'}</th>
                      <th>Type</th>
                      <th>Model element</th>
                      {mode === 'cctv' && <th>Room</th>}
                      {mode === 'cctv' && <th>Footage</th>}
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupRows(shown, rowLevel).map(g => renderGroup(g.key, mode === 'cctv' ? 7 : 5, g.rows.map(renderLinkRow)))}
                    {!shown.length && (
                      <tr><td colSpan={mode === 'cctv' ? 7 : 5} className="al-sub al-empty">
                        {rows.length
                          ? 'Nothing matches.'
                          : !finConnected
                            ? 'FIN is not connected. Connect to FIN, or import links.'
                            : readingFin
                              ? 'Reading equipment from FIN. The first read can take a few seconds.'
                              : !equipment.length
                                ? 'FIN sent no equipment for this project. Press Reload FIN to ask again.'
                                : mode === 'cctv'
                                  ? 'FIN has no cameras for this project. Add one by name and GlobalId, or import a list. A FIN camera is equipment with the cctv tag.'
                                  : 'FIN has no equipment outside the cameras for this project. Add one by name and GlobalId, or import a list.'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="al-table">
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>FIN sensor or equipment</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupRows(shownSpaces, spaceLevel).map(g => renderGroup(g.key, 4, g.rows.map(renderSpaceRow)))}
                    {!shownSpaces.length && (
                      <tr><td colSpan={4} className="al-sub al-empty">
                        {spaceRows.length
                          ? 'Nothing matches.'
                          : scan.state === 'scanning'
                            ? 'Reading spaces…'
                            : 'No rooms yet. Tick a model, then Scan. Or add a room by its GlobalId above.'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              )}

              {mode === 'cctv' && (
                <datalist id="al-rooms">
                  {spaceLinks.map(l => <option key={l.guid} value={l.guid} label={l.equip} />)}
                </datalist>
              )}
              {mode === 'space' && (
                <datalist id="al-fin-names">
                  {finList.filter(eq => !eq.cctv).map(eq => <option key={eq.finId || eq.name} value={eq.name} />)}
                </datalist>
              )}
              {mode !== 'space' && (
                <>
                  <datalist id="al-types">
                    {KNOWN_TYPES.map(t => <option key={t} value={t} />)}
                  </datalist>
                </>
              )}
            </div>

            <div className="dashboard-settings-footer">
              <span className={`al-dirty ${dirty ? '' : 'al-clean'}`}>{dirty ? 'Unsaved changes' : 'No changes'}</span>
              <button className="ds-btn ds-btn-secondary" onClick={requestClose}>Cancel</button>
              <button className="ds-btn ds-btn-primary" onClick={handleSave} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {confirmClose && (
        <ConfirmDialog
          title="Discard changes?"
          message="The links changed here are not saved. Close without saving?"
          confirmLabel="Discard"
          onConfirm={() => { setConfirmClose(false); onClose() }}
          onCancel={() => setConfirmClose(false)}
        />
      )}
    </>
  )
}
