import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import * as OBC from '@thatopen/components'
import { useProjectStore } from '@/store/useProjectStore'
import { useLoadingProgressStore } from '@/store/useLoadingProgressStore'
import { useAppStore } from '@/store/useAppStore'
import type { RenderSettings } from '@/constants/renderSettings'
import { useModelStore } from '@/store/useModelStore'
import { defaultClip, defaultType, elementLabel, foldName, indexLinks, indexSpaceLinks, isGuid, levelRank, prepareElements, typeWords } from '@/lib/assetLinks'
import { listModelElements } from '@/lib/modelElements'
import type { AssetLink } from '@/types'
import { frameModelFromAbove, resetCameraToHome, tiltIfVertical } from '@/lib/cameraUtils'
import { frameSphereInView } from '@/lib/viewFraming'
import { startPeekFramer } from '@/lib/peekFrame'
import { createMiniMap } from '@/lib/miniMap'
import {
  classifyLoaded, classifyModel, describeModels, describeUnclassified, hasContentProfile, isProjectSwitch, layerIds, layerVisibility,
  onContentProfiles, pruneContentProfiles, setContentProfile, type ContentProfile,
} from '@/lib/layerGroups'
import { runIfcDiagnostics } from '@/lib/ifcDiagnostics' // TEMPORARY, with EKO_IFC_DIAGNOSTICS below
import { HVAC_GENERIC, HVAC_SPECIFIC, floorFilterSkips, isCeilingType, levelHides, reportLevel, type LevelIndex, type MechanicalInfo } from '@/lib/floorPolicy'
import { choosePlate, plateLoops, platePrism, type XzTri } from '@/lib/floorOutline'
import { setHidden, isHidden, onVisibilityApplied } from '@/lib/visibilityCoordinator'
import { measureTool } from '@/lib/measureTool'
import { sliceTool, unwatchClipping, watchClipping } from '@/lib/sliceTool'
import { createFcuSchematic } from '@/lib/fcuSchematic'
import { projectAhuSchematic } from '@/lib/ekoAhuSchematic'
import { projectVavSchematic } from '@/lib/ekoVavSchematic'
import { fahuSchematicFor } from '@/lib/ekoFahuSchematic'
import { createMauSchematic } from '@/lib/mauSchematic'
import { createEcoSchematic } from '@/lib/ecoSchematic'
import { createHvacLabels } from '@/lib/hvacLabels'
import type { HvacSchematic } from '@/lib/hvacGeometry'
import { hospitalHvacEnabled, isLiveSchematic } from '@/lib/hospitalHvac'
import { useFinStore } from '@/store/useFinStore'
import type { ProjectApiSettings } from '@/types'
import { dashboardProjectInfo, meterEquipNames, pointsWithBoards } from '@/lib/finSettings'

import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import { DashboardModelTree } from '@/components/viewer/DashboardModelTree'
import { isJunkStorey } from '@/lib/modelTree'

interface DashboardOverlayProps {
  visible: boolean
  engineRef?: React.MutableRefObject<FragmentsEngine | null>
  /** Flips true once the fragments engine exists. A ref write does not re-render. */
  engineReady?: boolean
}

/* Equipment type (from the project's asset links) -> the internals drawn inside its casing on selection */
const SCHEMATICS: Record<string, (localBox: THREE.Box3, modelMatrix: THREE.Matrix4, casing: THREE.Object3D, hospitalHvac: boolean) => HvacSchematic | null> = {
  FCU:  (box, matrix, casing, hospitalHvac) => createFcuSchematic(box, matrix, casing, { hospitalHvac }),
  // The Eko Hospital's AHU has its own design; every other project keeps the original createAhuSchematic, with its original (flag-off) behaviour
  AHU:  (box, matrix, casing, hospitalHvac) => projectAhuSchematic(hospitalHvac, box, matrix, casing),
  MAHU: (box, matrix, casing) => createMauSchematic(box, matrix, casing),
  ECO:  (box, matrix, casing) => createEcoSchematic(box, matrix, casing),
  // The Eko Hospital's FAHU has its own design; every other project keeps Marsa's createFahuSchematic, called as before
  FAHU: (box, matrix, casing, hospitalHvac) => fahuSchematicFor(hospitalHvac)(box, matrix, casing),
  // No VAV schematic exists for any other project: its Locate in 3D shows the highlight alone, as before
  VAV:  (box, matrix, casing, hospitalHvac) => projectVavSchematic(hospitalHvac, box, matrix, casing),
}

/* Types whose internals are driven by live FIN points (fan, coil, damper, filter, UV state) are listed in isLiveSchematic.
   A point FIN does not send shows the no-data grey, never a guessed off/clean. The AHU is live, and the AHU and FCU carry
   the Hospital's extra sensors, only in a project that turned Hospital HVAC graphics on (hospitalHvacEnabled): every
   other project draws them as it always did. */

function loadScripts(scripts: HTMLScriptElement[], signal: { mounted: boolean }) {
  return scripts.reduce<Promise<void>>((prev, s) => prev.then(() => new Promise((resolve) => {
    if (!signal.mounted) { resolve(); return }
    if (s.src) {
      const script = document.createElement('script')
      try {
        const url = new URL(s.src)
        url.searchParams.set('v', Date.now().toString())
        script.src = url.toString()
      } catch {
        script.src = s.src + (s.src.includes('?') ? '&' : '?') + 'v=' + Date.now()
      }
      script.async = false
      script.className = 'dt-dashboard-injected'
      script.onload = () => resolve()
      script.onerror = () => resolve()
      document.body.appendChild(script)
    } else {
      try { window.eval(s.innerHTML) } catch (err) { console.error(err) }
      resolve()
    }
  })), Promise.resolve())
}

export function DashboardOverlay({ visible, engineRef, engineReady = false }: DashboardOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const labelHostRef = useRef<HTMLDivElement>(null)
  const savedSettings = useRef<object | undefined>(undefined)
  const currentProject = useProjectStore(s => s.currentProject)
  const templateId = useAppStore(s => s.templateId)
  const xrayColor = useAppStore(s => s.xrayColor)

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('viewer-state-sync', {
      detail: { templateId, xrayColor }
    }))
  }, [templateId, xrayColor])

  useEffect(() => {
    const engine = engineRef?.current
    if (!engine || !engineReady) return

    const HEALTHY = new THREE.Color(0x22c55e)
    const ALARM = new THREE.Color(0xef4444)
    const AMBER = new THREE.Color(0xf59e0b)

    /* One entry per located BIM element. The box is kept in the model's LOCAL
       space and re-transformed by the live matrixWorld on every use, so a model
       that is moved/centred after lookup never leaves its markers behind. */
    interface Located { model: any; localId: number; localBox: THREE.Box3 }
    const located = new Map<string, Located>()
    const pending = new Map<string, Promise<Located | null>>()
    const missing = new Set<string>()           // answered "not in any model" by every model
    /* A null answer before the worker has indexed GUIDs is not a real miss.
       The exported viewer asks immediately, while models are still loading.
       Cache a miss only after one GUID has been found, or after several
       quiet passes with a stable model list. */
    let indexProven = false
    let barrenPasses = 0
    /* The one highlighted equipment and the state it was drawn for */
    let colored: { bimId: string; tone: 'alarm' | 'healthy' | 'amber' } | null = null
    let highlightSeq = 0
    /* Brief Show in the model: asset colour, the style from before the locate, its floor outline */
    let focusColour: THREE.Color | null = null
    let focusPrev: Pick<RenderSettings, 'templateId' | 'realisticMode' | 'renderLite'> | null = null
    let focusDock: string | null = null
    let floorOutline: THREE.LineSegments | null = null

    const normAssetId = (id: string) => (id.startsWith('ast-') ? id.substring(4) : id)
    const fold = foldName
    // Read from the open project on use, so links saved in Equipment & Spaces apply without a reload
    let linkSrc: AssetLink[] | undefined | null = null
    let linkIdx = indexLinks(undefined)
    const links = () => {
      const src = useProjectStore.getState().currentProject?.assetLinks
      if (src !== linkSrc) {
        linkSrc = src
        linkIdx = indexLinks(src)
      }
      return linkIdx
    }
    const linkFor = (assetId?: string | null) => (assetId ? links().byFold.get(fold(assetId)) : undefined)

    // The loaded model's CCTV elements and every equipment element's storey, read once per set of files
    type CameraScan = { sig: string; cams: { guid: string; name: string; storey: string }[]; storeyOf: Map<string, string> }
    let cameraScan: { sig: string; done: CameraScan | null } | null = null
    const storeyCode = (level?: string) => {
      const rank = levelRank(level ?? '')
      return Number.isInteger(rank) && rank >= 0 && rank < 100 ? `L${rank}` : ''
    }
    const scanCameras = (): CameraScan | null => {
      const list = engine?.fragments?.models?.list
      if (!engine || !list?.size || useLoadingProgressStore.getState().sessionActive) return null
      const sig = [...list.keys()].join('|')
      if (cameraScan?.sig === sig) return cameraScan.done
      const scan: { sig: string; done: CameraScan | null } = { sig, done: null }
      cameraScan = scan
      const words = typeWords('CCTV')
      listModelElements(engine, 'equip').then(found => {
        if (cameraScan !== scan) return
        const prepared = prepareElements(found)
        scan.done = {
          sig,
          cams: prepared.filter(p => words.some(w => p.hay.includes(` ${w} `))).map(p => ({ guid: p.el.guid, name: elementLabel(p.el), storey: storeyCode(p.el.level) })),
          storeyOf: new Map(prepared.map(p => [p.el.guid, storeyCode(p.el.level)])),
        }
        try { (window as { EKO?: { set?: (patch: object) => void } }).EKO?.set?.({}) } catch { /* the dashboard redraws on its next refresh */ }
      }, () => { if (cameraScan === scan) cameraScan = null })
      return null
    }

    let setupMemo: { links: unknown; source: string; scan: unknown; value: object } | null = null
    const cameraSetup = () => {
      const project = useProjectStore.getState().currentProject
      const links = project?.assetLinks ?? []
      const source = project?.apiSettings?.dashboardCameraSource === 'model' ? 'model' : 'fin'
      const scan = scanCameras()
      if (setupMemo && setupMemo.links === links && setupMemo.source === source && setupMemo.scan === scan) return setupMemo.value
      const rooms = new Map(links.filter(l => l.kind === 'space').map(l => [l.guid, l.equip]))
      const cameras = source === 'model'
        ? (scan?.cams ?? []).map(c => ({ name: c.name, guid: c.guid, room: '', storey: c.storey, clip: defaultClip(c.name) }))
        : links.filter(l => l.kind === 'cctv' && isGuid(l.guid)).map(l => ({
          name: l.equip,
          guid: l.guid,
          room: l.room ? rooms.get(l.room) ?? '' : '',
          storey: scan?.storeyOf.get(l.guid) ?? '',
          clip: l.clip || defaultClip(l.equip),
        }))
      cameras.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      const value = { source, cameras }
      setupMemo = { links, source, scan, value }
      return value
    }

    /* Asset id (with or without the ast- prefix) -> IFC GUID, or null.
       The project's asset link wins over whatever id the live feed carries. */
    const bimIdFor = (assetId?: string | null): string | null => {
      if (!assetId) return null
      const norm = normAssetId(assetId)
      const mapped = linkFor(assetId)?.guid
      if (mapped) return mapped
      const assets: any[] = (window as any).EKO?.data?.assets || []
      const asset = assets.find(a => a.id === assetId || normAssetId(a.id || '') === norm)
      // Simulation engine assets name their element (gid) or room (roomGid) instead of bimId
      return [asset?.bimId, asset?.gid, asset?.roomGid].find(isGuid) || null
    }

    /* Accepts an asset id or a raw IFC GUID */
    const toBimId = (idOrBimId?: string | null) => bimIdFor(idOrBimId) || (isGuid(idOrBimId) ? idOrBimId : null)

    const locate = (bimId: string): Promise<Located | null> => {
      const hit = located.get(bimId)
      if (hit) return Promise.resolve(hit)
      if (missing.has(bimId)) return Promise.resolve(null)
      const inFlight = pending.get(bimId)
      if (inFlight) return inFlight
      const job = (async () => {
        const models = engine?.fragments?.models?.list
        if (!models || models.size === 0) return null   // models not loaded yet: retry later
        let failed = false
        for (const [, model] of models.entries()) {
          const m = model as any
          if (typeof m.getLocalIdsByGuids !== 'function') continue
          try {
            const [localId] = await m.getLocalIdsByGuids([bimId])
            if (localId == null) continue
            // getMergedBox bakes in matrixWorld as it stands when the reply
            // lands; un-bake with that same matrix (no update in between)
            m.object.updateMatrixWorld(true)
            const worldBox: THREE.Box3 = await m.getMergedBox([localId])
            if (!worldBox || worldBox.isEmpty()) continue
            const localBox = worldBox.clone().applyMatrix4(m.object.matrixWorld.clone().invert())
            const entry = { model: m, localId, localBox }
            located.set(bimId, entry)
            indexProven = true
            return entry
          } catch (e) {
            // A model that is still registering with the worker rejects:
            // not a "no", so this GUID must be asked again later
            failed = true
          }
        }
        if (!failed && (indexProven || barrenPasses >= 8)) missing.add(bimId)
        return null
      })().finally(() => pending.delete(bimId))
      pending.set(bimId, job)
      return job
    }

    /* Which saved rooms the model files on this storey. One storey, not every room. */
    const guidFloor = new Map<string, string>()
    /* A floor with none of the rooms is kept too, or every repaint reads all its elements again */
    const floorRooms = new Map<string, { want: string; guids: Set<string> }>()
    const guidsForFloor = async (levelId: string, wanted: Set<string>) => {
      const out = new Set<string>()
      if (!levelId || levelId === 'ALL' || !wanted.size || !engine?.fragments?.models?.list) return out
      const want = [...wanted].sort().join(',')
      const cached = floorRooms.get(levelId)
      if (cached && cached.want === want) return new Set(cached.guids)
      const models = [...engine.fragments.models.list.values()]
      models.sort((a, b) => {
        const rec = (m: any) => useModelStore.getState().models.find(r => r.modelId === m.modelId)
        const space = (m: any) => rec(m) && classifyLoaded(rec(m)!).group === 'spaces' ? 0 : 1
        return space(a) - space(b)
      })
      let read = false
      for (const model of models) {
        const m = model as any
        if (typeof m.getRelations !== 'function' || typeof m.getGuidsByLocalIds !== 'function') continue
        const storeys = (await readStoreys(m)).filter(s => s.floor.id === levelId)
        if (!storeys.length) continue
        const rels = relationData(await m.getRelations(storeys.map(s => s.localId)))
        const ids: number[] = []
        /* Elements are contained in a storey (IfcRelContainedInSpatialStructure); rooms are usually aggregated to it (IfcRelAggregates) */
        for (const s of storeys) {
          const rel = rels.get(s.localId)
          for (const id of [...(rel?.ContainsElements || []), ...(rel?.IsDecomposedBy || [])]) ids.push(id)
        }
        if (!ids.length) continue
        read = true
        const guids: Array<string | null> = await m.getGuidsByLocalIds(ids)
        guids.forEach(g => {
          if (!g || !wanted.has(g)) return
          out.add(g)
          guidFloor.set(g, levelId)
        })
        if (out.size) break
      }
      if (out.size || read) floorRooms.set(levelId, { want, guids: new Set(out) })
      return out
    }

    /* Saved rooms: one guid lookup and one box read per model, not one mesh per room. */
    const locateMany = async (guids: string[]) => {
      const need = [...new Set(guids.filter(id => isGuid(id) && !located.has(id) && !missing.has(id)))]
      if (!need.length || !engine?.fragments?.models?.list) return
      let left = new Set(need)
      for (const model of engine.fragments.models.list.values()) {
        if (!left.size) break
        const m = model as any
        if (typeof m.getLocalIdsByGuids !== 'function') continue
        const ask = [...left]
        let localIds: Array<number | null> = []
        try { localIds = await m.getLocalIdsByGuids(ask) } catch { continue }
        const found: { guid: string; localId: number }[] = []
        localIds.forEach((id, i) => {
          if (id == null) return
          found.push({ guid: ask[i], localId: id })
          left.delete(ask[i])
        })
        if (!found.length || typeof m.getBoxes !== 'function') continue
        m.object.updateMatrixWorld(true)
        let boxes: THREE.Box3[] = []
        try { boxes = await m.getBoxes(found.map(item => item.localId)) } catch { boxes = [] }
        const inv = m.object.matrixWorld.clone().invert()
        found.forEach((item, i) => {
          const worldBox = boxes[i]
          if (!worldBox || worldBox.isEmpty()) return
          located.set(item.guid, { model: m, localId: item.localId, localBox: worldBox.clone().applyMatrix4(inv) })
          indexProven = true
        })
      }
    }

    const worldBoxOf = (entry: Located) => entry.localBox.clone().applyMatrix4(entry.model.object.matrixWorld)

    const repositionMarkers = () => {
      const eko = (window as any).EKO
      if (eko && typeof (window as any).EKO_V?.schedulePosition === 'function') {
        (window as any).EKO_V.schedulePosition(eko)
      }
    }

    /* Synchronous: the located entry if known, otherwise starts the lookup and
       re-projects the markers once it lands. */
    const locatedNow = (bimId: string): Located | null => {
      const entry = located.get(bimId)
      if (entry) return entry
      if (!missing.has(bimId) && !pending.has(bimId)) {
        locate(bimId).then(e => { if (e) repositionMarkers() })
      }
      return null
    }

    // Whether a loaded model holds the asset's element; a first ask looks it up and redraws once found
    let foundRedraw = 0
    const inModel = (assetId?: string | null): boolean => {
      const bimId = toBimId(assetId)
      if (!bimId) return false
      if (located.has(bimId)) return true
      if (!missing.has(bimId) && !pending.has(bimId)) {
        void locate(bimId).then(e => {
          if (!e || foundRedraw) return
          foundRedraw = window.setTimeout(() => {
            foundRedraw = 0
            try { (window as { EKO?: { set?: (patch: object) => void } }).EKO?.set?.({}) } catch { /* the dashboard redraws on its next refresh */ }
          }, 50)
        })
      }
      return false
    }

    /* ONE alarm rule for the dot colour and the model colour: any alarm on an
       asset mapped to this element, or any register row on it in alarm. */
    const isAlarmed = (bimId: string) => {
      const data = (window as any).EKO?.data || {}
      const onThis = (assetId?: string) => !!assetId && bimIdFor(assetId) === bimId
      return (data.alarms || []).some((a: any) => onThis(a.asset) || a.bimId === bimId)
        || (data.assets || []).some((a: any) => onThis(a.id) && a.st === 'alarm')
    }

    /* The selected equipment's highlight: a see-through, shaded volume with its
       edges, green or red. It lives in a scene of its own that is drawn AFTER
       the viewer style has finished the picture, so no style (its lights,
       occlusion, ink, grade, tone mapping, x-ray) changes how it looks, and
       with the depth cleared first it shows through walls, pipes and slabs.
       The heatmap is the exception: it is drawn against the building's depth,
       so a wall in front of a room covers the colour. The model's own
       materials are left alone. */
    const heatRoots = new Map<any, THREE.Group>()
    const overlay = new THREE.Scene()
    // Standard-material parts need lights. The ghost shader ignores them.
    const fcuHemi = new THREE.HemisphereLight(0xf5f7fa, 0x7d858f, 0.42)
    const fcuKey = new THREE.DirectionalLight(0xfff4ea, 1.55)
    const fcuFill = new THREE.DirectionalLight(0xd7e0ea, 0.38)
    const fcuAim = new THREE.Object3D()
    const fcuAim2 = new THREE.Object3D()
    fcuKey.target = fcuAim
    fcuFill.target = fcuAim2
    fcuKey.castShadow = false
    fcuFill.castShadow = false
    overlay.add(fcuHemi, fcuKey, fcuFill, fcuAim, fcuAim2)
    /* The selected equipment's point labels (name + live text on each anchor of its schematic), in the layer under the
       dashboard; the dashboard's own eye control (EKO.state.eqLabelsOn, per session) shows or hides them */
    const labels = createHvacLabels(() => labelHostRef.current)
    const labelsOn = () => (window as any).EKO?.state?.eqLabelsOn !== false
    const fcuAt = new THREE.Vector3()
    const fcuCam = new THREE.Vector3()
    const fcuRight = new THREE.Vector3()
    const fcuUp = new THREE.Vector3(0, 1, 0)
    let fcuEnv: THREE.Texture | null = null
    try {
      const pmrem = new THREE.PMREMGenerator(engine.world.renderer.three)
      const room = new RoomEnvironment()
      fcuEnv = pmrem.fromScene(room, 0.04).texture
      overlay.environment = fcuEnv
      overlay.environmentIntensity = 0.72
      room.dispose()
      pmrem.dispose()
    } catch { /* the three lights above still shade the parts */ }
    // The nearest surface only: a depth-only pass, then the fill and edges on it
    const ghostDepth = new THREE.MeshBasicMaterial({
      colorWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    })
    /* Depth stand-in for the building while the heatmap is drawn. The style's
       last pass is a fullscreen quad on the near plane, so the canvas depth
       cannot be used as-is: testing against it hides the rooms, and clearing
       it lets the colour through the walls. */
    const heatOccluder = new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide,
    })
    watchClipping(heatOccluder)
    const coverCorner = new THREE.Vector3()
    const coverCache = new WeakMap<object, boolean>()
    /* A faded ceiling is a thin flat plate, so the solid test above skips it.
       It still has to cover the glow. A duct is thin in one direction only. */
    const horizontalCover = (obj: THREE.Mesh) => {
      const geom = obj.geometry as THREE.BufferGeometry | undefined
      if (!geom) return false
      if (!geom.boundingBox) geom.computeBoundingBox()
      const bb = geom.boundingBox
      if (!bb) return false
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) for (let zi = 0; zi < 2; zi++) {
        coverCorner.set(xi ? bb.max.x : bb.min.x, yi ? bb.max.y : bb.min.y, zi ? bb.max.z : bb.min.z)
        coverCorner.applyMatrix4(obj.matrixWorld)
        if (coverCorner.x < minX) minX = coverCorner.x
        if (coverCorner.x > maxX) maxX = coverCorner.x
        if (coverCorner.y < minY) minY = coverCorner.y
        if (coverCorner.y > maxY) maxY = coverCorner.y
        if (coverCorner.z < minZ) minZ = coverCorner.z
        if (coverCorner.z > maxZ) maxZ = coverCorner.z
      }
      const h = maxY - minY
      const w = maxX - minX
      const d = maxZ - minZ
      return h < 0.55 && w > 1.5 && d > 1.5 && h < Math.min(w, d) * 0.22
    }
    const cachedCover = (obj: THREE.Mesh) => {
      const known = coverCache.get(obj)
      if (known != null) return known
      const hit = horizontalCover(obj)
      coverCache.set(obj, hit)
      return hit
    }
    // Flat-shaded towards the camera (face normals from screen derivatives), so
    // the shape reads the same whatever lights the style has
    const ghostFill = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0.6 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        #include <clipping_planes_pars_vertex>
        varying vec3 vView;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vView = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <clipping_planes_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec3 vView;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        #include <clipping_planes_pars_fragment>
        void main() {
          #include <clipping_planes_fragment>
          #include <logdepthbuf_fragment>
          vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
          float facing = abs(dot(n, normalize(vView)));
          gl_FragColor = vec4(uColor * (0.55 + 0.45 * facing), uOpacity);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, clipping: true,
    })
    const ghostEdge = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false })
    watchClipping(ghostDepth)
    watchClipping(ghostFill)
    watchClipping(ghostEdge)
    let ghost: { group: THREE.Group; model: any } | null = null
    // X-ray: alarmed equipment glows red, drawn in the selection highlight's pass
    const alarmFill = ghostFill.clone()
    alarmFill.uniforms.uColor.value.copy(ALARM)
    alarmFill.uniforms.uOpacity.value = 0.5
    const alarmEdge = new THREE.LineBasicMaterial({ color: ALARM, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false })
    watchClipping(alarmFill)
    watchClipping(alarmEdge)
    const alarmGlow = new Map<string, { group: THREE.Group; model: any; localId: number; edges: THREE.BufferGeometry[] }>()
    let alarmSeq = 0
    // Items hidden by the Levels filter, per model
    const levelHidden = new WeakMap<object, Set<number>>()
    type Internals = { assetId: string; type: string }
    /* Read from the open project on use: a project that is switched or saved while something is selected is rebuilt by the
       dashboard effect's cleanup, so a selection never mixes two projects' settings. */
    const hospitalHvac = () => hospitalHvacEnabled(useProjectStore.getState().currentProject)
    let active: (Internals & { schematic: HvacSchematic; bimId: string; last: number; synced: number; live: boolean }) | null = null
    /* The asset whose internals to draw: the asked one if its type has a
       schematic, else any linked asset on the same element that has one. */
    const internalsFor = (asked: string, bimId: string): Internals | null => {
      const rec = linkFor(asked)
      if (rec && SCHEMATICS[rec.type]) return { assetId: normAssetId(asked), type: rec.type }
      const hit = links().list.find(m => m.guid === bimId && SCHEMATICS[m.type])
      if (hit) return { assetId: hit.equip, type: hit.type }
      if (!hospitalHvac()) return null
      /* Eko Hospital: a link saved with the type of the name's first letters ("HOSPITAL" for HOSPITAL_AHU_01) still draws the AHU or
         FCU its name says it is, as a link made now would be typed */
      const names = [rec?.equip, isGuid(asked) ? null : asked, ...links().list.filter(m => m.guid === bimId).map(m => m.equip)]
      for (const name of names) {
        if (!name) continue
        const type = defaultType({ name: normAssetId(name) }, true)
        if (SCHEMATICS[type]) return { assetId: normAssetId(name), type }
      }
      return null
    }
    const pointsFor = (assetId: string, bimId: string) => {
      const want = fold(assetId)
      const lists: any[] = []
      // The dashboard's data layer re-reads equipment every 30 s; the FIN store only once after sign-in, so it is the fallback
      // DashboardData outlives the dashboard that started it until the next one rebinds it: a feed that belongs to another FIN project is not this one's
      const feed = (window as any).DashboardData
      const feedProject = String(feed?.config?.project ?? '').trim().toLowerCase()
      const openProject = String(useProjectStore.getState().currentProject?.apiSettings?.finProjectName ?? '').trim().toLowerCase()
      const dash = feedProject && openProject && feedProject !== openProject ? null : feed?.equipment
      if (Array.isArray(dash)) lists.push(dash)
      else if (Array.isArray(dash?.equipment)) lists.push(dash.equipment)
      const fin = useFinStore.getState().equipment
      if (Array.isArray(fin)) lists.push(fin)
      for (const list of lists) {
        const eq = list.find((e: any) => e && (e.bimId === bimId || fold(String(e.name || '')) === want))
        if (eq?.points?.length) return eq.points
      }
      return []
    }
    const tintGhost = (tone: 'alarm' | 'healthy' | 'amber') => {
      const c = focusColour || (tone === 'alarm' ? ALARM : tone === 'amber' ? AMBER : HEALTHY)
      ghostFill.uniforms.uColor.value.copy(c)
      ghostEdge.color.copy(c).multiplyScalar(0.45)   // a darker line of the same hue reads on light and dark styles
    }
    const removeGhost = () => {
      labels.clear()
      if (active) {
        active.schematic.dispose()
        active = null
      }
      ghostFill.uniforms.uOpacity.value = 0.6
      if (!ghost) return
      ghost.group.removeFromParent()
      ghost.group.traverse((o: any) => o.geometry?.dispose())
      ghost = null
    }
    const drawGhost = () => {
      labels.setVisible(!!(ghost && ghost.group.visible && active && labelsOn()))
      const hasHeat = heatRoots.size > 0 || alarmGlow.size > 0 || !!crowdMesh
      if ((!ghost || !ghost.group.visible) && !hasHeat && !floorOutline) return
      // The selected equipment's internals, while its highlight is on screen
      const shown = ghost && ghost.group.visible ? active : null
      if (shown) {
        const now = performance.now()
        const dt = Math.min(0.05, (now - shown.last) / 1000)
        shown.last = now
        shown.schematic.tick(dt)
        if (shown.live && now - shown.synced > 400) {
          shown.synced = now
          labels.setReading(shown.schematic.apply(pointsFor(shown.assetId, shown.bimId)))
        }
      }
      const renderer = engine.world?.renderer?.three
      const camera = engine.world?.camera?.three
      if (!renderer || !camera) return
      if (shown) {
        if (shown.live && labelsOn()) labels.update(camera, renderer.domElement.getBoundingClientRect())
        shown.schematic.group.getWorldPosition(fcuAt)
        fcuCam.copy(camera.position).sub(fcuAt)
        if (fcuCam.lengthSq() < 1e-8) fcuCam.set(0, 0.4, 1)
        fcuCam.normalize()
        fcuRight.crossVectors(fcuCam, fcuUp)
        if (fcuRight.lengthSq() < 1e-6) fcuRight.set(1, 0, 0)
        else fcuRight.normalize()
        fcuKey.position.copy(fcuAt).addScaledVector(fcuCam, 1.4).addScaledVector(fcuUp, 0.9).addScaledVector(fcuRight, 0.7)
        fcuAim.position.copy(fcuAt)
        fcuFill.position.copy(fcuAt).addScaledVector(fcuCam, 0.5).addScaledVector(fcuRight, -1.1).addScaledVector(fcuUp, -0.15)
        fcuAim2.position.copy(fcuAt)
        fcuAim.updateMatrixWorld()
        fcuAim2.updateMatrixWorld()
      }
      const autoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.setRenderTarget(null)
      const shadowAuto = renderer.shadowMap.autoUpdate
      renderer.shadowMap.autoUpdate = false
      const heatGroups: THREE.Object3D[] = []
      heatRoots.forEach(root => { if (root.children.length) heatGroups.push(root) })
      // Occupancy colours no room, so its people and their glow are drawn in the heat pass, behind the building
      if (crowdMesh) heatGroups.push(crowdMesh)
      if (crowdGlowMesh) heatGroups.push(crowdGlowMesh)
      const seeThrough: THREE.Object3D[] = []
      if (ghost?.group) seeThrough.push(ghost.group)
      if (floorOutline) seeThrough.push(floorOutline)
      alarmGlow.forEach(rec => seeThrough.push(rec.group))
      const heatDrawn = heatGroups.some(g => g.visible)
      const ghostDrawn = seeThrough.some(g => g.visible)
      try {
        /* The building covers the colour the same way a floor pick does, ceiling included, also while the camera moves */
        if (heatDrawn && engine.world?.scene?.three) {
          const scene = engine.world.scene.three
          const hidden: THREE.Object3D[] = []
          const prevOverride = scene.overrideMaterial
          const prevBackground = scene.background
          const savedSee = seeThrough.map(g => g.visible)
          seeThrough.forEach(g => { g.visible = false })
          try {
            /* The rooms being coloured do not cover their own colour */
            heatRoots.forEach((_root, model) => {
              const obj = model?.object
              if (obj?.visible) { obj.visible = false; hidden.push(obj) }
            })
            scene.traverse((obj: any) => {
              if (!obj.visible) return
              if (obj.name === 'ShadowCatcherPlane' || obj.name === 'eko-slices') {
                obj.visible = false
                hidden.push(obj)
                return
              }
              if (!obj.isMesh) return
              const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
              const solid = mats.some((m: any) =>
                m && m.visible !== false && m.colorWrite !== false
                && !(typeof m.opacity === 'number' && m.opacity < 0.5)
                && !(m.transparent && m.depthWrite === false)
              )
              const fadedPlate = !!crowdGlowMesh && mats.some((m: any) =>
                m && typeof m.opacity === 'number' && m.opacity >= 0.15 && m.opacity < 0.5
              ) && cachedCover(obj)
              if (!solid && !fadedPlate) {
                obj.visible = false
                hidden.push(obj)
              }
            })
            scene.overrideMaterial = heatOccluder
            scene.background = null
            renderer.clearDepth()
            renderer.render(scene, camera)
            renderer.render(overlay, camera)
          } finally {
            scene.overrideMaterial = prevOverride
            scene.background = prevBackground
            for (const obj of hidden) obj.visible = true
            seeThrough.forEach((g, i) => { g.visible = savedSee[i] })
          }
        }
        if (ghostDrawn) {
          const savedHeat = heatGroups.map(g => g.visible)
          heatGroups.forEach(g => { g.visible = false })
          try {
            renderer.clearDepth()
            renderer.render(overlay, camera)
          } finally {
            heatGroups.forEach((g, i) => { g.visible = savedHeat[i] })
          }
        }
      } finally {
        renderer.shadowMap.autoUpdate = shadowAuto
        renderer.autoClear = autoClear
      }
    }
    let stepCrowd = () => {}
    const syncGhost = () => {
      if (ghost) {
        ghost.group.matrix.copy(ghost.model.object.matrixWorld)
        ghost.group.matrixWorldNeedsUpdate = true
        ghost.group.visible = ghost.model.object.visible !== false
      }
      heatRoots.forEach((root, model) => {
        if (!model?.object) return
        root.matrix.copy(model.object.matrixWorld)
        root.matrixWorldNeedsUpdate = true
        root.visible = model.object.visible !== false
      })
      syncHeatClip()
      // The selected equipment already has its own highlight
      alarmGlow.forEach((rec, bimId) => {
        rec.group.matrix.copy(rec.model.object.matrixWorld)
        rec.group.matrixWorldNeedsUpdate = true
        rec.group.visible = rec.model.object.visible !== false && colored?.bimId !== bimId
          && !levelHidden.get(rec.model)?.has(rec.localId) && !isHidden(rec.model, rec.localId)
      })
      stepCrowd()
    }
    const mountInternals = (group: THREE.Group, entry: Located, internals: Internals, bimId: string) => {
      const hospital = hospitalHvac()
      const schematic = SCHEMATICS[internals.type](entry.localBox, entry.model.object.matrixWorld, group, hospital)
      if (!schematic) return
      group.add(schematic.group)
      group.traverse((o) => {
        if (o.userData?.ekoGhostDepth) o.visible = false
      })
      ghostFill.uniforms.uOpacity.value = 0.22
      const live = isLiveSchematic(internals.type, hospital)
      active = { ...internals, schematic, bimId, last: performance.now(), synced: 0, live }
      if (live) labels.show(schematic, schematic.apply(pointsFor(internals.assetId, bimId)))
    }
    const buildGhost = async (entry: Located, bimId: string, seq: number, internals: Internals | null) => {
      let meshes: any[][] = []
      try { meshes = await entry.model.getItemsGeometry([entry.localId]) } catch { return }
      if (seq !== highlightSeq || colored?.bimId !== bimId) return   // a newer selection won
      const group = new THREE.Group()
      group.matrixAutoUpdate = false
      for (const item of meshes || []) {
        for (const g of item || []) {
          if (!g?.positions || !g.indices) continue
          const geom = new THREE.BufferGeometry()
          geom.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3))
          geom.setIndex(Array.from(g.indices as ArrayLike<number>))
          const t = g.transform instanceof THREE.Matrix4 ? g.transform
            : new THREE.Matrix4().fromArray(g.transform?.elements ?? g.transform ?? new THREE.Matrix4().elements)
          const depth = new THREE.Mesh(geom, ghostDepth)
          const fill = new THREE.Mesh(geom, ghostFill)
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 25), ghostEdge)
          depth.userData.ekoGhostDepth = true
          depth.renderOrder = 0
          fill.renderOrder = 1
          edges.renderOrder = 2
          for (const o of [depth, fill, edges]) o.applyMatrix4(t)
          if (!group.userData.meshTransform) {
            group.userData.meshTransform = t.clone()
          }
          group.add(depth, fill, edges)
        }
      }
      if (!group.children.length) return
      removeGhost()
      ghost = { group, model: entry.model }
      syncGhost()
      overlay.add(group)
      if (seq === highlightSeq && colored?.bimId === bimId) {
        if (internals) mountInternals(group, entry, internals, bimId)
      }
    }

    /* Equipment is green or red. Anything else stays amber. */
    const isEquipment = (asked: string, bimId: string) => {
      if (linkFor(asked) || links().list.some(m => m.guid === bimId)) return true
      const assets: any[] = (window as any).EKO?.data?.assets || []
      return assets.some(a => a.id === asked || bimIdFor(a.id) === bimId)
    }
    const toneFor = (asked: string, bimId: string): 'alarm' | 'healthy' | 'amber' => {
      if (!isEquipment(asked, bimId)) return 'amber'
      return isAlarmed(bimId) ? 'alarm' : 'healthy'
    }

    /* Keeps an equipment highlight in step with live alarm state (green <-> red) */
    const syncColour = () => {
      const c = colored
      if (!c || c.tone === 'amber') return
      const tone = isAlarmed(c.bimId) ? 'alarm' : 'healthy'
      if (tone === c.tone) return
      c.tone = tone
      tintGhost(tone)
    }

    /* Stamps asset/alarm objects with their IFC GUID and locates them in the
       model. Runs on every data refresh (data-map.js calls it), since a refresh
       replaces the objects and drops the stamp. */
    const resolveAllAssetPositions = async () => {
      const data = (window as any).EKO?.data
      if (!data) return
      let any = false
      for (const asset of data.assets || []) {
        const bimId = bimIdFor(asset.id)
        if (!bimId) continue
        asset.bimId = bimId
        if (await locate(bimId)) any = true
      }
      for (const alarm of data.alarms || []) {
        const bimId = bimIdFor(alarm.asset) || (isGuid(alarm.bimId) ? alarm.bimId : null)
        if (!bimId) continue
        alarm.bimId = bimId
        if (await locate(bimId)) any = true
      }
      if (any) repositionMarkers()
      syncColour()
      void syncAlarmGlow()
    }

    /* Canvas + host rects, read once per synchronous projection pass (viewer.js
       projects every marker in one go) instead of twice per marker. */
    let passRects: { cr: DOMRect; hr: DOMRect } | null = null
    const rects = () => {
      if (!passRects) {
        const cr = engine.world.renderer.three.domElement.getBoundingClientRect()
        const host = document.getElementById('enginehost')
        passRects = { cr, hr: host ? host.getBoundingClientRect() : cr }
        queueMicrotask(() => { passRects = null })
      }
      return passRects
    }

    const HIDDEN = { x: 0, y: 0, visible: false }

    const projectPoint = (point: { x?: number; y?: number; z?: number; bimId?: string; asset?: string; alarm?: string }) => {
      const camera = engine?.world?.camera?.three
      if (!camera) return null
      // Not an equipment point (e.g. a PMU chip): leave it to the adapter's 2D fallback
      if (!point.asset && !point.bimId && !point.alarm) return null

      let bimId = toBimId(point.asset) || (isGuid(point.bimId) ? point.bimId : null)
      if (!bimId && point.alarm) {
        const al = (window as any).EKO?.data?.alarms?.find((a: any) => a.id === point.alarm)
        bimId = toBimId(al?.asset) || (isGuid(al?.bimId) ? al.bimId : null)
      }
      // Only equipment found in the model gets a marker: anything else has no
      // real position and would float at an arbitrary spot.
      if (!bimId) return HIDDEN
      const entry = locatedNow(bimId)
      if (!entry || entry.model.object?.visible === false) return HIDDEN   // unknown, or its model is isolated away

      const world = worldBoxOf(entry).getCenter(new THREE.Vector3())
      camera.updateMatrixWorld()
      const v = world.project(camera)
      const inFrustum = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1

      // NDC -> the canvas's on-screen CSS box. getBoundingClientRect is what the
      // browser actually displays, independent of devicePixelRatio.
      const { cr, hr } = rects()
      if (cr.width < 2 || cr.height < 2) return HIDDEN
      const pageX = cr.left + (v.x * 0.5 + 0.5) * cr.width
      const pageY = cr.top + (-v.y * 0.5 + 0.5) * cr.height

      // viewer.js expects coordinates relative to #enginehost
      return { x: pageX - hr.left, y: pageY - hr.top, visible: inFrustum }
    }

    const clearHighlight = async () => {
      highlightSeq++                      // cancels a highlight still in flight
      colored = null
      removeGhost()
    }

    /* Equipment is red in alarm and green when healthy. Any other object
       is amber. Rapid clicks: only the latest one wins. */
    const highlightAsset = async (assetIdOrBimId: string) => {
      const seq = ++highlightSeq
      const bimId = toBimId(assetIdOrBimId)
      const internals = bimId ? internalsFor(assetIdOrBimId, bimId) : null
      if (colored && colored.bimId === bimId && ghost) {
        syncColour()
        if (active && internals && active.live) labels.setReading(active.schematic.apply(pointsFor(internals.assetId, bimId)))
        return true
      }
      colored = null
      removeGhost()
      const entry = bimId ? await locate(bimId) : null
      if (seq !== highlightSeq || !bimId || !entry) return false
      const tone = toneFor(assetIdOrBimId, bimId)
      colored = { bimId, tone }
      tintGhost(tone)
      await buildGhost(entry, bimId, seq, internals)
      return seq === highlightSeq && !!ghost
    }

    /* Moves the camera only; colouring follows the dashboard's selection. */
    /* The canvas fills the window and the dashboard covers most of it: the part of the canvas the user sees is
       the dashboard's own model area (#vpmain: the register's strip, or the Overview's viewer beside its panel).
       null when there is no such area, or it is the whole canvas. */
    const visibleView = () => {
      const el = engine?.world?.renderer?.three?.domElement as HTMLElement | undefined
      const vp = document.getElementById('vpmain')
      if (!el || !vp || !vp.getClientRects().length) return null
      const c = el.getBoundingClientRect(), v = vp.getBoundingClientRect()
      let x = Math.max(c.left, v.left)
      const y = Math.max(c.top, v.top)
      // Locate in 3D on the register keeps the Assets Overview (#ovp) over the model's left: what it covers is not visible
      const ovp = (window as any).EKO?.state?.locFocus ? document.getElementById('ovp') : null
      if (ovp && ovp.getClientRects().length && ovp.getAttribute('data-min') !== '1') x = Math.max(x, ovp.getBoundingClientRect().right)
      const w = Math.min(c.right, v.right) - x, h = Math.min(c.bottom, v.bottom) - y
      if (w < 80 || h < 80 || c.width < 2 || c.height < 2) return null
      const smaller = w < c.width - 2 || h < c.height - 2
      return smaller ? { canvas: { x: c.left, y: c.top, w: c.width, h: c.height }, visible: { x, y, w, h } } : null
    }

    const flyToAsset = async (assetIdOrBimId: string) => {
      const controls = engine?.world?.camera?.controls
      const bimId = toBimId(assetIdOrBimId)
      const entry = bimId ? await locate(bimId) : null
      if (!controls || !entry) return false
      const box = worldBoxOf(entry)
      const camera = engine?.world?.camera?.three as THREE.PerspectiveCamera | undefined
      const view = visibleView()
      if (view && camera?.isPerspectiveCamera) {
        // fit it into what the user can see, not the whole canvas (its edge was hidden under the asset panel)
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        const pose = frameSphereInView(camera, sphere.center, sphere.radius, view.canvas, view.visible)
        await controls.setLookAt(pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z, true)
      } else {
        await controls.fitToBox(box, true)
      }
      return true
    }

    /* One menu row per real floor. Discipline models name the same floor
       differently ("Level 01", "FIRST FLR"); junk storeys ("delete …") are dropped.
       Picking a floor shows that floor and everything below it. */
    type Floor = { id: string; name: string; rank: number }
    let levels: Floor[] = []
    let levelSig = ''
    let levelSeq = 0
    const floorJobs = new WeakMap<object, Promise<LevelIndex>>()
    const floorCatalog = new Map<string, Floor>()
    /* World-Y samples per storey, so the heat colour follows the open floor
       and not a roof that happens to be the highest box. */
    const floorSamples = new Map<string, number[]>()
    const noteFloorBoxes = (floorId: string, ids: number[], boxOf: Map<number, THREE.Box3>) => {
      let list = floorSamples.get(floorId)
      if (!list) floorSamples.set(floorId, list = [])
      for (const id of ids) {
        const b = boxOf.get(id)
        if (!b || b.isEmpty() || !Number.isFinite(b.min.y) || !Number.isFinite(b.max.y)) continue
        list.push(b.min.y, b.max.y)
      }
    }
    const spanOf = (floorId: string) => {
      const list = floorSamples.get(floorId)
      if (!list || list.length < 4) return null
      const ys = list.slice().sort((a, b) => a - b)
      return { yLo: ys[Math.floor(ys.length * 0.05)], yHi: ys[Math.floor(ys.length * 0.95)] }
    }
    const ORDINALS = ['Ground floor', 'First floor', 'Second floor', 'Third floor', 'Fourth floor', 'Fifth floor', 'Sixth floor', 'Seventh floor', 'Eighth floor', 'Ninth floor', 'Tenth floor', 'Eleventh floor', 'Twelfth floor', 'Thirteenth floor', 'Fourteenth floor', 'Fifteenth floor', 'Sixteenth floor', 'Seventeenth floor', 'Eighteenth floor', 'Nineteenth floor', 'Twentieth floor']
    const attrText = (row: any, key: string) => {
      const v = row?.[key]
      const raw = v && typeof v === 'object' && 'value' in v ? v.value : v
      return raw == null || raw === '' ? '' : String(raw)
    }
    const namedFloor = (rank: number, name: string): Floor => {
      const floor = { id: name, name, rank }
      floorCatalog.set(name, floor)
      return floor
    }
    const numberedFloor = (n: number) => namedFloor(n, n >= 0 && n < ORDINALS.length ? ORDINALS[n] : `Floor ${n}`)
    const floorKey = (raw: string): Floor | null => {
      const name = raw.trim()
      if (!name || isJunkStorey(name)) return null
      const s = name.toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
      if (/\bBASEMENT\b|^BF$|^B\d+$/.test(s)) return namedFloor(-10, 'Basement')
      if (/\bROOF\b|^RF$/.test(s)) return namedFloor(1000, 'Roof')
      if (/\bGROUND\b|^GF$|\bENTRANCE\b|^LEVEL\s*0+$|^00$|^L0$/.test(s)) return numberedFloor(0)
      const words: [RegExp, number][] = [
        [/\bFIRST\b|\b1ST\b/, 1], [/\bSECOND\b|\b2ND\b/, 2], [/\bTHIRD\b|\b3RD\b/, 3],
        [/\bFOURTH\b|\b4TH\b/, 4], [/\bFIFTH\b|\b5TH\b/, 5], [/\bSIXTH\b|\b6TH\b/, 6],
        [/\bSEVENTH\b|\b7TH\b/, 7], [/\bEIGHTH\b|\b8TH\b/, 8], [/\bNINTH\b|\b9TH\b/, 9],
        [/\bTENTH\b|\b10TH\b/, 10],
      ]
      for (const [re, n] of words) if (re.test(s)) return numberedFloor(n)
      const lv = s.match(/\bLEVEL\s*0*(\d+)\b/) || s.match(/^L\s*0*(\d+)$/) || s.match(/^0*(\d+)\s*F$/) || s.match(/^0*(\d+)$/)
      if (!lv) return null
      const n = parseInt(lv[1], 10)
      return Number.isFinite(n) ? numberedFloor(n) : null
    }
    const storeyCache = new WeakMap<object, Promise<{ localId: number; floor: Floor; elevation: number }[]>>()
    const readStoreys = async (model: any) => {
      const cached = storeyCache.get(model)
      if (cached) return cached
      const job = readStoreysNow(model)
      storeyCache.set(model, job)
      return job
    }
    const readStoreysNow = async (model: any) => {
      if (typeof model.getItemsOfCategories !== 'function') return [] as { localId: number; floor: Floor; elevation: number }[]
      const cats = await model.getItemsOfCategories([/IFCBUILDINGSTOREY/i])
      const ids = Object.values(cats || {}).flat() as number[]
      if (!ids.length) return []
      const rows = typeof model.getItemsData === 'function' ? await model.getItemsData(ids) : []
      const out: { localId: number; floor: Floor; elevation: number }[] = []
      ids.forEach((localId, i) => {
        const floor = floorKey(attrText(rows[i], 'Name') || attrText(rows[i], 'LongName'))
        const elevation = parseFloat(attrText(rows[i], 'Elevation'))
        if (floor && Number.isFinite(elevation)) out.push({ localId, floor, elevation })
      })
      return out
    }
    /* BIMvision shows an element on the storey that contains it. A wall on
       Level 00 often hangs below that storey's elevation, so grouping by the
       bottom of the box pulls it into the basement. Containment is the list;
       height is only the fallback for geometry with no storey. */
    const relationData = (rels: any) => {
      const out = new Map<number, Record<string, number[]>>()
      const put = (id: unknown, rec: any) => {
        if (rec == null || id == null || id === '') return
        const data = rec.data && typeof rec.data === 'object' ? rec.data : rec
        out.set(Number(id), data)
      }
      if (rels && typeof rels.forEach === 'function') rels.forEach((v: any, k: any) => put(k, v))
      else if (Array.isArray(rels)) for (const pair of rels) put(pair?.[0], pair?.[1])
      else if (rels && typeof rels === 'object') for (const [k, v] of Object.entries(rels)) put(k, v)
      return out
    }
    /* `reference` is the set of boxes the model's height range is read from. It is the boxes themselves unless
       a small subset (the HVAC) is being placed against the whole model's range. */
    const assignByHeight = (geom: number[], boxes: THREE.Box3[], storeys: { floor: Floor; elevation: number }[], reference: THREE.Box3[] = boxes) => {
      const byFloor = new Map<string, number[]>()
      const floors: { id: string; elevation: number }[] = []
      for (const s of storeys) {
        if (!byFloor.has(s.floor.id)) byFloor.set(s.floor.id, [])
        const prev = floors.find(f => f.id === s.floor.id)
        if (!prev) floors.push({ id: s.floor.id, elevation: s.elevation })
        else prev.elevation = Math.min(prev.elevation, s.elevation)
      }
      floors.sort((a, b) => a.elevation - b.elevation)
      const ys: number[] = []
      for (const b of reference) if (b && !b.isEmpty() && Number.isFinite(b.min.y)) ys.push(b.min.y)
      ys.sort((a, b) => a - b)
      if (ys.length < 2 || floors.length < 2) return byFloor
      const yLo = ys[Math.floor(ys.length * 0.02)]
      const yHi = ys[Math.floor(ys.length * 0.98)]
      const elevSpan = floors[floors.length - 1].elevation - floors[0].elevation
      const ySpan = Math.max(yHi - yLo, 0.001)
      const scale = elevSpan / ySpan > 50 ? 0.001 : ySpan / elevSpan > 50 ? 1000 : 1
      const cuts = floors.map(f => ({ id: f.id, y: yLo + (f.elevation - floors[0].elevation) * scale }))
      const slop = Math.max(0.4, ySpan * 0.02)
      for (let i = 0; i < geom.length; i++) {
        const box = boxes[i]
        if (!box || box.isEmpty() || !Number.isFinite(box.min.y)) continue
        let chosen = cuts[0].id
        for (const c of cuts) {
          if (box.min.y + slop >= c.y) chosen = c.id
          else break
        }
        byFloor.get(chosen)!.push(geom[i])
      }
      return byFloor
    }
    const indexModel = (model: any) => {
      const pending = floorJobs.get(model)
      if (pending) return pending
      const job = (async () => {
        const geom: number[] = typeof model.getItemsIdsWithGeometry === 'function' ? await model.getItemsIdsWithGeometry() : []
        const boxes: THREE.Box3[] = geom.length && typeof model.getBoxes === 'function' ? await model.getBoxes(geom) : []
        const storeys = await readStoreys(model)
        const byFloor = new Map<string, number[]>()
        const owned = new Map<number, string>()
        if (storeys.length && typeof model.getRelations === 'function') {
          const storeyRels = relationData(await model.getRelations(storeys.map(s => s.localId)))
          for (const s of storeys) {
            if (!byFloor.has(s.floor.id)) byFloor.set(s.floor.id, [])
            for (const id of storeyRels.get(s.localId)?.ContainsElements || []) {
              if (!owned.has(id)) owned.set(id, s.floor.id)
            }
          }
          const loose = geom.filter(id => !owned.has(id))
          const storeyFloor = new Map(storeys.map(s => [s.localId, s.floor.id]))
          if (loose.length && owned.size) {
            const partRels = relationData(await model.getRelations(loose))
            const claim = (id: number) => {
              if (owned.has(id)) return
              const rec = partRels.get(id)
              const storey = rec?.ContainedInStructure?.[0]
              if (storey != null && storeyFloor.has(storey)) owned.set(id, storeyFloor.get(storey)!)
              const parent = rec?.Decomposes?.[0]
              if (!owned.has(id) && parent != null && owned.has(parent)) owned.set(id, owned.get(parent)!)
            }
            for (let hop = 0; hop < 3; hop++) {
              const missing: number[] = []
              for (const id of loose) {
                if (owned.has(id)) continue
                const parent = partRels.get(id)?.Decomposes?.[0]
                if (parent != null && !owned.has(parent) && !partRels.has(parent)) missing.push(parent)
              }
              if (missing.length) {
                const more = relationData(await model.getRelations(missing))
                for (const [id, rec] of more) partRels.set(id, rec)
              }
              for (const id of partRels.keys()) claim(id)
            }
          }
        }
        for (const id of geom) {
          const floorId = owned.get(id)
          if (!floorId) continue
          if (!byFloor.has(floorId)) byFloor.set(floorId, [])
          byFloor.get(floorId)!.push(id)
        }
        const still = owned.size ? geom.filter(id => !owned.has(id)) : geom
        if (still.length && storeys.length >= 2) {
          const wanted = new Set(still)
          const partGeom: number[] = []
          const partBoxes: THREE.Box3[] = []
          for (let i = 0; i < geom.length; i++) {
            if (!wanted.has(geom[i])) continue
            partGeom.push(geom[i])
            partBoxes.push(boxes[i])
          }
          for (const [floorId, ids] of assignByHeight(partGeom, partBoxes, storeys)) {
            if (!byFloor.has(floorId)) byFloor.set(floorId, [])
            byFloor.get(floorId)!.push(...ids)
          }
        }
        const boxOfFloor = new Map<number, THREE.Box3>()
        geom.forEach((id, i) => { if (boxes[i]) boxOfFloor.set(id, boxes[i]) })
        for (const [floorId, ids] of byFloor) noteFloorBoxes(floorId, ids, boxOfFloor)
        /* What the floor filter treats specially: the ceilings, and the HVAC. A model that cannot
           answer leaves both empty, which is the plain floor filter. */
        const ceilings = new Set<number>()
        const hvac = new Map<number, MechanicalInfo>()
        const ground = new Set<number>()
        try {
          const onGeometry = new Set(geom)
          const idsOf = (found: any) => (Object.values(found || {}).flat() as number[]).filter(id => onGeometry.has(id))
          if (typeof model.getItemsOfCategories === 'function') {
            /* The terrain a building model carries: not part of any floor, so a floor pick keeps it (lib/floorPolicy) */
            for (const id of idsOf(await model.getItemsOfCategories([/^IFCSITE$/i, /^IFCGEOGRAPHICELEMENT$/i]))) ground.add(id)
            const coverings = idsOf(await model.getItemsOfCategories([/^IFCCOVERING$/i]))
            if (coverings.length && typeof model.getItemsData === 'function') {
              const rows = await model.getItemsData(coverings, {
                attributesDefault: false, attributes: ['PredefinedType'], relationsDefault: { attributes: false, relations: false },
              })
              coverings.forEach((id, i) => { if (isCeilingType(attrText(rows[i], 'PredefinedType'))) ceilings.add(id) })
            }
            const fileName = useModelStore.getState().models.find(r => r.modelId === model.modelId)?.originalFileName || ''
            // The generic flow classes are electrical work too, in an electrical model
            const patterns = classifyModel(fileName).group === 'elec' ? [HVAC_SPECIFIC] : [HVAC_SPECIFIC, HVAC_GENERIC]
            const mech = idsOf(await model.getItemsOfCategories(patterns))
            if (mech.length) {
              const assigned = new Set<number>()
              for (const ids of byFloor.values()) for (const id of ids) assigned.add(id)
              const boxOf = new Map<number, THREE.Box3>()
              geom.forEach((id, i) => { if (boxes[i]) boxOf.set(id, boxes[i]) })
              const heightFloor = new Map<number, string>()
              if (storeys.length >= 2) {
                const partBoxes = mech.map(id => boxOf.get(id) as THREE.Box3)
                for (const [floorId, ids] of assignByHeight(mech, partBoxes, storeys, boxes)) for (const id of ids) heightFloor.set(id, floorId)
              }
              for (const id of mech) hvac.set(id, { assigned: assigned.has(id), heightFloor: heightFloor.get(id) ?? null })
            }
          }
        } catch { /* plain floor filter */ }
        return { geom, byFloor, ceilings, hvac, ground }
      })().catch((err) => { floorJobs.delete(model); throw err })
      floorJobs.set(model, job)
      return job
    }
    const refreshLevels = async () => {
      const byId = new Map<string, Floor>()
      for (const model of engine.fragments?.models?.list?.values() ?? []) {
        let entry: LevelIndex = { geom: [], byFloor: new Map(), ceilings: new Set(), hvac: new Map() }
        try { entry = await indexModel(model) } catch { /* model not ready */ }
        for (const id of entry.byFloor.keys()) {
          const known = floorCatalog.get(id)
          if (known) byId.set(id, known)
        }
      }
      const next = [...byId.values()].sort((a, b) => b.rank - a.rank)
      const sig = next.map(l => l.id).join('|')
      if (sig === levelSig) return
      levelSig = sig
      levels = next
      try { (window as any).EKO?.set?.({}) } catch { /* dashboard not up yet */ }
    }
    let lastLevelId: string | null = null
    let levelWait: { id: string; force?: boolean; alone?: boolean } | null = null
    const isolateLevel = async (levelId: string, force?: boolean, aloneAs?: boolean) => {
      /* Indexing a model asks the same worker that is parsing the next file. */
      if (useLoadingProgressStore.getState().sessionActive) {
        levelWait = { id: levelId, force, alone: aloneAs }
        return
      }
      levelWait = null
      if (levelId === 'Ground floor' && !floorCatalog.get(levelId)) {
        const gf = [...floorCatalog.values()].find(f => /ground/i.test(f.name) || f.rank === 0)
        if (gf) levelId = gf.id
      }
      // "Isolate floor" is a dock setting, read here so the picker, the stepper and the toggle all go through this one function
      const alone = aloneAs ?? !!(window as any).EKO?.state?.dock?.floorAlone
      const levelKey = levelId + (alone ? '|alone' : '')
      if (!force && levelKey === lastLevelId) return
      lastLevelId = levelKey
      const seq = ++levelSeq
      for (const model of engine.fragments?.models?.list?.values() ?? []) {
        const m = model as any
        if (typeof m.setVisible !== 'function') continue
        if (seq !== levelSeq) return
        const entry = await indexModel(m)
        if (seq !== levelSeq) return
        /* The level filter states what IT hides; the coordinator keeps whatever the
           tree and the template hide, instead of resetVisible() wiping them. */
        const hideAll = () => { levelHidden.set(m, new Set(entry.geom)); return setHidden(m, 'level', entry.geom) }
        levelHidden.delete(m)
        if (!levelId || levelId === 'ALL' || !entry.byFloor.size) { await setHidden(m, 'level', []); continue }
        /* The Landscape is not on the building's floors: it stays whole unless the floor is isolated */
        const rec = useModelStore.getState().models.find(r => r.modelId === m.modelId)
        if (rec && floorFilterSkips(classifyLoaded(rec).group, alone)) { await setHidden(m, 'level', []); continue }
        /* Basement is only itself. Each floor above also keeps everything below it, unless Isolate floor is on.
           What the floor hides beyond that (its own ceilings) and keeps beyond that (the HVAC) is lib/floorPolicy. */
        const picked = floorCatalog.get(levelId)
        if (!picked) { await hideAll(); continue }
        const hide = levelHides(entry, picked, id => floorCatalog.get(id)?.rank, { alone })
        if (!hide) { await setHidden(m, 'level', []); continue }
        levelHidden.set(m, new Set(hide))
        await setHidden(m, 'level', hide)
      }
      if (seq === levelSeq) {
        repositionMarkers()
        /* The floor hide lands after the colour pass has started. Paint again
           for the storey that is actually open. */
        if (spaceHeatActive && heatReq) void applySpaceHeat(heatReq.zones, heatReq.mode)
      }
    }

    /* Brief Show in the model: the asset in colour on Studio, floors above cut away, its floor outlined. Null puts the style from before the locate back. */
    const assetFloor = new Map<string, string>()
    const floorOf = async (bimId: string): Promise<string | null> => {
      const known = assetFloor.get(bimId)
      if (known) return known
      const entry = await locate(bimId)
      if (!entry) return null
      let found = guidFloor.get(bimId) || null
      if (!found) {
        try {
          for (const [id, ids] of (await indexModel(entry.model)).byFloor) if (ids.includes(entry.localId)) { found = id; break }
        } catch { /* model not indexed yet */ }
      }
      if (!found || !floorCatalog.has(found)) {
        // by height: the highest floor that starts below the element's centre
        const y = worldBoxOf(entry).getCenter(new THREE.Vector3()).y
        let lo = -Infinity
        found = null
        for (const id of floorCatalog.keys()) {
          const span = spanOf(id)
          if (span && span.yLo <= y && span.yLo > lo) { lo = span.yLo; found = id }
        }
      }
      if (found) assetFloor.set(bimId, found)
      return found
    }
    const focusAsset = async (assetIdOrBimId: string | null, colour?: string) => {
      const store = useAppStore.getState()
      const eko = (window as any).EKO
      if (!assetIdOrBimId) {
        if (!focusPrev) return
        const prev = focusPrev
        const dockStyle = focusDock
        focusPrev = null
        focusDock = null
        focusColour = null
        if (eko?.state?.dock && dockStyle != null) eko.state.dock.style = dockStyle
        store.setLightingParams(prev)
        const paint = eko?.state?.paint
        if (colored) tintGhost(colored.tone)
        if (paint) await highlightAsset(paint)
        else await clearHighlight()
        return
      }
      let refreshStyle = false
      if (!focusPrev) {
        focusPrev = { templateId: store.templateId, realisticMode: store.realisticMode, renderLite: store.renderLite }
        const dock = eko?.state?.dock
        if (dock) {
          focusDock = dock.style
          if (dock.style !== 'studio') {
            dock.style = 'studio'
            refreshStyle = true
          }
        }
        if (store.templateId !== 'studio') store.setTemplate('studio')
        if (refreshStyle && eko?.set) eko.set({})
      }
      focusColour = new THREE.Color(/^#[0-9a-f]{3,8}$/i.test(colour || '') ? colour! : '#7B6CFF')
      const shown = await highlightAsset(assetIdOrBimId)
      if (colored) tintGhost(colored.tone)
      return shown
    }
    // The Style toolbar still changes the picture. Back restores the style from before the locate.
    const styleDuringFocus = (_id: string): boolean => false
    let cutSeq = 0
    const cutAboveAsset = async (assetIdOrBimId: string | null) => {
      const seq = ++cutSeq
      if (!assetIdOrBimId) {
        const dock = (window as any).EKO?.state?.dock
        await isolateLevel(dock?.level || 'ALL', true)
        return
      }
      const bimId = toBimId(assetIdOrBimId)
      const floorId = bimId ? await floorOf(bimId) : null
      // that floor and everything below it, whatever Isolate floor says
      if (floorId && seq === cutSeq) await isolateLevel(floorId, true, false)
    }
    const outlineMat = new THREE.LineBasicMaterial({ color: 0x7b6cff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false })
    const dropOutline = () => {
      if (!floorOutline) return
      floorOutline.removeFromParent()
      floorOutline.geometry.dispose()
      floorOutline = null
    }
    const meshMatrix = (g: any) => g.transform instanceof THREE.Matrix4
      ? g.transform as THREE.Matrix4
      : new THREE.Matrix4().fromArray(g.transform?.elements ?? g.transform ?? new THREE.Matrix4().elements)
    const planTris = async (model: any, ids: number[]) => {
      const tris: XzTri[] = []
      if (!ids.length || typeof model.getItemsGeometry !== 'function') return tris
      model.object.updateMatrixWorld(true)
      const world = model.object.matrixWorld as THREE.Matrix4
      let res: any[][] = []
      try { res = await model.getItemsGeometry(ids) } catch { return tris }
      const v = new THREE.Vector3()
      const take = (p: ArrayLike<number>, i: number, t: THREE.Matrix4) => {
        v.set(Number(p[i * 3]) || 0, Number(p[i * 3 + 1]) || 0, Number(p[i * 3 + 2]) || 0).applyMatrix4(t).applyMatrix4(world)
        return { x: v.x, z: v.z }
      }
      for (let n = 0; n < ids.length && tris.length < 120000; n++) {
        for (const g of res?.[n] || []) {
          if (!g?.positions || tris.length >= 120000) continue
          const t = meshMatrix(g)
          const p = g.positions as ArrayLike<number>
          const idx = g.indices as ArrayLike<number> | undefined
          const count = idx ? idx.length : p.length / 3
          for (let i = 0; i + 2 < count && tris.length < 120000; i += 3) {
            const ia = idx ? idx[i] : i, ib = idx ? idx[i + 1] : i + 1, ic = idx ? idx[i + 2] : i + 2
            const a = take(p, ia, t), b = take(p, ib, t), c = take(p, ic, t)
            const abx = b.x - a.x, abz = b.z - a.z, acx = c.x - a.x, acz = c.z - a.z
            if (Math.abs(abx * acz - abz * acx) < 0.04) continue
            tris.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, cx: c.x, cz: c.z })
          }
        }
      }
      return tris
    }
    /* Floor slabs first. Rooms are the plate when the slab is only a rectangle around them. */
    const plateIds = async (model: any, floorId: string, kind: 'slab' | 'space') => {
      const onFloor = new Set<number>((await indexModel(model)).byFloor.get(floorId) || [])
      if (!onFloor.size || typeof model.getItemsOfCategories !== 'function') return [] as number[]
      const found = await model.getItemsOfCategories([kind === 'slab' ? /^IFCSLAB$/i : /^IFCSPACE$/i])
      let ids = (Object.values(found || {}).flat() as number[]).filter(id => onFloor.has(id))
      if (!ids.length) return []
      if (kind === 'slab' && typeof model.getItemsData === 'function') {
        try {
          const rows = await model.getItemsData(ids, {
            attributesDefault: false, attributes: ['PredefinedType'], relationsDefault: { attributes: false, relations: false },
          })
          ids = ids.filter((_, i) => !/ROOF|LANDING/.test(attrText(rows[i], 'PredefinedType').toUpperCase()))
        } catch { /* an untyped slab can still be the plate */ }
      }
      if (!ids.length || typeof model.getBoxes !== 'function') return ids.slice(0, kind === 'slab' ? 60 : 200)
      let boxes: THREE.Box3[] = []
      try { boxes = await model.getBoxes(ids) } catch { return [] }
      const ranked: { id: number; area: number }[] = []
      ids.forEach((id, i) => {
        const b = boxes[i]
        if (!b || b.isEmpty()) return
        const dx = b.max.x - b.min.x, dy = b.max.y - b.min.y, dz = b.max.z - b.min.z
        const area = dx * dz
        if (kind === 'slab') {
          if (dy > 1.8 || dx < 2 || dz < 2 || area < 8) return
        } else if (area < 1.5 || area > 80000 || dy < 0.4) return
        ranked.push({ id, area })
      })
      ranked.sort((a, b) => b.area - a.area)
      return ranked.slice(0, kind === 'slab' ? 60 : 200).map(r => r.id)
    }
    let outlineSeq = 0
    const outlineFloorOf = async (assetIdOrBimId: string | null) => {
      const wake = engine.world?.renderer as { needsUpdate?: boolean } | undefined
      dropOutline()
      if (wake) wake.needsUpdate = true
      // The storey box is off. A call only clears one that is already drawn.
      return
      const seq = ++outlineSeq
      const bimId = assetIdOrBimId ? toBimId(assetIdOrBimId) : null
      const floorId = bimId ? await floorOf(bimId) : null
      if (!floorId || seq !== outlineSeq) return
      const models = [...(engine.fragments?.models?.list?.values() ?? [])]
      const slabIds: { model: any; ids: number[] }[] = []
      for (const model of models) {
        if (seq !== outlineSeq) return
        const m = model as any
        try {
          const slabs = await plateIds(m, floorId, 'slab')
          if (slabs.length) slabIds.push({ model: m, ids: slabs })
        } catch { /* model not ready */ }
      }
      if (seq !== outlineSeq) return
      const slabTris: XzTri[] = []
      for (const part of slabIds) {
        if (seq !== outlineSeq) return
        slabTris.push(...await planTris(part.model, part.ids))
      }
      if (seq !== outlineSeq) return
      const slabLoops = slabTris.length ? plateLoops(slabTris, { pad: 0.35 }) : null
      // A four-corner slab is a pad. The rooms on that floor carry the building shape.
      const plain = !slabLoops?.length || slabLoops[0].length / 2 - 1 <= 4
      let spaceLoops: number[][] | null = null
      if (plain) {
        const spaceTris: XzTri[] = []
        for (const model of models) {
          if (seq !== outlineSeq) return
          const m = model as any
          try {
            const spaces = await plateIds(m, floorId, 'space')
            if (spaces.length) spaceTris.push(...await planTris(m, spaces))
          } catch { /* model not ready */ }
        }
        if (seq !== outlineSeq) return
        spaceLoops = spaceTris.length ? plateLoops(spaceTris, { pad: 0.35, bridge: 0.8 }) : null
      }
      const loops = choosePlate(slabLoops, spaceLoops)
      const showPlate = (y0: number, y1: number) => {
        if (!loops?.length) return false
        const pos = platePrism(loops, y0, y1)
        if (!pos.length) return false
        const geom = new THREE.BufferGeometry()
        geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geom.computeBoundingSphere()
        floorOutline = new THREE.LineSegments(geom, outlineMat)
        floorOutline.frustumCulled = false
        floorOutline.renderOrder = 999
        overlay.add(floorOutline)
        if (wake) wake.needsUpdate = true
        return true
      }
      const span = spanOf(floorId)
      if (span && showPlate(span.yLo, Math.max(span.yHi, span.yLo + 0.5))) return
      const box = new THREE.Box3()
      for (const model of models) {
        const m = model as any
        if (typeof m.getMergedBox !== 'function') continue
        try {
          const ids = (await indexModel(m)).byFloor.get(floorId) || []
          if (!ids.length) continue
          m.object.updateMatrixWorld(true)
          const b: THREE.Box3 = await m.getMergedBox(ids)
          if (b && !b.isEmpty()) box.union(b)
        } catch { /* model not ready */ }
      }
      if (seq !== outlineSeq || box.isEmpty()) return
      if (span) { box.min.y = span.yLo; box.max.y = Math.max(span.yHi, span.yLo + 0.5) }
      if (showPlate(box.min.y, box.max.y)) return
      const size = box.getSize(new THREE.Vector3())
      floorOutline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x + 0.6, size.y + 0.2, size.z + 0.6)), outlineMat)
      floorOutline.position.copy(box.getCenter(new THREE.Vector3()))
      floorOutline.renderOrder = 999
      overlay.add(floorOutline)
      if (wake) wake.needsUpdate = true
    }

    /* TEMPORARY, read-only: why the floor filter hides what it hides, model by model. Reached from the browser
       console as EKO_FLOOR_FILTER_REPORT('Third floor'); the picked floor and Isolate floor are read as they stand.
       It changes nothing: it only restates what isolateLevel would do (lib/floorPolicy reportLevel). */
    const describeLevelFilter = async (levelId?: string) => {
      const dock = (window as any).EKO?.state?.dock
      const id = levelId || dock?.level
      const alone = !!dock?.floorAlone
      const picked = floorCatalog.get(id)
      const models: Record<string, unknown>[] = []
      for (const model of engine.fragments?.models?.list?.values() ?? []) {
        const m = model as any
        const rec = useModelStore.getState().models.find(r => r.modelId === m.modelId)
        const cls = rec ? classifyLoaded(rec) : null
        const rep = reportLevel(await indexModel(m), picked, fid => floorCatalog.get(fid)?.rank, { alone }, cls?.group ?? 'unknown')
        // What the model files under no floor, by IFC class
        const classes: Record<string, number> = {}
        if (rep.onNoFloor.length && typeof m.getItemsData === 'function') {
          try {
            for (let i = 0; i < rep.onNoFloor.length; i += 1500) {
              const rows = await m.getItemsData(rep.onNoFloor.slice(i, i + 1500), {
                attributesDefault: false, attributes: ['Name'], relationsDefault: { attributes: false, relations: false },
              })
              for (const row of rows) { const c = row?._category?.value ?? '?'; classes[c] = (classes[c] ?? 0) + 1 }
            }
          } catch { /* the counts above stand */ }
        }
        models.push({
          file: rec?.originalFileName ?? m.modelId, group: cls?.group ?? 'unknown', classified: cls?.known ?? false,
          skippedByFloorPick: rep.skipped, groundKept: rep.groundKept, geometry: rep.geometry, floors: rep.floors, hidden: rep.hidden,
          onNoFloor: rep.onNoFloor.length, onNoFloorClasses: Object.entries(classes).sort((a, b) => b[1] - a[1]).slice(0, 8),
        })
      }
      return { floor: id, floorKnown: !!picked, isolateFloor: alone, models }
    }

    /* The Spaces model is the heat map's: hidden in normal viewing, shown while the heat map is applied.
       (The heat plates follow their model's visibility, so it has to be on for them to draw.) */
    let spaceHeatActive = false
    /* Occupancy draws people and colours no room, so the space volumes stay hidden: they covered the building and the people in it */
    let heatModeNow = 'temp'
    const spacesShown = () => spaceHeatActive && heatModeNow !== 'occ'
    const applySpacesGate = () => {
      const state = useModelStore.getState()
      const show = spacesShown()
      for (const rec of state.models) {
        if (classifyLoaded(rec).group !== 'spaces') continue
        if (state.modelVisibility[rec.modelId] !== show) state.setModelVisibility(rec.modelId, show)
        const root = modelObject(rec)
        if (root && root.visible !== show) root.visible = show
      }
    }

    const heatGeoms = new Map<string, THREE.BufferGeometry[]>()
    const heatByBim = new Map<string, { mat: THREE.MeshBasicMaterial; model: any; localId: number }>()
    let heatSheets: THREE.Mesh[] = []
    let heatSig = ''
    let heatSeq = 0
    let heatBusy = false
    let heatAgain = false
    let crowdPlacedSig = ''
    let crowdJob = 0
    let crowdJobBusy = 0
    let heatReq: { zones: { bimId?: string; bimIds?: string[]; gid?: string; nameEn?: string; tempC?: number | null; rh?: number | null; co2?: number | null }[]; mode?: string } | null = null
    /* Colour sits in the room and is tested against the building, so a ceiling does not hide it from an angled view. */
    let heatInsideWalls = false
    const heatInsideOf = () => {
      const heat = useProjectStore.getState().currentProject?.apiSettings?.heatmap
      return !!(heat && (heat.insideWalls || heat.camera === 'inside'))
    }
    /* The heatmap does not cut the ceiling. A floor pick uses the Levels rule only. */
    const heatClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const syncHeatClip = () => {
      const renderer = engine.world?.renderer?.three as THREE.WebGLRenderer | undefined
      if (!renderer) return
      const planes = renderer.clippingPlanes
      const at = planes.indexOf(heatClip)
      if (at >= 0) planes.splice(at, 1)
    }
    /* Two colours per category so the low end and the high end stay distinct.
       The same pairs are in analytics.js heatStops. */
    const HEAT_STOPS: Record<string, [number, number]> = {
      temp: [0x5B8DEF, 0xD61F1F],
      hum: [0xE6C35C, 0x0E7C74],
      comfort: [0x6BCB77, 0xC45C26],
    }
    /* Empty blue, busy amber, full red. Same three stops as the medical twin. */
    const occBlue = new THREE.Color(0x60a5fa)
    const occAmber = new THREE.Color(0xfbbf24)
    const occRed = new THREE.Color(0xef4444)
    const heatT = (mode: string, v: number | null) => {
      if (v == null || !isFinite(v)) return null
      const t = mode === 'comfort' ? (v - 600) / 600 : mode === 'hum' ? (v - 40) / 40 : (v - 21) / 4
      return Math.max(0, Math.min(1, t))
    }
    const round1 = (n: number | null | undefined) => (n == null || !isFinite(Number(n)) ? '' : (Math.round(Number(n) * 10) / 10).toFixed(1))
    const heatRootOf = (model: any) => {
      let root = heatRoots.get(model)
      if (root) return root
      root = new THREE.Group()
      root.matrixAutoUpdate = false
      overlay.add(root)
      heatRoots.set(model, root)
      return root
    }
    /* A flat grid at the top of the room: the glow's stand-in when the item has no mesh */
    const plateFrom = (localBox: THREE.Box3) => {
      const size = localBox.getSize(new THREE.Vector3())
      const center = localBox.getCenter(new THREE.Vector3())
      const geom = new THREE.PlaneGeometry(Math.max(size.x, 0.2), Math.max(size.z, 0.2), 4, 4)
      geom.rotateX(-Math.PI / 2)
      geom.translate(center.x, center.y + size.y / 2, center.z)
      return geom
    }
    const partMatrix = (g: any) => g.transform instanceof THREE.Matrix4 ? g.transform
      : new THREE.Matrix4().fromArray(g.transform?.elements ?? g.transform ?? new THREE.Matrix4().elements)
    const geomsFor = async (bimId: string, entry: Located) => {
      const hit = heatGeoms.get(bimId)
      if (hit) return hit
      let meshes: any[][] = []
      try { meshes = await entry.model.getItemsGeometry([entry.localId]) } catch { meshes = [] }
      const geoms: THREE.BufferGeometry[] = []
      for (const item of meshes || []) {
        for (const g of item || []) {
          if (!g?.positions || !g.indices) continue
          const geom = new THREE.BufferGeometry()
          geom.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3))
          geom.setIndex(Array.from(g.indices as ArrayLike<number>))
          geom.applyMatrix4(partMatrix(g))
          geoms.push(geom)
        }
      }
      if (!geoms.length && entry.localBox && !entry.localBox.isEmpty()) geoms.push(plateFrom(entry.localBox))
      heatGeoms.set(bimId, geoms)
      return geoms
    }
    /* The heat map colours each room as its space's own solid, the shape the model has; its box is the fallback */
    const heatSolids = new Map<string, THREE.BufferGeometry>()
    const solidFrom = (parts: any[], box: THREE.Box3) => {
      const pos: number[] = []
      const v = new THREE.Vector3()
      for (const g of parts || []) {
        if (!g?.positions || !g.indices) continue
        const t = partMatrix(g), p = g.positions as ArrayLike<number>, idx = g.indices as ArrayLike<number>
        for (let i = 0; i < idx.length; i++) {
          v.set(p[idx[i] * 3], p[idx[i] * 3 + 1], p[idx[i] * 3 + 2]).applyMatrix4(t)
          pos.push(v.x, v.y, v.z)
        }
      }
      if (pos.length >= 9) {
        const geom = new THREE.BufferGeometry()
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
        return geom
      }
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3())
      return new THREE.BoxGeometry(Math.max(size.x, 0.2), Math.max(size.y, 0.2), Math.max(size.z, 0.2)).translate(c.x, c.y, c.z)
    }
    /* One geometry read per model for all of a floor's rooms */
    const solidsFor = async (list: { guid: string; model: any; localId: number; box: THREE.Box3 }[]) => {
      const byModel = new Map<any, typeof list>()
      for (const r of list) {
        if (heatSolids.has(r.guid)) continue
        const l = byModel.get(r.model) || []
        l.push(r)
        byModel.set(r.model, l)
      }
      for (const [model, rs] of byModel) {
        let res: any[][] = []
        try { res = await model.getItemsGeometry(rs.map(r => r.localId)) } catch { res = [] }
        rs.forEach((r, i) => heatSolids.set(r.guid, solidFrom(res && res.length === rs.length ? res[i] : [], r.box)))
      }
    }
    const heatFloorSheets = new Map<string, { meshes: THREE.Mesh[]; guids: Set<string>; done: boolean }>()
    const dropHeatSheets = () => {
      for (const rec of heatFloorSheets.values()) {
        for (const mesh of rec.meshes) {
          mesh.removeFromParent()
          mesh.geometry.dispose()
          const mat = mesh.material as THREE.Material
          unwatchClipping(mat)
          mat.dispose()
        }
      }
      heatFloorSheets.clear()
      heatSheets = []
    }
    /* Picked floor first, then the floors under it. Isolate floor is that floor only. */
    const floorsInView = (levelId: string, alone: boolean) => {
      const floors = [...floorCatalog.values()]
      if (!levelId || levelId === 'ALL') return floors.sort((a, b) => b.rank - a.rank).map(f => f.id)
      const picked = floorCatalog.get(levelId)
      if (!picked) return [levelId]
      return floors
        .filter(f => alone ? f.rank === picked.rank : f.rank <= picked.rank)
        .sort((a, b) => (a.id === picked.id ? -1 : b.id === picked.id ? 1 : b.rank - a.rank))
        .map(f => f.id)
    }
    const showHeatFloors = (ids: Set<string>) => {
      for (const [floor, rec] of heatFloorSheets) {
        const on = ids.has(floor)
        for (const mesh of rec.meshes) mesh.visible = on
      }
    }
    let crowdMesh: THREE.InstancedMesh | null = null
    let crowdGlowMesh: THREE.InstancedMesh | null = null
    /* band: how crowded it is around a person, 0 low, 1 normal, 2 high, 3 critical */
    type CrowdFoot = { originX: number; originZ: number; step: number; cols: number; rows: number; on: Uint8Array; cells: number[] }
    let crowd: { minX: number; maxX: number; minZ: number; maxZ: number; x: number; z: number; vx: number; vz: number; y: number; still: boolean; band: number; foot: CrowdFoot | null }[] = []
    const crowdDummy = new THREE.Object3D()
    const glowDummy = new THREE.Object3D()
    /* Unit disc. The drawn size is set per person so a close view keeps the halo
       and a pulled-back view is only a little smaller. The band colour is the
       instance colour: this plane has no vertex colours, and turning those on
       multiplied every pixel by black. */
    const GLOW_RADIUS = 1.15
    const GLOW_COLOR = [0x3b82f6, 0x22c55e, 0xeab308, 0xef4444].map(hex => new THREE.Color(hex))
    const glowGeo = new THREE.PlaneGeometry(GLOW_RADIUS * 2, GLOW_RADIUS * 2)
    glowGeo.rotateX(-Math.PI / 2)
    const glowTex = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 128
      const g = c.getContext('2d')
      if (!g) return null
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
      grd.addColorStop(0, 'rgba(255,255,255,0)')
      grd.addColorStop(0.18, 'rgba(255,255,255,0.2)')
      grd.addColorStop(0.36, 'rgba(255,255,255,0.9)')
      grd.addColorStop(0.68, 'rgba(255,255,255,0.45)')
      grd.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grd
      g.fillRect(0, 0, 128, 128)
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.NoColorSpace
      tex.premultiplyAlpha = false
      tex.needsUpdate = true
      return tex
    })()
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: glowTex || undefined,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    })
    const wipeCrowd = () => {
      if (crowdMesh) {
        overlay.remove(crowdMesh)
        crowdMesh.geometry.dispose()
        ;(crowdMesh.material as THREE.Material).dispose()
        crowdMesh = null
      }
      if (crowdGlowMesh) {
        overlay.remove(crowdGlowMesh)
        crowdGlowMesh.geometry.dispose()
        crowdGlowMesh = null
      }
      crowd = []
    }
    const clearCrowd = () => {
      wipeCrowd()
      crowdPlacedSig = ''
      crowdJob++
      crowdJobBusy = 0
    }
    const crowdWanted = () => heatModeNow === 'occ' && (window as any).EKO?.state?.pageId === 'heatmap'
    const occSpeed = () => {
      const n = useProjectStore.getState().currentProject?.apiSettings?.heatmap?.speed
      const s = n == null || !Number.isFinite(Number(n)) ? 1 : Number(n)
      return Math.max(0.4, Math.min(2, s))
    }
    const WALK_WORDS = ['corridor', 'circulation', 'public area', 'lobby', 'waiting', 'lounge']
    const guidWalks = (guid: string) => {
      const heat = useProjectStore.getState().currentProject?.apiSettings?.heatmap
      if (heat?.stillRooms === false) return true
      const list = heat?.walkRooms
      const words = (Array.isArray(list) ? list : WALK_WORDS).map(w => w.trim().toLowerCase()).filter(Boolean)
      const link = (useProjectStore.getState().currentProject?.assetLinks || [])
        .find(l => l.kind === 'space' && l.guid === guid)
      /* The room label is the model name. The heatmap name is often a sensor (S-01) and would make every room walk or none. */
      const folded = `${link?.element || ''} ${link?.equip || ''}`.toLowerCase()
      return words.some(word => folded.includes(word))
    }
    const pointInTri = (px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
      const v0x = cx - ax, v0z = cz - az, v1x = bx - ax, v1z = bz - az, v2x = px - ax, v2z = pz - az
      const dot00 = v0x * v0x + v0z * v0z, dot01 = v0x * v1x + v0z * v1z, dot02 = v0x * v2x + v0z * v2z
      const dot11 = v1x * v1x + v1z * v1z, dot12 = v1x * v2x + v1z * v2z
      const den = dot00 * dot11 - dot01 * dot01
      if (den <= 1e-12) return false
      const inv = 1 / den
      const u = (dot11 * dot02 - dot01 * dot12) * inv
      const v = (dot00 * dot12 - dot01 * dot02) * inv
      return u >= -0.001 && v >= -0.001 && u + v <= 1.001
    }
    /* Cells the space mesh covers, so a corridor's box cannot carry people through the rooms beside it. */
    const footprintFrom = (geom: THREE.BufferGeometry, toWorld: THREE.Matrix4): { foot: CrowdFoot; area: number } | null => {
      const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined
      const index = geom.getIndex()
      const corners = index ? index.count : pos?.count
      if (!pos || !corners || corners < 3 || corners > 9000) return null
      const step = 0.5
      const v = new THREE.Vector3()
      const pts: number[] = []
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (let i = 0; i < corners; i++) {
        const vi = index ? index.getX(i) : i
        v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(toWorld)
        pts.push(v.x, v.z)
        if (v.x < minX) minX = v.x
        if (v.x > maxX) maxX = v.x
        if (v.z < minZ) minZ = v.z
        if (v.z > maxZ) maxZ = v.z
      }
      if (!isFinite(minX) || maxX - minX < 0.2 || maxZ - minZ < 0.2) return null
      const cols = Math.ceil((maxX - minX) / step) + 1
      const rows = Math.ceil((maxZ - minZ) / step) + 1
      if (cols < 1 || rows < 1 || cols * rows > 16000) return null
      const on = new Uint8Array(cols * rows)
      const cells: number[] = []
      const mark = (x: number, z: number) => {
        const ix = Math.floor((x - minX) / step)
        const iz = Math.floor((z - minZ) / step)
        if (ix < 0 || iz < 0 || ix >= cols || iz >= rows) return
        const k = iz * cols + ix
        if (!on[k]) { on[k] = 1; cells.push(k) }
      }
      for (let i = 0; i + 5 < pts.length; i += 6) {
        const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3], cx = pts[i + 4], cz = pts[i + 5]
        const ix0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / step))
        const ix1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx, cx) - minX) / step))
        const iz0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) / step))
        const iz1 = Math.min(rows - 1, Math.floor((Math.max(az, bz, cz) - minZ) / step))
        for (let iz = iz0; iz <= iz1; iz++) {
          const z = minZ + (iz + 0.5) * step
          for (let ix = ix0; ix <= ix1; ix++) {
            const x = minX + (ix + 0.5) * step
            if (pointInTri(x, z, ax, az, bx, bz, cx, cz)) mark(x, z)
          }
        }
      }
      if (!cells.length) return null
      return { foot: { originX: minX, originZ: minZ, step, cols, rows, on, cells }, area: cells.length * step * step }
    }
    const onFoot = (foot: CrowdFoot, x: number, z: number) => {
      const ix = Math.floor((x - foot.originX) / foot.step)
      const iz = Math.floor((z - foot.originZ) / foot.step)
      if (ix < 0 || iz < 0 || ix >= foot.cols || iz >= foot.rows) return false
      return foot.on[iz * foot.cols + ix] === 1
    }
    const occWeight = (id: string) => {
      let h = 2166136261
      for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
      return 0.35 + ((h >>> 0) % 1000) / 1000 * 1.3
    }
    /* Each zone gets the dashboard's count for it (same weight on the same key), shared among its rooms in view.
       Sharing all the people among every room rounded each room to none once a zone linked many rooms. */
    const placeCrowd = async (floorIds: string[], zones: { key: string; ids: string[] }[], people: number, key: string) => {
      const seq = heatSeq
      if (!crowdWanted()) { clearCrowd(); return }
      if (crowdPlacedSig === key && (crowdMesh || crowdJobBusy)) return
      const job = ++crowdJob
      crowdJobBusy = job
      crowdPlacedSig = key
      wipeCrowd()
      const mine = () => job === crowdJob && crowdWanted() && seq === heatSeq
      try {
      const inView = new Set<string>()
      for (const floorId of floorIds) {
        const set = floorRooms.get(floorId)?.guids
        if (!set) continue
        for (const g of set) if (located.has(g)) inView.add(g)
      }
      if (!inView.size || people <= 0 || !mine()) { if (crowdJobBusy === job) crowdJobBusy = 0; return }
      const zoneWeights = zones.map(z => occWeight(z.key))
      const zoneSum = zoneWeights.reduce((n, w) => n + w, 0) || 1
      const plan: { id: string; count: number }[] = []
      zones.forEach((zone, z) => {
        const zoneCount = Math.max(0, Math.round(people * zoneWeights[z] / zoneSum))
        const rooms = zone.ids.filter(id => inView.has(id))
        if (!zoneCount || !rooms.length) return
        const weights = rooms.map(occWeight)
        const sum = weights.reduce((n, w) => n + w, 0) || 1
        const exact = weights.map(w => zoneCount * w / sum)
        const counts = exact.map(Math.floor)
        let left = zoneCount - counts.reduce((n, c) => n + c, 0)
        exact.map((v, i) => [v - counts[i], i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { counts[i]++; left-- } })
        rooms.forEach((id, i) => { if (counts[i]) plan.push({ id, count: counts[i] }) })
      })
      if (!plan.length) { if (crowdJobBusy === job) crowdJobBusy = 0; return }
      const spots = plan.flatMap(sp => {
        const entry = located.get(sp.id)
        return entry?.localBox ? [{ ...sp, entry }] : []
      })
      if (!spots.length) { if (crowdJobBusy === job) crowdJobBusy = 0; return }
      await solidsFor(spots.map(sp => ({ guid: sp.id, model: sp.entry.model, localId: sp.entry.localId, box: sp.entry.localBox })))
      if (!mine()) { if (crowdJobBusy === job) crowdJobBusy = 0; return }
      type Ready = { count: number; walks: boolean; y: number; minX: number; maxX: number; minZ: number; maxZ: number; foot: CrowdFoot | null; area: number }
      const ready: Ready[] = []
      for (const sp of spots) {
        const entry = sp.entry
        entry.model.object.updateMatrixWorld(true)
        const box = entry.localBox.clone().applyMatrix4(entry.model.object.matrixWorld)
        const geom = heatSolids.get(sp.id)
        const fit = geom ? footprintFrom(geom, entry.model.object.matrixWorld) : null
        const width = Math.max(0, box.max.x - box.min.x)
        const depth = Math.max(0, box.max.z - box.min.z)
        ready.push({
          count: sp.count,
          walks: guidWalks(sp.id),
          y: box.min.y + Math.min(1.1, Math.max(0.4, (box.max.y - box.min.y) * 0.35)),
          minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z,
          foot: fit?.foot ?? null,
          area: fit ? fit.area : width * depth,
        })
      }
      const areas = ready.map(r => r.area).filter(a => a > 1).sort((a, b) => a - b)
      const typical = areas.length ? areas[Math.floor(areas.length / 2)] : 0
      /* A storey-sized space is the floor plate, not a room. People there covered the site. */
      const kept = typical > 0 ? ready.filter(r => r.area > 0.5 && r.area <= typical * 16) : ready.filter(r => r.area > 0.5)
      const total = kept.reduce((n, r) => n + r.count, 0)
      if (!total) { if (crowdJobBusy === job) crowdJobBusy = 0; return }
      const geo = new THREE.SphereGeometry(0.22, 6, 6)
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff })
      const mesh = new THREE.InstancedMesh(geo, mat, total)
      mesh.frustumCulled = false
      mesh.renderOrder = 4
      const glow = new THREE.InstancedMesh(glowGeo.clone(), glowMat, total)
      glow.frustumCulled = false
      glow.renderOrder = 2
      let idx = 0
      for (const sp of kept) {
        for (let i = 0; i < sp.count; i++) {
          let x: number
          let z: number
          if (sp.foot && sp.foot.cells.length) {
            const cell = sp.foot.cells[Math.floor(Math.random() * sp.foot.cells.length)]
            const ix = cell % sp.foot.cols
            const iz = Math.floor(cell / sp.foot.cols)
            x = sp.foot.originX + (ix + 0.5) * sp.foot.step
            z = sp.foot.originZ + (iz + 0.5) * sp.foot.step
          } else {
            x = sp.minX + Math.random() * Math.max(0.2, sp.maxX - sp.minX)
            z = sp.minZ + Math.random() * Math.max(0.2, sp.maxZ - sp.minZ)
          }
          const ang = Math.random() * Math.PI * 2
          crowd.push({
            minX: sp.minX, maxX: sp.maxX, minZ: sp.minZ, maxZ: sp.maxZ,
            x, z, vx: Math.cos(ang), vz: Math.sin(ang), y: sp.y,
            still: !sp.walks, band: 0, foot: sp.foot,
          })
          crowdDummy.position.set(x, sp.y, z)
          crowdDummy.rotation.set(0, 0, 0)
          crowdDummy.scale.set(1, 1, 1)
          crowdDummy.updateMatrix()
          mesh.setMatrixAt(idx, crowdDummy.matrix)
          glowDummy.position.set(x, sp.y - 0.08, z)
          glowDummy.rotation.set(0, 0, 0)
          glowDummy.scale.set(1, 1, 1)
          glowDummy.updateMatrix()
          glow.setMatrixAt(idx, glowDummy.matrix)
          glow.setColorAt(idx, GLOW_COLOR[0])
          idx++
        }
      }
      mesh.count = idx
      glow.count = idx
      mesh.instanceMatrix.needsUpdate = true
      glow.instanceMatrix.needsUpdate = true
      if (glow.instanceColor) glow.instanceColor.needsUpdate = true
      if (!mine()) {
        wipeCrowd()
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
        glow.geometry.dispose()
        if (crowdJobBusy === job) crowdJobBusy = 0
        return
      }
      overlay.add(mesh)
      overlay.add(glow)
      crowdMesh = mesh
      crowdGlowMesh = glow
      } finally {
        if (crowdJobBusy === job) crowdJobBusy = 0
      }
    }
    stepCrowd = () => {
      if (!crowdWanted()) {
        if (crowdMesh || crowdGlowMesh || crowd.length) clearCrowd()
        return
      }
      if (!crowdMesh || !crowd.length) return
      const step = 0.016 * occSpeed()
      // A person keeps about 10 px across, so a whole floor seen from above still shows them; up close they stay life size
      const cam = engine.world?.camera?.three as THREE.PerspectiveCamera | undefined
      const viewH = engine.world?.renderer?.three?.domElement?.clientHeight || 800
      const viewW = engine.world?.renderer?.three?.domElement?.clientWidth || 1200
      const perPx = cam?.isPerspectiveCamera ? 2 * Math.tan((cam.fov * Math.PI) / 360) / viewH : 0
      const crowdNear = new Map<string, number[]>()
      for (let n = 0; n < crowd.length; n++) {
        const q = crowd[n]
        const cx = Math.floor(q.x / 4), cz = Math.floor(q.z / 4)
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const bin = `${cx + dx}:${cz + dz}`
          const list = crowdNear.get(bin)
          if (list) list.push(n)
          else crowdNear.set(bin, [n])
        }
      }
      for (let i = 0; i < crowd.length; i++) {
        const p = crowd[i]
        /* Ordinary rooms stand still. A ticked name walks, and only on that room's floor. */
        if (!p.still) {
          if (Math.random() < 0.02) {
            const ang = Math.random() * Math.PI * 2
            p.vx = Math.cos(ang)
            p.vz = Math.sin(ang)
          }
          let nx = p.x + p.vx * step
          let nz = p.z + p.vz * step
          if (p.foot) {
            if (!onFoot(p.foot, nx, nz)) {
              if (onFoot(p.foot, nx, p.z)) nz = p.z
              else if (onFoot(p.foot, p.x, nz)) nx = p.x
              else { p.vx *= -1; p.vz *= -1; nx = p.x; nz = p.z }
            }
          } else {
            if (nx < p.minX || nx > p.maxX) { p.vx *= -1; nx = Math.max(p.minX, Math.min(nx, p.maxX)) }
            if (nz < p.minZ || nz > p.maxZ) { p.vz *= -1; nz = Math.max(p.minZ, Math.min(nz, p.maxZ)) }
          }
          p.x = nx
          p.z = nz
        }
        let near = 0
        const list = crowdNear.get(`${Math.floor(p.x / 4)}:${Math.floor(p.z / 4)}`)
        if (list) for (let k = 0; k < list.length; k++) {
          const o = crowd[list[k]]
          const dx = o.x - p.x
          const dz = o.z - p.z
          if (dx * dx + dz * dz < 16) near++
        }
        /* Neighbours within 4 m, the medical twin's bands */
        p.band = near <= 2 ? 0 : near <= 4 ? 1 : near <= 7 ? 2 : 3
        crowdDummy.position.set(p.x, p.y, p.z)
        crowdDummy.rotation.set(0, 0, 0)
        const grow = perPx && cam ? (10 * perPx * crowdDummy.position.distanceTo(cam.position)) / 0.44 : 1
        const personScale = Math.min(4, Math.max(1, grow))
        crowdDummy.scale.setScalar(personScale)
        crowdDummy.updateMatrix()
        crowdMesh.setMatrixAt(i, crowdDummy.matrix)
        if (crowdGlowMesh) {
          glowDummy.position.set(p.x, p.y - 0.08, p.z)
          glowDummy.rotation.set(0, 0, 0)
          /* 0 up close, 1 when the camera is far enough that people are held at 10 px.
             Close keeps the halo. Pulled back, it loses about a third, and a solid
             ceiling in front still covers it because the disc tests depth. */
          const pulled = (personScale - 1) / 3
          const radiusPx = Math.max(22, viewW * (0.05 - 0.016 * pulled))
          const dist = cam ? Math.max(0.5, glowDummy.position.distanceTo(cam.position)) : 1
          const radiusWorld = perPx > 0 ? radiusPx * perPx * dist : GLOW_RADIUS
          glowDummy.scale.setScalar(Math.max(0.35, radiusWorld / GLOW_RADIUS))
          glowDummy.updateMatrix()
          crowdGlowMesh.setMatrixAt(i, glowDummy.matrix)
          crowdGlowMesh.setColorAt(i, GLOW_COLOR[p.band] || GLOW_COLOR[0])
        }
      }
      crowdMesh.instanceMatrix.needsUpdate = true
      if (crowdGlowMesh) {
        crowdGlowMesh.instanceMatrix.needsUpdate = true
        if (crowdGlowMesh.instanceColor) crowdGlowMesh.instanceColor.needsUpdate = true
      }
    }
    const clearSpaceHeat = async () => {
      heatSeq++
      heatBusy = false
      heatAgain = false
      heatReq = null
      heatModeNow = 'temp'
      spaceHeatActive = false
      heatInsideWalls = false
      syncHeatClip()
      applySpacesGate()
      showHeatFloors(new Set())
      clearCrowd()
      heatRoots.forEach(root => { root.visible = false })
      heatByBim.forEach(rec => {
        unwatchClipping(rec.mat)
        rec.mat.dispose()
        try {
          if (typeof rec.model.resetColor === 'function') void rec.model.resetColor([rec.localId])
          if (typeof rec.model.setOpacity === 'function') void rec.model.setOpacity([rec.localId], 0.01)
        } catch { /* */ }
      })
      heatByBim.clear()
    }
    /* Split long edges so a room face can change colour across itself, not
       only at its corners. */
    const subdivideHeat = (geom: THREE.BufferGeometry, maxEdge: number) => {
      let g = geom.getIndex() ? geom.toNonIndexed() : geom.clone()
      const limit2 = maxEdge * maxEdge
      for (let pass = 0; pass < 2; pass++) {
        const pos = g.getAttribute('position') as THREE.BufferAttribute
        if (pos.count > 9000) break
        const src = pos.array as ArrayLike<number>
        const out: number[] = []
        let grew = false
        const at = (i: number) => [src[i], src[i + 1], src[i + 2]]
        const d2 = (a: number[], b: number[]) => {
          const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]
          return dx * dx + dy * dy + dz * dz
        }
        const push = (a: number[], b: number[], c: number[]) => {
          out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
        }
        for (let i = 0; i + 8 < src.length; i += 9) {
          const a = at(i), b = at(i + 3), c = at(i + 6)
          if (d2(a, b) <= limit2 && d2(b, c) <= limit2 && d2(c, a) <= limit2) {
            push(a, b, c)
            continue
          }
          grew = true
          const mid = (p: number[], q: number[]) => [(p[0] + q[0]) * 0.5, (p[1] + q[1]) * 0.5, (p[2] + q[2]) * 0.5]
          const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
          push(a, ab, ca)
          push(ab, b, bc)
          push(ca, bc, c)
          push(ab, bc, ca)
        }
        if (!grew) break
        const next = new THREE.BufferGeometry()
        next.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
        if (g !== geom) g.dispose()
        g = next
      }
      return g
    }
    /* The space keeps its real height. Colour is one field shared by every
       room, and the shell stays translucent so the model shows through it. */
    /* See-through (a room's faces do not hide one another) and with no depth pull: the solid already sits inside the room,
       and a pull grows with the slope, so its walls seen from above came through a closed ceiling as lines */
    const heatRoomMat = () => {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        toneMapped: false,
        clipping: true,
        vertexShader: `
          #include <clipping_planes_pars_vertex>
          attribute vec4 color;
          varying vec4 vColor;
          void main() {
            vColor = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            #include <clipping_planes_vertex>
          }
        `,
        fragmentShader: `
          #include <clipping_planes_pars_fragment>
          varying vec4 vColor;
          void main() {
            #include <clipping_planes_fragment>
            gl_FragColor = vColor;
          }
        `,
      })
      watchClipping(mat)
      return mat
    }
    /* The room's solid, a few centimetres inside its walls, floor and ceiling, so it never shares a surface with them */
    const paintRoom = (
      geom: THREE.BufferGeometry,
      own: { x: number; y: number; z: number; t: number; hx: number; hy: number; hz: number },
      samples: { x: number; z: number; t: number }[],
      sigma: number,
      low: THREE.Color,
      high: THREE.Color,
      occRamp = false,
    ) => {
      const g = subdivideHeat(geom, Math.max(sigma * 0.45, 0.4))
      const pos = g.getAttribute('position') as THREE.BufferAttribute
      const sx = own.hx > 0.08 ? Math.max((own.hx - 0.05) / own.hx, 0.85) : 1
      const sz = own.hz > 0.08 ? Math.max((own.hz - 0.05) / own.hz, 0.85) : 1
      const sy = own.hy > 0.06 ? (own.hy - 0.03) / own.hy : 1
      for (let i = 0; i < pos.count; i++) {
        pos.setX(i, own.x + (pos.getX(i) - own.x) * sx)
        pos.setY(i, own.y + (pos.getY(i) - own.y) * sy)
        pos.setZ(i, own.z + (pos.getZ(i) - own.z) * sz)
      }
      pos.needsUpdate = true
      const colors = new Float32Array(pos.count * 4)
      const tmp = new THREE.Color()
      const sigma2 = 2 * sigma * sigma
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i)
        let wsum = 0, tsum = 0
        for (const s of samples) {
          const d2 = (x - s.x) ** 2 + (z - s.z) ** 2
          const w = Math.exp(-d2 / sigma2)
          wsum += w
          tsum += w * s.t
        }
        const t = wsum > 0 ? tsum / wsum : own.t
        if (occRamp) {
          const a = t < 0.5 ? occBlue : occAmber
          const b = t < 0.5 ? occAmber : occRed
          tmp.copy(a).lerp(b, t < 0.5 ? t * 2 : (t - 0.5) * 2)
        } else tmp.copy(low).lerp(high, t)
        const o = i * 4
        colors[o] = tmp.r
        colors[o + 1] = tmp.g
        colors[o + 2] = tmp.b
        colors[o + 3] = 0.55
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 4))
      g.computeBoundingBox()
      g.computeBoundingSphere()
      const mesh = new THREE.Mesh(g, heatRoomMat())
      mesh.frustumCulled = false
      mesh.renderOrder = 2
      return mesh
    }
    const applySpaceHeat = async (zones: { bimId?: string; bimIds?: string[]; gid?: string; nameEn?: string; tempC?: number | null; rh?: number | null; co2?: number | null }[], mode?: string) => {
      heatReq = { zones, mode }
      const md = mode === 'comfort' || mode === 'hum' || mode === 'occ' ? mode : 'temp'
      heatModeNow = md
      /* People belong to Occupancy only. Clear them before any early return so another tab cannot keep the crowd. */
      if (md !== 'occ') clearCrowd()
      /* Locating every room shares the worker that is still parsing the next file. */
      if (useLoadingProgressStore.getState().sessionActive) return
      spaceHeatActive = true
      applySpacesGate()
      const inside = heatInsideOf()
      heatInsideWalls = inside
      const levelId = ((window as any).EKO?.state?.dock?.level as string) || 'ALL'
      const idsOf = (z: { bimId?: string; bimIds?: string[] }) =>
        (z.bimIds && z.bimIds.length ? z.bimIds : (z.bimId ? [z.bimId] : [])).filter(id => isGuid(id))
      const occPeople = () => {
        const n = useProjectStore.getState().currentProject?.apiSettings?.heatmap?.people
        return Math.max(0, Math.min(400, n == null || !Number.isFinite(Number(n)) ? 80 : Math.round(Number(n))))
      }
      const walkSig = () => {
        const heat = useProjectStore.getState().currentProject?.apiSettings?.heatmap
        const list = heat?.walkRooms
        const words = Array.isArray(list) ? list : WALK_WORDS
        return (heat?.stillRooms === false ? 'walk' : 'still') + '|' + words.map(w => w.trim().toLowerCase()).filter(Boolean).join(',')
      }
      const jobs: { bimId: string; t: number }[] = []
      for (const z of zones || []) {
        if (md === 'occ') {
          for (const bimId of idsOf(z)) jobs.push({ bimId, t: 0 })
          continue
        }
        const raw = md === 'comfort' ? z.co2 : md === 'hum' ? z.rh : z.tempC
        const t = heatT(md, raw == null ? null : Number(raw))
        if (t == null) continue
        for (const bimId of idsOf(z)) jobs.push({ bimId, t })
      }
      const valueSig = (inside ? 'in|' : 'out|') + md + '|' + (md === 'occ' ? 'p' + occPeople() + '|' + walkSig() + '|' : '') + jobs.map(j => `${j.bimId}:${round1(j.t)}`).join(';')
      // The zones the dashboard counts people in, keyed as it keys them
      const crowdZones = md === 'occ'
        ? (zones || []).filter(z => z.bimId || z.gid || (z.bimIds && z.bimIds.length))
          .map(z => ({ key: String((z.bimIds && z.bimIds[0]) || z.bimId || z.gid || z.nameEn || ''), ids: idsOf(z) }))
        : []
      const alone = !!(window as any).EKO?.state?.dock?.floorAlone
      if (valueSig === heatSig) {
        const ready = floorsInView(levelId, alone)
        const missingNow = ready.filter(id => !heatFloorSheets.get(id)?.done)
        if (ready.length && !missingNow.length) {
          showHeatFloors(new Set(ready))
          if (md === 'occ') await placeCrowd(ready, crowdZones, occPeople(), valueSig + '@' + ready.join(','))
          syncGhost()
          const wakeNow = engine.world?.renderer as { needsUpdate?: boolean } | undefined
          if (wakeNow) wakeNow.needsUpdate = true
          return
        }
        /* A list switch shares this signature. Starting the room walk over is what freezes the page. */
        if (heatBusy) return
      } else if (heatBusy) {
        heatAgain = true
        return
      } else {
        dropHeatSheets()
        heatSig = valueSig
      }
      const seq = ++heatSeq
      heatBusy = true
      try {
      const wanted = new Set(jobs.map(job => job.bimId))
      if (levelId && levelId !== 'ALL') await guidsForFloor(levelId, wanted)
      else {
        for (const model of engine.fragments?.models?.list?.values() ?? []) await readStoreys(model)
      }
      if (seq !== heatSeq) return
      const order = floorsInView(levelId, alone)
      const show = new Set(order)
      showHeatFloors(show)
      const missing = order.filter(id => !heatFloorSheets.get(id)?.done)
      const wake = engine.world?.renderer as { needsUpdate?: boolean } | undefined
      if (!missing.length) {
        if (md === 'occ') await placeCrowd(order, crowdZones, occPeople(), valueSig + '@' + order.join(','))
        syncGhost()
        if (wake) wake.needsUpdate = true
        return
      }
      const stops = HEAT_STOPS[md] || HEAT_STOPS.temp
      const low = new THREE.Color(stops[0])
      const high = new THREE.Color(stops[1])
      /* Batches yield to the page, not to a drawn frame: without a GPU one frame takes seconds and would set the pace */
      const nextFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0))
      let batchFrom = performance.now()
      for (const floorId of missing) {
        if (seq !== heatSeq) return
        let kept = heatFloorSheets.get(floorId)
        if (!kept) {
          kept = { meshes: [], guids: new Set(), done: false }
          heatFloorSheets.set(floorId, kept)
        }
        const guids = await guidsForFloor(floorId, wanted)
        if (seq !== heatSeq) return
        await locateMany([...guids])
        if (seq !== heatSeq) return
        /* Occupancy colours the people, not the room, the same way the medical twin does. */
        if (md === 'occ') {
          for (const id of guids) kept.guids.add(id)
          if (seq === heatSeq) kept.done = true
          continue
        }
        type Room = { model: any; geoms: THREE.BufferGeometry[]; x: number; y: number; z: number; hx: number; hy: number; hz: number; t: number; guid: string; area: number }
        const rooms: Room[] = []
        for (const job of jobs) {
          if (!guids.has(job.bimId) || kept.guids.has(job.bimId)) continue
          const entry = located.get(job.bimId)
          if (!entry?.localBox || entry.localBox.isEmpty()) continue
          const size = entry.localBox.getSize(new THREE.Vector3())
          const c = entry.localBox.getCenter(new THREE.Vector3())
          rooms.push({
            model: entry.model, geoms: [],
            x: c.x, y: c.y, z: c.z, hx: size.x / 2, hy: size.y / 2, hz: size.z / 2,
            t: job.t, guid: job.bimId, area: Math.abs(size.x * size.z),
          })
        }
        await solidsFor(rooms.map(r => { const e = located.get(r.guid)!; return { guid: r.guid, model: e.model, localId: e.localId, box: e.localBox } }))
        if (seq !== heatSeq) return
        for (const room of rooms) room.geoms = [heatSolids.get(room.guid) || solidFrom([], located.get(room.guid)!.localBox)]
        const areas = rooms.map(r => r.area).filter(a => a > 1).sort((a, b) => a - b)
        const typical = areas.length ? areas[Math.floor(areas.length / 2)] : 0
        const paint = typical > 0 ? rooms.filter(r => r.area <= typical * 16) : rooms
        const byModel = new Map<any, Room[]>()
        for (const room of paint) {
          const list = byModel.get(room.model) || []
          list.push(room)
          byModel.set(room.model, list)
        }
        for (const [model, samples] of byModel) {
          const field = new Map<string, { x: number; z: number; n: number; t: number }>()
          for (const room of samples) {
            const key = room.t.toFixed(3)
            const g = field.get(key) ?? { x: 0, z: 0, n: 0, t: room.t }
            g.x += room.x
            g.z += room.z
            g.n++
            field.set(key, g)
          }
          const graded = samples.length > 24
            ? [...field.values()].map(g => ({ x: g.x / g.n, z: g.z / g.n, t: g.t }))
            : samples
          let near = 0, nearN = 0
          for (let i = 0; i < graded.length; i++) {
            let best = Infinity
            for (let j = 0; j < graded.length; j++) {
              if (i === j) continue
              best = Math.min(best, Math.hypot(graded[i].x - graded[j].x, graded[i].z - graded[j].z))
            }
            if (isFinite(best) && best > 0) { near += best; nearN++ }
          }
          const sigma = Math.max(nearN ? (near / nearN) * 0.85 : 1, 0.5)
          const root = heatRootOf(model)
          for (const room of samples) {
            if (seq !== heatSeq) return
            for (const geom of room.geoms) {
              const mesh = paintRoom(geom, room, graded, sigma, low, high)
              mesh.visible = true
              root.add(mesh)
              heatSheets.push(mesh)
              kept.meshes.push(mesh)
            }
            kept.guids.add(room.guid)
            /* One redraw per batch of rooms, not per room: each redraw draws the whole building twice */
            if (performance.now() - batchFrom > 12) {
              syncGhost()
              if (wake) wake.needsUpdate = true
              await nextFrame()
              batchFrom = performance.now()
            }
          }
        }
        syncGhost()
        if (wake) wake.needsUpdate = true
        if (seq === heatSeq) kept.done = true
      }
      if (seq === heatSeq && md === 'occ') {
        await placeCrowd(order, crowdZones, occPeople(), valueSig + '@' + order.join(','))
        syncGhost()
        if (wake) wake.needsUpdate = true
      }
      return
      } finally {
        if (seq === heatSeq) {
          heatBusy = false
          if (heatAgain && heatReq) {
            heatAgain = false
            void applySpaceHeat(heatReq.zones, heatReq.mode)
          }
        }
      }
    }

    // Same rule as isAlarmed
    const alarmedBimIds = () => {
      const data = (window as any).EKO?.data || {}
      const out = new Set<string>()
      for (const a of data.alarms || []) {
        const bimId = bimIdFor(a.asset) || (isGuid(a.bimId) ? a.bimId : null)
        if (bimId) out.add(bimId)
      }
      for (const a of data.assets || []) {
        if (a.st !== 'alarm') continue
        const bimId = bimIdFor(a.id)
        if (bimId) out.add(bimId)
      }
      return out
    }
    const dropAlarmGlow = (bimId: string) => {
      const rec = alarmGlow.get(bimId)
      if (!rec) return
      rec.group.removeFromParent()
      rec.edges.forEach(g => g.dispose())   // the meshes share heatGeoms' cached geometry
      alarmGlow.delete(bimId)
    }
    // Only the latest call wins
    const syncAlarmGlow = async () => {
      const seq = ++alarmSeq
      const want = useAppStore.getState().templateId === 'xray' ? alarmedBimIds() : new Set<string>()
      for (const bimId of [...alarmGlow.keys()]) if (!want.has(bimId)) dropAlarmGlow(bimId)
      for (const bimId of want) {
        if (alarmGlow.has(bimId)) continue
        const entry = await locate(bimId)
        if (seq !== alarmSeq) return
        if (!entry) continue
        const geoms = await geomsFor(bimId, entry)
        if (seq !== alarmSeq) return
        if (!geoms.length) continue
        const group = new THREE.Group()
        group.matrixAutoUpdate = false
        const edges: THREE.BufferGeometry[] = []
        for (const geom of geoms) {
          const edge = new THREE.EdgesGeometry(geom, 25)
          edges.push(edge)
          const depth = new THREE.Mesh(geom, ghostDepth)
          const fill = new THREE.Mesh(geom, alarmFill)
          const line = new THREE.LineSegments(edge, alarmEdge)
          depth.renderOrder = 0
          fill.renderOrder = 1
          line.renderOrder = 2
          group.add(depth, fill, line)
        }
        alarmGlow.set(bimId, { group, model: entry.model, localId: entry.localId, edges })
        overlay.add(group)
      }
      syncGhost()
    }
    const unsubTemplate = useAppStore.subscribe((s, prev) => {
      if (s.templateId !== prev.templateId) void syncAlarmGlow()
    })
    const unsubLinks = useProjectStore.subscribe((s, prev) => {
      if (s.currentProject?.assetLinks === prev.currentProject?.assetLinks
        && s.currentProject?.apiSettings?.dashboardCameraSource === prev.currentProject?.apiSettings?.dashboardCameraSource) return
      void resolveAllAssetPositions()
      try { (window as { EKO_HEAT?: { relink?: () => void } }).EKO_HEAT?.relink?.() } catch { /* the next equipment refresh rebuilds the zones */ }
      try { (window as { EKO?: { set?: (patch: object) => void } }).EKO?.set?.({}) } catch { /* the dashboard redraws on its next refresh */ }
    })

    /* While the heatmap is up, only the models the project ticked stay light.
       Nothing fades until a file is named. Glass that is already fainter is left as it is. */
    const heatFadeOf = () => {
      const heat = useProjectStore.getState().currentProject?.apiSettings?.heatmap
      const names = Array.isArray(heat?.fadeModels) ? heat.fadeModels : []
      const amount = typeof heat?.fadeAmount === 'number' ? Math.min(0.8, Math.max(0.15, heat.fadeAmount)) : 0.35
      return { names, amount }
    }
    const modelFades = (fileName: string) => heatFadeOf().names.includes(fileName)
    let archFadeOn = false
    const modelObject = (rec: { modelId: string; type?: string }) => {
      const fragList = engine.fragments?.models?.list
      if (rec.type === 'glb') {
        return engine.world?.scene?.three?.children?.find((c: any) => c.userData?.modelId === rec.modelId) ?? null
      }
      const direct = fragList?.get(rec.modelId)?.object
      if (direct) return direct
      if (!fragList) return null
      for (const [, mod] of fragList) {
        if ((mod as any)?.object?.userData?.modelId === rec.modelId) return (mod as any).object
      }
      return null
    }
    // The parked renderer does not draw until a frame is asked for.
    const wakeView = () => {
      const renderer = engine.world?.renderer as { needsUpdate?: boolean } | undefined
      if (renderer) renderer.needsUpdate = true
    }
    const fadeArch = (on: boolean) => {
      archFadeOn = on
      const amount = heatFadeOf().amount
      for (const rec of useModelStore.getState().models) {
        const fadeThis = on && modelFades(rec.originalFileName || '')
        const root = modelObject(rec)
        if (!root) continue
        root.traverse((obj: any) => {
          const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : []
          for (const mat of mats) {
            if (!mat) continue
            if (fadeThis) {
              if (mat.userData?.ekoArchFade === amount && mat.opacity === amount && mat.depthWrite === false) continue
              if (!mat.userData?.ekoArchSaved && mat.transparent && typeof mat.opacity === 'number' && mat.opacity < amount) continue
              if (!mat.userData.ekoArchSaved) {
                mat.userData.ekoArchSaved = { opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite }
              }
              mat.userData.ekoArchFade = amount
              mat.opacity = amount
              mat.transparent = true
              mat.depthWrite = false
              mat.needsUpdate = true
            } else if (mat.userData?.ekoArchSaved) {
              const saved = mat.userData.ekoArchSaved
              mat.opacity = saved.opacity
              mat.transparent = saved.transparent
              mat.depthWrite = saved.depthWrite
              delete mat.userData.ekoArchSaved
              delete mat.userData.ekoArchFade
              mat.needsUpdate = true
            }
          }
          if (!obj.isMesh) return
          if (fadeThis) {
            if (obj.userData.ekoArchCast == null) obj.userData.ekoArchCast = !!obj.castShadow
            obj.castShadow = false
          } else if (obj.userData.ekoArchCast != null) {
            obj.castShadow = obj.userData.ekoArchCast
            delete obj.userData.ekoArchCast
          }
        })
      }
      wakeView()
    }

    /* Whole models, by the discipline in the file name (lib/layerGroups): every model of a chosen
       discipline shows, the rest hide. Item visibility (the floor filter) is left as it is. */
    let lastLayerKey = ''
    const isolateLayer = (layerId: string | string[], force?: boolean) => {
      const models = useModelStore.getState().models
      /* A view the dashboard set up (heat map, Systems page, Reset) keeps site, landscape and other models around it */
      const keepContext = !!(window as any).EKO?.state?.dock?.layerContext
      const key = (Array.isArray(layerId) ? layerId.slice().sort().join('|') : String(layerId || ''))
        + (keepContext ? '+ctx' : '') + '#' + [...new Set(models.map(m => m.modelId))].sort().join(',')
      if (!force && key === lastLayerKey) return
      lastLayerKey = key
      const shown = layerVisibility(models, layerId, { keepContext, spacesVisible: spacesShown() })
      const fragList = engine.fragments?.models?.list
      for (const m of models) {
        const visible = shown.get(m.modelId) ?? true
        useModelStore.getState().setModelVisibility(m.modelId, visible)
        let object3D = m.type === 'glb'
          ? engine.world?.scene?.three?.children?.find((c: any) => c.userData?.modelId === m.modelId)
          : fragList?.get(m.modelId)?.object
        if (!object3D && fragList) {
          for (const [, mod] of fragList) {
            if ((mod as any)?.object?.userData?.modelId === m.modelId) {
              object3D = (mod as any).object
              break
            }
          }
        }
        if (object3D) object3D.visible = visible
      }
      repositionMarkers()
      wakeView()
    }

    /* The Layers menu follows the registry: a model that registers late adds its discipline, a new
       project replaces the list, and a choice left over from the old project goes back to All layers. */
    let layerSig = ''
    let knownIds = new Set<string>()
    let warnedOther = ''

    /* A model whose name says nothing is read once for what it contains (lib/layerGroups.disciplineFromContent). */
    const readContentProfile = async (model: any): Promise<ContentProfile> => {
      const ids: number[] = await model.getItemsIdsWithGeometry()
      const withGeometry = new Set(ids)
      const classes: Record<string, number> = {}
      for (const category of (await model.getCategories()) as string[]) {
        if (/TYPE$/i.test(category)) continue
        const found = await model.getItemsOfCategories([new RegExp(`^${category}$`, 'i')])
        const n = (Object.values(found || {}).flat() as number[]).filter(id => withGeometry.has(id)).length
        if (n) classes[category] = n
      }
      return { total: ids.length, classes }
    }
    const profileTries = new Map<string, number>()
    const profiling = new Set<string>()
    const ensureProfiles = () => {
      if (useLoadingProgressStore.getState().sessionActive) return
      const fragList = engine.fragments?.models?.list
      if (!fragList) return
      for (const rec of useModelStore.getState().models) {
        const id = rec.modelId
        if (rec.type === 'glb' || hasContentProfile(id) || profiling.has(id) || classifyModel(rec.originalFileName).known) continue
        const model = fragList.get(id) as any
        if (!model || (profileTries.get(id) ?? 0) >= 5) continue
        profileTries.set(id, (profileTries.get(id) ?? 0) + 1)
        profiling.add(id)
        // The worker registers a model a moment after it loads; a failed read is tried again on the next tick
        readContentProfile(model).then(profile => setContentProfile(id, profile)).catch(() => {}).finally(() => profiling.delete(id))
      }
    }

    const syncLayers = () => {
      const models = useModelStore.getState().models
      const ids = new Set(models.map(m => m.modelId))
      pruneContentProfiles(ids)
      ensureProfiles()
      applySpacesGate()
      const sig = layerIds(models).join('|') + '#' + models.map(m => `${m.modelId}:${classifyLoaded(m).group}:${hasContentProfile(m.modelId) ? 1 : 0}`).sort().join(',')
      if (sig === layerSig) return
      layerSig = sig
      const eko = (window as any).EKO
      const dock = eko?.state?.dock
      // A pick from the menu belongs to the old project; a page's own layers (heat map, Systems) still apply
      if (isProjectSwitch(knownIds, ids) && dock && dock.layer && dock.layer !== 'all' && !dock.layerContext) dock.layer = 'all'
      knownIds = ids
      // A model is reported once its content has been read (or when there is no content to read)
      const lines = describeUnclassified(models.filter(m => m.type === 'glb' || hasContentProfile(m.modelId))).sort()
      const other = lines.join(' | ')
      if (other && other !== warnedOther) {
        console.warn(`[layers] ${lines.length} model(s) have no recognised discipline: listed under Other in Layers and Unclassified in the tree. Add a rule in src/lib/layerGroups.ts: ${other}`)
      }
      warnedOther = other
      // Only a real choice is applied; All layers leaves each model's own visibility alone
      if (dock?.layer && dock.layer !== 'all') isolateLayer(dock.layer, true)
      try { eko?.set?.({}) } catch { /* the dashboard redraws on its next render */ }
    }
    const unsubStore = useModelStore.subscribe(syncLayers)
    // Content read: the Layers menu and the tree both place the model from it
    const unsubProfiles = onContentProfiles(() => {
      syncLayers()
      window.dispatchEvent(new Event('eko-tree-sync'))
    })
    const unsubLayers = () => { unsubStore(); unsubProfiles() }
    syncLayers()
    ;(window as any).EKO_MODEL_DISCIPLINES = () => describeModels(useModelStore.getState().models)
    // TEMPORARY, read-only: why the floor filter hides what it hides (describeLevelFilter above)
    ;(window as any).EKO_FLOOR_FILTER_REPORT = async (levelId?: string) => {
      const report = await describeLevelFilter(levelId)
      console.log('[EKO_FLOOR_FILTER_REPORT]', JSON.stringify(report, null, 2))
      return report
    }
    // TEMPORARY, read-only: what the loaded models contain (lib/ifcDiagnostics.ts)
    ;(window as any).EKO_IFC_DIAGNOSTICS = (which?: string | string[]) => runIfcDiagnostics({
      models: useModelStore.getState().models, fragments: engine.fragments?.models?.list,
      loadedInEngine: useModelStore.getState().modelsLoadedInEngine, classify: classifyLoaded,
    }, which)

    /* Floor, tree and template hides all land here once the worker has them */
    const unsubVisibility = onVisibilityApplied(() => {
      const done = engine.fragments?.update?.(true) as Promise<unknown> | void
      if (done && typeof done.then === 'function') void done.then(wakeView, wakeView)
      wakeView()
      repositionMarkers()
    })

    const miniMap = createMiniMap(engine)
    const afterFrame = () => {
      drawGhost()
      miniMap.capture()
      // Fans in the shown equipment and the occupancy crowd move only while frames are drawn
      const spinning = !!(active && ghost?.group.visible)
      if (spinning || (crowdMesh && crowd.some(p => !p.still))) {
        const wake = engine.world?.renderer as { needsUpdate?: boolean } | undefined
        if (wake) wake.needsUpdate = true
      }
    }

    const applyPose = (view: { position?: number[]; target?: number[] } | null | undefined, smooth: boolean, exact = false) => {
      const camCtl = engine.world?.camera?.controls as { setLookAt?: Function; updateCameraUp?: Function } | undefined
      const pos = view?.position
      const tgt = view?.target
      if (!camCtl?.setLookAt || !pos || !tgt || pos.length !== 3 || tgt.length !== 3) return false
      const cam = engine.world?.camera?.three as THREE.PerspectiveCamera | undefined
      // exact keeps a stored camera, such as the heatmap's saved view, as it was saved.
      const target = new THREE.Vector3(tgt[0], tgt[1], tgt[2])
      const offset = new THREE.Vector3(pos[0], pos[1], pos[2]).sub(target)
      if (!exact) tiltIfVertical(offset)
      const position = target.clone().add(offset)
      cam?.up.set(0, 1, 0)
      camCtl.updateCameraUp?.()
      camCtl.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, smooth)
      const wake = engine.world?.renderer as { needsUpdate?: boolean } | undefined
      if (wake) wake.needsUpdate = true
      return true
    }
    const lookAtView = (view?: { position?: number[]; target?: number[] }) => applyPose(view, true)

    /* Furniture on whatever models are loaded. Furnishing classes, plus proxies in
       interior and equipment files (the pack's furniture group). Hidden through
       the coordinator so the floor picker and the tree keep their own hides. */
    const FURN_CLASS = [/^IFCFURNISHINGELEMENT$/i, /^IFCFURNITURE$/i, /^IFCSYSTEMFURNITUREELEMENT$/i]
    const FURN_PROXY = [/^IFCBUILDINGELEMENTPROXY$/i]
    let furnitureOn = true
    let furnitureSeq = 0
    const furnitureIds = new Map<string, number[]>()
    const applyFurniture = async (on: boolean) => {
      furnitureOn = on
      const seq = ++furnitureSeq
      const list = engine.fragments?.models?.list
      if (!list) return
      for (const [id, model] of list) {
        if (seq !== furnitureSeq) return
        let ids = furnitureIds.get(id)
        if (!ids) {
          const rec = useModelStore.getState().models.find(m => m.modelId === id)
          const name = (rec?.originalFileName || id).toLowerCase()
          const classes = /interior|equipment/.test(name) ? [...FURN_CLASS, ...FURN_PROXY] : FURN_CLASS
          try {
            const found = await (model as { getItemsOfCategories?: (c: RegExp[]) => Promise<Record<string, number[]>> }).getItemsOfCategories?.(classes)
            ids = Object.values(found ?? {}).flat()
          } catch { ids = [] }
          furnitureIds.set(id, ids)
        }
        if (seq !== furnitureSeq) return
        try { await setHidden(model as { setVisible: (ids: number[] | undefined, visible: boolean) => Promise<void> }, 'furniture', on ? [] : ids) } catch { /* worker busy */ }
      }
      if (seq !== furnitureSeq) return
      void engine.fragments.update(true)
      const wake = engine.world?.renderer as { needsUpdate?: boolean } | undefined
      if (wake) wake.needsUpdate = true
    }

    /* Plan looks down on the loaded model. 3D on the heatmap uses that page's saved
       view. Every other page puts back the camera from before Plan, or the project
       camera when that was not stored. Home, and leaving a page, drop Plan. */
    let planOn = false
    let planHeld = false
    let planFramed = false
    let planSaved: { position: number[]; target: number[] } | null = null
    const readPose = () => {
      const cam = engine.world?.camera?.controls as {
        getPosition?: (out: THREE.Vector3, end?: boolean) => void
        getTarget?: (out: THREE.Vector3, end?: boolean) => void
      } | undefined
      if (!cam?.getPosition || !cam?.getTarget) return null
      const position = new THREE.Vector3()
      const target = new THREE.Vector3()
      // camera-controls defaults to the transition end. false is the camera on screen.
      cam.getPosition(position, false)
      cam.getTarget(target, false)
      return {
        position: [position.x, position.y, position.z],
        target: [target.x, target.y, target.z],
      }
    }
    /* The view saved in project settings for the heatmap. Null off that page, and
       when the heatmap is set to look inside the floor or has no saved view. */
    const heatmapSavedView = () => {
      if ((window as any).EKO?.state?.pageId !== 'heatmap') return null
      const heat = useProjectStore.getState().currentProject?.apiSettings?.heatmap
      if (!heat || heat.camera === 'inside') return null
      const view = heat.view
      if (!view?.position || !view?.target || view.position.length !== 3 || view.target.length !== 3) return null
      return view
    }
    const showPlan = () => {
      planHeld = false
      planFramed = frameModelFromAbove(engine)
      const wake = engine.world?.renderer as { needsUpdate?: boolean } | undefined
      if (wake) wake.needsUpdate = true
    }
    const setViewMode = (mode: string) => {
      const on = mode === 'plan'
      if (on) {
        if (!planOn) planSaved = readPose()
        planOn = true
        showPlan()
        return
      }
      const heat = heatmapSavedView()
      if (!planOn && !heat) return
      planOn = false
      planHeld = false
      planFramed = false
      const saved = planSaved
      planSaved = null
      // A heatmap top-look still in flight would replace the view we just put back.
      window.dispatchEvent(new CustomEvent('eko-look-cancel'))
      if (heat) applyPose(heat, false, true)
      else if (saved) applyPose(saved, false, true)
      else resetCameraToHome(engine)
    }
    const leavePlan = () => {
      if (!planOn && !planSaved) return
      planOn = false
      planHeld = false
      planFramed = false
      planSaved = null
      const eko = (window as any).EKO
      if (eko?.state?.e3dMode === 'plan') {
        eko.state.e3dMode = '3d'
        queueMicrotask(() => { if (eko.state?.e3dMode === '3d') eko.set?.({ e3dMode: '3d' }) })
      }
    }
    /* The dashboard closing puts the 3D pose back. Opening it looks down again
       while Plan is still the selected mode. */
    const setDashboardOpen = (open: boolean) => {
      if (!planOn || !planSaved) return
      if (open) { if (planHeld) showPlan(); return }
      if (planHeld) return
      applyPose(planSaved, false)
      planHeld = true
    }

    ;(window as any).EKO_HOST_ENGINE = {
      projectPoint,
      resolveAllAssetPositions,
      // data-map.js calls this on refresh: keep the selected equipment's colour current
      applyStatusColors: () => { syncColour(); void syncAlarmGlow() },
      flyToAsset,
      highlightAsset,
      clearHighlight,
      resetView: () => { leavePlan(); resetCameraToHome(engine) },
      setViewMode,
      setDashboardOpen,
      bimIdFor,
      inModel,
      cameraSetup,
      isAlarmed,
      listMapped: () => links().list.map(m => ({ id: m.equip, bimId: m.guid })),
      spaceLinks: () => indexSpaceLinks(useProjectStore.getState().currentProject?.assetLinks),
      listLevels: () => levels.map(l => ({ id: l.id, name: l.name, rank: l.rank })),
      /* The toolbar name for a storey string: "Level 1" and "LEVEL 1" are both First floor. */
      floorOf: (raw: string) => {
        const text = String(raw || '').trim()
        if (!text) return null
        const known = floorCatalog.get(text)
        const floor = known || floorKey(text)
        return floor ? { id: floor.id, name: floor.name, rank: floor.rank } : null
      },
      captureCamera: () => {
        const cam = engine.world?.camera?.controls as { getPosition?: (out: THREE.Vector3) => void; getTarget?: (out: THREE.Vector3) => void } | undefined
        if (!cam?.getPosition || !cam?.getTarget) return null
        const position = new THREE.Vector3()
        const target = new THREE.Vector3()
        cam.getPosition(position)
        cam.getTarget(target)
        return {
          position: [position.x, position.y, position.z] as [number, number, number],
          target: [target.x, target.y, target.z] as [number, number, number],
        }
      },
      lookAtView,
      isolateLevel,
      focusAsset,
      styleDuringFocus,
      cutAboveAsset,
      outlineFloorOf,
      listLayers: () => layerIds(useModelStore.getState().models).map(id => ({ id, name: id })),
      isolateLayer,
      fadeArch,
      applySpaceHeat,
      clearSpaceHeat,
      bindWallOrbit: () => {
        const cam = engine.world?.camera?.controls as {
          connect?: (el: HTMLElement) => void
          disconnect?: () => void
          _domElement?: HTMLElement
          currentAction?: number
          _addAllEventListeners?: (el: HTMLElement) => void
          _removeAllEventListeners?: (el: HTMLElement) => void
        }
        const canvas = engine.world?.renderer?.three?.domElement as HTMLElement | undefined
        if (!cam || !canvas) return
        const wallOn = !!document.querySelector('.dashboard-native-container[data-wall="1"]')
        const hit = document.querySelector('.wmodelhit') as HTMLElement | null
        const target = wallOn && hit ? hit : canvas
        const dragging = !!cam.currentAction || !!document.querySelector('.wmodelhit[data-drag="1"]')
        if (dragging && target !== canvas) return
        document.querySelectorAll('.wmodelhit').forEach((el) => el.removeAttribute('data-on'))
        if (cam._domElement === target) {
          if (target === hit) hit.setAttribute('data-on', '1')
          return
        }
        try {
          if (typeof cam.disconnect === 'function') cam.disconnect()
          else if (cam._domElement && typeof cam._removeAllEventListeners === 'function') cam._removeAllEventListeners(cam._domElement)
        } catch { /* keep going */ }
        try {
          if (typeof cam.connect === 'function') cam.connect(target)
          else if (typeof cam._addAllEventListeners === 'function') {
            cam._domElement = target
            cam._addAllEventListeners(target)
          }
          if (target === hit) hit.setAttribute('data-on', '1')
        } catch { /* canvas stays bound */ }
      },
      startMeasure: () => measureTool()?.start(),
      cancelMeasure: () => measureTool()?.cancel(),
      finishMeasure: () => measureTool()?.finish(),
      clearMeasure: () => measureTool()?.clear(),
      startSlice: () => sliceTool()?.start(),
      stopSlice: () => sliceTool()?.stop(),
      clearSection: () => sliceTool()?.clear(),
      attachMiniMap: (el: HTMLElement | null) => miniMap.attach(el),
      setMiniMap: (on: boolean) => miniMap.setEnabled(on),
      setFurnitureVisible: (on: boolean) => { void applyFurniture(on !== false) },
      setOccupancyStill: (on: boolean) => {
        const cur = useProjectStore.getState().currentProject
        if (!cur) return
        const heat = { ...(cur.apiSettings?.heatmap || {}) }
        if (on) delete heat.stillRooms
        else heat.stillRooms = false
        const apiSettings = { ...(cur.apiSettings || {}), heatmap: heat }
        useProjectStore.setState({ currentProject: { ...cur, apiSettings } })
        const save = useProjectStore.getState().saveApiSettings
        if (useProjectStore.getState().folderHandle) void save(apiSettings).catch(() => { /* the open view already has the choice */ })
      },
    }
    const dashState = (window as any).EKO?.state
    if (dashState?.e3dFurn === false) void applyFurniture(false)
    if (dashState?.e3dMode === 'plan') setViewMode('plan')
    // The dashboard may have rendered before the bridge existed: redraw so the
    // equipment markers (which need bimIdFor) appear.
    try { (window as any).EKO?.set?.({}) } catch {}
    if ((window as any).EKO?.state?.pageId === 'heatmap') fadeArch(true)

    /* Re-project in the same frame the camera moved, so markers stay glued to
       the model while orbiting instead of trailing behind by a couple frames. */
    const onCameraUpdate = () => {
      const eko = (window as any).EKO
      const V = (window as any).EKO_V
      if (eko && typeof V?.position === 'function') V.position(eko)
    }
    const controls = engine.world?.camera?.controls as {
      addEventListener: Function
      removeEventListener: Function
      setLookAt?: Function
      updateCameraUp?: Function
    } | undefined
    const onHeatCamera = (e: Event) => {
      applyPose((e as CustomEvent).detail, true, true)
    }
    controls?.addEventListener('update', onCameraUpdate)
    window.addEventListener('eko-heat-camera', onHeatCamera)
    engine.world?.renderer?.onBeforeUpdate?.add(syncGhost)
    engine.world?.renderer?.onAfterUpdate?.add(afterFrame)

    // Models can finish loading well after the dashboard: retry until located.
    // Any change to the loaded models forgets the "not found" answers and
    // drops entries that point at a model which is gone.
    const modelKeys = new WeakMap<object, number>()
    let nextKey = 0
    const keyOf = (m: object) => modelKeys.get(m) ?? (modelKeys.set(m, ++nextKey), nextKey)
    let modelsSig = ''
    let modelsWereLoading = useLoadingProgressStore.getState().sessionActive
    const resolveTimer = setInterval(() => {
      const loading = useLoadingProgressStore.getState().sessionActive
      if (loading) { modelsWereLoading = true; return }
      const justLoaded = modelsWereLoading
      modelsWereLoading = false
      ensureProfiles()
      applySpacesGate()
      const live = [...(engine.fragments?.models?.list?.values() ?? [])]
      const sig = live.map(keyOf).join('|')   // object identity: a reload of the same file counts as a change
      let modelsChanged = false
      const prevSig = modelsSig
      if (sig !== modelsSig) {
        modelsChanged = true
        modelsSig = sig
        furnitureIds.clear()
        if (!furnitureOn) void applyFurniture(false)
        missing.clear()
        assetFloor.clear()
        floorRooms.clear()
        heatSolids.clear()
        indexProven = false
        barrenPasses = 0
        const alive = new Set(live)
        for (const [id, e] of located) if (!alive.has(e.model)) located.delete(id)
      } else if (live.length && !indexProven) {
        barrenPasses++
      }
      void resolveAllAssetPositions()
      if (modelsChanged) {
        lastLevelId = null
        lastLayerKey = ''
        void refreshLevels()
        const layer = (window as any).EKO?.state?.dock?.layer
        if (layer && layer !== 'all') isolateLayer(layer)
      }
      // A control room opened from its own URL goes home once its models load.
      // Plan keeps the top-down camera of the loaded model.
      if (modelsChanged && live.length && !planOn && document.querySelector('.dashboard-native-container[data-wall="1"]')) resetCameraToHome(engine)
      if (modelsChanged && planOn && (prevSig || !planFramed)) planFramed = frameModelFromAbove(engine)
      if (justLoaded && levelWait) {
        const wait = levelWait
        levelWait = null
        void isolateLevel(wait.id, true, wait.alone)
      }
      if (justLoaded && heatReq && (window as any).EKO?.state?.pageId === 'heatmap') {
        void applySpaceHeat(heatReq.zones, heatReq.mode)
      }
    }, 3000)
    if (!useLoadingProgressStore.getState().sessionActive) {
      void resolveAllAssetPositions()
      void refreshLevels()
    }

    const stopPeek = startPeekFramer(engine)

    return () => {
      if (planSaved) applyPose(planSaved, false)
      stopPeek()
      try {
        document.querySelectorAll('.wmodelhit').forEach((el) => el.remove())
        const canvas = engine.world?.renderer?.three?.domElement as HTMLElement | undefined
        const cam = engine.world?.camera?.controls as { connect?: (el: HTMLElement) => void; disconnect?: () => void }
        if (cam && canvas) {
          cam.disconnect?.()
          cam.connect?.(canvas)
        }
      } catch { /* viewer keeps its canvas */ }
      controls?.removeEventListener('update', onCameraUpdate)
      window.removeEventListener('eko-heat-camera', onHeatCamera)
      engine.world?.renderer?.onBeforeUpdate?.remove(syncGhost)
      engine.world?.renderer?.onAfterUpdate?.remove(afterFrame)
      clearCrowd()
      glowGeo.dispose()
      glowMat.dispose()
      glowTex?.dispose()
      miniMap.dispose()
      clearInterval(resolveTimer)
      fadeArch(false)
      if (focusPrev) {
        const dock = (window as any).EKO?.state?.dock
        if (dock && focusDock != null) dock.style = focusDock
        useAppStore.getState().setLightingParams(focusPrev)
      }
      dropOutline()
      outlineMat.dispose()
      void clearHighlight()
      void clearSpaceHeat()
      removeGhost()
      unsubTemplate()
      unsubLinks()
      unsubVisibility()
      unsubLayers()
      alarmSeq++
      for (const bimId of [...alarmGlow.keys()]) dropAlarmGlow(bimId)
      unwatchClipping(alarmFill)
      unwatchClipping(alarmEdge)
      alarmFill.dispose()
      alarmEdge.dispose()
      unwatchClipping(heatOccluder)
      heatOccluder.dispose()
      unwatchClipping(ghostDepth)
      unwatchClipping(ghostFill)
      unwatchClipping(ghostEdge)
      ghostDepth.dispose()
      ghostFill.dispose()
      ghostEdge.dispose()
      fcuEnv?.dispose()
      delete (window as any).EKO_HOST_ENGINE
      delete (window as any).EKO_MODEL_DISCIPLINES
      delete (window as any).EKO_IFC_DIAGNOSTICS
      delete (window as any).EKO_FLOOR_FILTER_REPORT
    }
  }, [engineReady])

  useEffect(() => {
    const host = (window as any).EKO_HOST_ENGINE as { setDashboardOpen?: (open: boolean) => void } | undefined
    host?.setDashboardOpen?.(visible)
  }, [visible, engineReady])

  useEffect(() => {
    if (!visible) return
    const signal = { mounted: true }
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent
      if (customEvent.detail?.action === 'setTemplate') {
        const { templateId } = customEvent.detail
        const setLightingParams = useAppStore.getState().setLightingParams
        const setTemplate = useAppStore.getState().setTemplate
        const project = useProjectStore.getState().currentProject
        if (templateId === 'default' && project?.renderSettings) {
          setLightingParams({
            templateId: 'default',
            realisticMode: project.renderSettings.realisticMode ?? false,
            renderLite: project.renderSettings.renderLite ?? false
          })
        } else {
          setTemplate(templateId)
        }
      } else if (customEvent.detail?.action === 'setXrayColor') {
        useAppStore.getState().setLightingParams({ xrayColor: customEvent.detail.color })
      } else if (customEvent.detail?.action === 'isolateModel') {
        const host = (window as any).EKO_HOST_ENGINE
        const layer = customEvent.detail.layer || (customEvent.detail.keyword === 'all' ? 'all' : '')
        if (host?.isolateLayer && layer) host.isolateLayer(layer)
      } else if (customEvent.detail?.action === 'resolveAssets') {
        (window as any).EKO_HOST_ENGINE?.resolveAllAssetPositions?.()
      } else if (customEvent.detail?.action === 'flyToAsset') {
        (window as any).EKO_HOST_ENGINE?.flyToAsset?.(customEvent.detail.assetId)
      } else if (customEvent.detail?.action === 'highlightAsset') {
        (window as any).EKO_HOST_ENGINE?.highlightAsset?.(customEvent.detail.assetId)
      } else if (customEvent.detail?.action === 'clearHighlight') {
        (window as any).EKO_HOST_ENGINE?.clearHighlight?.()
      } else if (customEvent.detail?.action === 'finSignOut') {
        // Dashboard already asked the backend to drop the FIN session. Clear the
        // studio panel too, so it shows the connect form. logout() is safe to repeat.
        void useFinStore.getState().logout()
      }
    }
    window.addEventListener('dashboard-event', handler)

    fetch('templates/index.html?v=' + Date.now())
      .then(res => res.text())
      .then(html => {
        if (!signal.mounted || !containerRef.current) return
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')

        Array.from(doc.querySelectorAll('style, link[rel="stylesheet"]')).forEach(el => {
          if (el.tagName === 'STYLE') {
            let cssText = el.innerHTML
            cssText = cssText.replace(/body\s*\{/g, '.dashboard-native-container {')
            const style = document.createElement('style')
            style.className = 'dt-dashboard-injected'
            style.innerHTML = cssText
            document.head.appendChild(style)
          } else {
            const link = el.cloneNode() as HTMLLinkElement
            link.className = 'dt-dashboard-injected'
            try {
              const url = new URL(link.href, window.location.href)
              url.searchParams.set('v', Date.now().toString())
              link.href = url.toString()
            } catch { /* keep the original href */ }
            document.head.appendChild(link)
          }
        })

        const tempDiv = document.createElement('div')
        tempDiv.innerHTML = doc.body.innerHTML
        Array.from(tempDiv.querySelectorAll('script')).forEach(s => s.remove())
        containerRef.current.innerHTML = tempDiv.innerHTML
        ;(window as any).DASHBOARD_ROOT = containerRef.current
        ;(window as any).DASHBOARD_OVERLAY = true

        const apiSettings: ProjectApiSettings = currentProject?.apiSettings || {}
        // Strings go through JSON.stringify: a quote in a project setting must not end the literal
        const configScript = `
          window.INJECTED_PROJECT_CONFIG = {
            initialTemplate: ${JSON.stringify(currentProject?.renderSettings?.templateId || 'default')},
            initialXrayColor: ${JSON.stringify(currentProject?.renderSettings?.xrayColor || 'blue')},
            fin: {
              baseUrl: ${JSON.stringify(apiSettings.finBaseUrl || 'https://localhost')},
              project: ${JSON.stringify(apiSettings.finProjectName || '')},
              interval: ${apiSettings.finInterval || 5000},
              directMode: ${apiSettings.finDirectMode || false},
              realtimeMs: ${apiSettings.finRealtimeMs || 30000},
              livePoints: ${pointsWithBoards(apiSettings).live ? JSON.stringify(pointsWithBoards(apiSettings).live) : 'undefined'},
              endpoints: ${pointsWithBoards(apiSettings).history ? JSON.stringify(pointsWithBoards(apiSettings).history) : 'undefined'},
              workorderExpr: ${JSON.stringify(apiSettings.finWorkorderExpr || '')},
              meterProfile: ${apiSettings.finMeterProfile ? JSON.stringify(apiSettings.finMeterProfile) : 'undefined'},
              meterNames: ${JSON.stringify(meterEquipNames(apiSettings))},
              severityBands: ${apiSettings.finSeverityBands ? JSON.stringify(apiSettings.finSeverityBands) : 'undefined'},
              equipmentClasses: ${apiSettings.finEquipmentClasses ? JSON.stringify(apiSettings.finEquipmentClasses) : 'undefined'},
              realtimeEndpoints: ${apiSettings.finRealtimeEndpoints ? JSON.stringify(apiSettings.finRealtimeEndpoints) : 'undefined'},
              documents: ${Array.isArray(apiSettings.finDocuments) ? JSON.stringify(apiSettings.finDocuments) : 'undefined'}
            }
          };
        `
        try { window.eval(configScript) } catch (err) { console.error(err) }
        // The project open now: its id (answers stamped for another project are dropped), site and basis
        if (currentProject && (window as any).INJECTED_PROJECT_CONFIG) {
          Object.assign((window as any).INJECTED_PROJECT_CONFIG, dashboardProjectInfo(currentProject))
        }
        // The backend serves this project before the dashboard's first poll is trusted
        void useFinStore.getState().syncProjectSettings()

        // A script marked data-sample-data belongs to one sample data set. The medical set also
        // loads for the extended module set, so ESG and Security & life safety can show their mocks.
        const injected = (window as any).INJECTED_PROJECT_CONFIG || {}
        const sampleData = injected.sampleData || null
        const medicalMocks = sampleData === 'medical' || injected.modules === 'extended'
        const scripts = Array.from(doc.querySelectorAll('script')).filter(s => !s.dataset.sampleData || s.dataset.sampleData === sampleData || (s.dataset.sampleData === 'medical' && medicalMocks))
        return loadScripts(scripts, signal)
      })

    return () => {
      signal.mounted = false
      window.removeEventListener('dashboard-event', handler)
      try {
        document.querySelector('.dashboard-native-container')?.removeAttribute('data-wall')
        document.querySelectorAll('.wmodelhit').forEach((el) => el.remove())
        document.body.classList.remove('wall-orbiting')
        ;(window as any).EKO_HOST_ENGINE?.bindWallOrbit?.()
      } catch { /* restore canvas orbit */ }
      // The selection dies with the dashboard: don't leave its equipment coloured
      try { (window as any).EKO_HOST_ENGINE?.clearSpaceHeat?.() } catch {}
      try { (window as any).EKO_HOST_ENGINE?.clearHighlight?.() } catch {}
      try { (window as any).DashboardOverlayTeardown?.() } catch {}
      try { (window as any).DashboardData?.stop?.() } catch {}
      document.querySelectorAll('.dt-dashboard-injected').forEach(el => el.remove())
      if (containerRef.current) containerRef.current.innerHTML = ''
      delete (window as any).INJECTED_PROJECT_CONFIG
    }
  }, [visible, currentProject?.projectId])

  /* Saving settings must not rebuild the dashboard. A rebuild left the ceiling
     cut on and the model disappeared. The open dashboard reads this live. */
  useEffect(() => {
    if (!visible || !currentProject) return
    const injected = (window as any).INJECTED_PROJECT_CONFIG
    if (!injected) return
    Object.assign(injected, dashboardProjectInfo(currentProject))
    const fin = injected.fin
    const s = currentProject.apiSettings
    if (fin && s) {
      fin.baseUrl = s.finBaseUrl || fin.baseUrl
      fin.project = s.finProjectName || ''
      fin.interval = s.finInterval || fin.interval
      fin.directMode = s.finDirectMode || false
      const polled = pointsWithBoards(s)
      if (polled.live) fin.livePoints = polled.live
      if (polled.history) fin.endpoints = polled.history
      fin.documents = Array.isArray(s.finDocuments) ? s.finDocuments : null
      fin.meterNames = meterEquipNames(s)
    }
    try { (window as any).EKO_HEAT?.relink?.() } catch { /* the next data tick rebuilds the zones */ }
    try { (window as any).EKO?.set?.({}) } catch { /* the dashboard redraws on its next refresh */ }
    const prev = savedSettings.current
    const next = currentProject.apiSettings
    savedSettings.current = next
    const page = (window as any).EKO?.state?.pageId
    /* Save Settings while Overview is open must not keep the heatmap camera. */
    if (prev !== undefined && prev !== next && page && page !== 'heatmap') {
      try { (window as any).EKO?.releaseHeatView?.() } catch { /* the home camera is applied on the next open */ }
    }
  }, [visible, currentProject, currentProject?.apiSettings])

  if (!visible) return null

  return (
    <div className="dashboard-overlay-container">
      {/* under the dashboard's own panels, over the canvas; never takes a pointer */}
      <div ref={labelHostRef} className="eko-hvac-labels" aria-hidden="true" />
      <div
        ref={containerRef}
        className="dashboard-native-container"
        data-theme="dark"
        data-nav="full"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
      {/* renders into its own host, which the dashboard moves into its summary panel while the Tree tool is on */}
      {engineRef && <DashboardModelTree engineRef={engineRef} engineReady={engineReady} />}
    </div>
  )
}