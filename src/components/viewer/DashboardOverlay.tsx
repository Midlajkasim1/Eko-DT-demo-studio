import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import * as OBC from '@thatopen/components'
import { useProjectStore } from '@/store/useProjectStore'
import { useAppStore } from '@/store/useAppStore'
import { useModelStore } from '@/store/useModelStore'
import { foldName, indexLinks, isGuid } from '@/lib/assetLinks'
import type { AssetLink } from '@/types'
import { resetCameraToHome } from '@/lib/cameraUtils'
import { frameSphereInView } from '@/lib/viewFraming'
import { createMiniMap } from '@/lib/miniMap'
import { disciplineOf, layersFor, layerShows } from '@/lib/modelDiscipline'
import { measureTool } from '@/lib/measureTool'
import { sliceTool, unwatchClipping, watchClipping } from '@/lib/sliceTool'
import { createFcuSchematic } from '@/lib/fcuSchematic'
import { createAhuSchematic } from '@/lib/ahuSchematic'
import { createFahuSchematic } from '@/lib/fahuSchematic'
import { createMauSchematic } from '@/lib/mauSchematic'
import { createEcoSchematic } from '@/lib/ecoSchematic'
import { createHvacLabels } from '@/lib/hvacLabels'
import type { HvacSchematic } from '@/lib/hvacGeometry'
import { useFinStore } from '@/store/useFinStore'
import type { ProjectApiSettings } from '@/types'
import { dashboardProjectInfo } from '@/lib/finSettings'

import type { FragmentsEngine } from '@/lib/fragmentsEngine'

interface DashboardOverlayProps {
  visible: boolean
  engineRef?: React.MutableRefObject<FragmentsEngine | null>
  /** Flips true once the fragments engine exists. A ref write does not re-render. */
  engineReady?: boolean
}

/* Equipment type (from the project's asset links) -> the internals drawn inside its casing on selection */
const SCHEMATICS: Record<string, (localBox: THREE.Box3, modelMatrix: THREE.Matrix4, casing?: THREE.Object3D) => HvacSchematic | null> = {
  FCU:  createFcuSchematic,
  AHU:  createAhuSchematic,
  MAHU: createMauSchematic,
  ECO:  createEcoSchematic,
  FAHU: createFahuSchematic,
}

/* Types whose internals are driven by live FIN points (fan, coil, damper, filter, UV state).
   A point FIN does not send shows the no-data grey, never a guessed off/clean.
   AHU stays at its default look: its reader still treats a missing point as off/clean. */
const LIVE_SCHEMATICS = new Set(['MAHU', 'ECO', 'FCU', 'FAHU'])

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

    const normAssetId = (id: string) => (id.startsWith('ast-') ? id.substring(4) : id)
    const fold = foldName
    // Read from the open project on use, so links saved in Asset Links apply without a reload
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

    /* Asset id (with or without the ast- prefix) -> IFC GUID, or null.
       The project's asset link wins over whatever id the live feed carries. */
    const bimIdFor = (assetId?: string | null): string | null => {
      if (!assetId) return null
      const norm = normAssetId(assetId)
      const mapped = linkFor(assetId)?.guid
      if (mapped) return mapped
      const assets: any[] = (window as any).EKO?.data?.assets || []
      const asset = assets.find(a => a.id === assetId || normAssetId(a.id || '') === norm)
      return isGuid(asset?.bimId) ? asset.bimId : null
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
    let active: (Internals & { schematic: HvacSchematic; bimId: string; last: number; synced: number }) | null = null
    /* The asset whose internals to draw: the asked one if its type has a
       schematic, else any linked asset on the same element that has one. */
    const internalsFor = (asked: string, bimId: string): Internals | null => {
      const rec = linkFor(asked)
      if (rec && SCHEMATICS[rec.type]) return { assetId: normAssetId(asked), type: rec.type }
      const hit = links().list.find(m => m.guid === bimId && SCHEMATICS[m.type])
      return hit ? { assetId: hit.equip, type: hit.type } : null
    }
    const pointsFor = (assetId: string, bimId: string) => {
      const want = fold(assetId)
      const lists: any[] = []
      // The dashboard's data layer re-reads equipment every 30 s; the FIN store only once after sign-in, so it is the fallback
      const dash = (window as any).DashboardData?.equipment
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
      const c = tone === 'alarm' ? ALARM : tone === 'amber' ? AMBER : HEALTHY
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
      const hasHeat = heatRoots.size > 0 || alarmGlow.size > 0
      if ((!ghost || !ghost.group.visible) && !hasHeat) return
      // The selected equipment's internals, while its highlight is on screen
      const shown = ghost && ghost.group.visible ? active : null
      if (shown) {
        const now = performance.now()
        const dt = Math.min(0.05, (now - shown.last) / 1000)
        shown.last = now
        shown.schematic.tick(dt)
        if (LIVE_SCHEMATICS.has(shown.type) && now - shown.synced > 400) {
          shown.synced = now
          labels.setReading(shown.schematic.apply(pointsFor(shown.assetId, shown.bimId)))
        }
      }
      const renderer = engine.world?.renderer?.three
      const camera = engine.world?.camera?.three
      if (!renderer || !camera) return
      if (shown) {
        if (LIVE_SCHEMATICS.has(shown.type) && labelsOn()) labels.update(camera, renderer.domElement.getBoundingClientRect())
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
      const seeThrough: THREE.Object3D[] = []
      if (ghost?.group) seeThrough.push(ghost.group)
      alarmGlow.forEach(rec => seeThrough.push(rec.group))
      const heatDrawn = heatGroups.some(g => g.visible)
      const ghostDrawn = seeThrough.some(g => g.visible)
      try {
        if (heatDrawn && engine.world?.scene?.three) {
          const scene = engine.world.scene.three
          const hidden: THREE.Object3D[] = []
          const prevOverride = scene.overrideMaterial
          const prevBackground = scene.background
          const savedSee = seeThrough.map(g => g.visible)
          seeThrough.forEach(g => { g.visible = false })
          try {
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
              if (!solid) {
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
    const syncGhost = () => {
      if (archFadeOn) fadeArch(true)
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
      // The selected equipment already has its own highlight
      alarmGlow.forEach((rec, bimId) => {
        rec.group.matrix.copy(rec.model.object.matrixWorld)
        rec.group.matrixWorldNeedsUpdate = true
        rec.group.visible = rec.model.object.visible !== false && colored?.bimId !== bimId
          && !levelHidden.get(rec.model)?.has(rec.localId)
      })
    }
    const mountInternals = (group: THREE.Group, entry: Located, internals: Internals, bimId: string) => {
      const schematic = SCHEMATICS[internals.type](entry.localBox, entry.model.object.matrixWorld, group)
      if (!schematic) return
      group.add(schematic.group)
      group.traverse((o) => {
        if (o.userData?.ekoGhostDepth) o.visible = false
      })
      ghostFill.uniforms.uOpacity.value = 0.22
      active = { ...internals, schematic, bimId, last: performance.now(), synced: 0 }
      if (LIVE_SCHEMATICS.has(internals.type)) labels.show(schematic, schematic.apply(pointsFor(internals.assetId, bimId)))
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
        if (active && internals && LIVE_SCHEMATICS.has(internals.type)) labels.setReading(active.schematic.apply(pointsFor(internals.assetId, bimId)))
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
    const floorJobs = new WeakMap<object, Promise<{ geom: number[]; byFloor: Map<string, number[]> }>>()
    const floorCatalog = new Map<string, Floor>()
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
      if (!name || /delete/i.test(name)) return null
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
    const readStoreys = async (model: any) => {
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
    const assignByHeight = (geom: number[], boxes: THREE.Box3[], storeys: { floor: Floor; elevation: number }[]) => {
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
      for (const b of boxes) if (b && !b.isEmpty() && Number.isFinite(b.min.y)) ys.push(b.min.y)
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
        return { geom, byFloor }
      })().catch((err) => { floorJobs.delete(model); throw err })
      floorJobs.set(model, job)
      return job
    }
    const refreshLevels = async () => {
      const byId = new Map<string, Floor>()
      for (const model of engine.fragments?.models?.list?.values() ?? []) {
        let entry: { geom: number[]; byFloor: Map<string, number[]> } = { geom: [], byFloor: new Map() }
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
    const isolateLevel = async (levelId: string, force?: boolean) => {
      if (levelId === 'Ground floor' && !floorCatalog.get(levelId)) {
        const gf = [...floorCatalog.values()].find(f => /ground/i.test(f.name) || f.rank === 0)
        if (gf) levelId = gf.id
      }
      if (!force && levelId === lastLevelId) return
      lastLevelId = levelId
      const seq = ++levelSeq
      for (const model of engine.fragments?.models?.list?.values() ?? []) {
        const m = model as any
        if (typeof m.resetVisible !== 'function') continue
        if (seq !== levelSeq) return
        const entry = await indexModel(m)
        if (seq !== levelSeq) return
        await m.resetVisible()
        levelHidden.delete(m)
        if (!levelId || levelId === 'ALL' || !entry.byFloor.size) continue
        /* Basement is only itself. Each floor above also keeps everything below it. */
        const picked = floorCatalog.get(levelId)
        if (!picked) {
          levelHidden.set(m, new Set(entry.geom))
          if (entry.geom.length) await m.setVisible(entry.geom, false)
          continue
        }
        const show = new Set<number>()
        let covered = false
        for (const [id, ids] of entry.byFloor) {
          const floor = floorCatalog.get(id)
          if (!floor || floor.rank > picked.rank) continue
          covered = true
          for (const n of ids) show.add(n)
        }
        if (!covered) {
          levelHidden.set(m, new Set(entry.geom))
          if (entry.geom.length) await m.setVisible(entry.geom, false)
          continue
        }
        if (!show.size) continue
        const hide = entry.geom.filter(id => !show.has(id))
        levelHidden.set(m, new Set(hide))
        if (hide.length) await m.setVisible(hide, false)
      }
      if (seq === levelSeq) repositionMarkers()
    }

    const heatGeoms = new Map<string, THREE.BufferGeometry[]>()
    const heatByBim = new Map<string, { mat: THREE.MeshBasicMaterial; model: any; localId: number }>()
    let heatSheets: THREE.Mesh[] = []
    let heatSig = ''
    /* Two colours per category so the low end and the high end stay distinct.
       The same pairs are in analytics.js heatStops. */
    const HEAT_STOPS: Record<string, [number, number]> = {
      temp: [0x5B8DEF, 0xD61F1F],
      hum: [0xE6C35C, 0x0E7C74],
      comfort: [0x6BCB77, 0xC45C26],
    }
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
          const t = g.transform instanceof THREE.Matrix4 ? g.transform
            : new THREE.Matrix4().fromArray(g.transform?.elements ?? g.transform ?? new THREE.Matrix4().elements)
          geom.applyMatrix4(t)
          geoms.push(geom)
        }
      }
      if (!geoms.length && entry.localBox && !entry.localBox.isEmpty()) {
        const size = entry.localBox.getSize(new THREE.Vector3())
        const center = entry.localBox.getCenter(new THREE.Vector3())
        const box = new THREE.BoxGeometry(Math.max(size.x, 0.2), Math.max(size.y, 0.2), Math.max(size.z, 0.2))
        box.translate(center.x, center.y, center.z)
        geoms.push(box)
      }
      heatGeoms.set(bimId, geoms)
      return geoms
    }
    const dropHeatSheets = () => {
      heatSheets.forEach(mesh => {
        mesh.removeFromParent()
        mesh.geometry.dispose()
        const mat = mesh.material as THREE.Material
        unwatchClipping(mat)
        mat.dispose()
      })
      heatSheets = []
    }
    const clearSpaceHeat = async () => {
      heatSig = ''
      dropHeatSheets()
      heatByBim.forEach(rec => {
        unwatchClipping(rec.mat)
        rec.mat.dispose()
        try {
          if (typeof rec.model.resetColor === 'function') void rec.model.resetColor([rec.localId])
          if (typeof rec.model.setOpacity === 'function') void rec.model.setOpacity([rec.localId], 0.01)
        } catch { /* */ }
      })
      heatByBim.clear()
      heatRoots.forEach(root => {
        root.removeFromParent()
        root.clear()
      })
      heatRoots.clear()
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
    const heatPlateMat = () => {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
        toneMapped: false,
        clipping: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
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
    const paintRoomPlate = (
      geom: THREE.BufferGeometry,
      own: { x: number; y: number; z: number; t: number; hx: number; hz: number },
      samples: { x: number; z: number; t: number }[],
      sigma: number,
      low: THREE.Color,
      high: THREE.Color,
    ) => {
      const g = subdivideHeat(geom, Math.max(sigma * 0.45, 0.4))
      const pos = g.getAttribute('position') as THREE.BufferAttribute
      const sx = own.hx > 0.08 ? Math.max((own.hx - 0.05) / own.hx, 0.85) : 1
      const sz = own.hz > 0.08 ? Math.max((own.hz - 0.05) / own.hz, 0.85) : 1
      for (let i = 0; i < pos.count; i++) {
        pos.setX(i, own.x + (pos.getX(i) - own.x) * sx)
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
        tmp.copy(low).lerp(high, t)
        const o = i * 4
        colors[o] = tmp.r
        colors[o + 1] = tmp.g
        colors[o + 2] = tmp.b
        colors[o + 3] = 0.55
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 4))
      g.computeBoundingSphere()
      const mesh = new THREE.Mesh(g, heatPlateMat())
      mesh.frustumCulled = false
      mesh.renderOrder = 2
      return mesh
    }
    const applySpaceHeat = async (zones: { bimId?: string; bimIds?: string[]; tempC?: number | null; rh?: number | null; co2?: number | null }[], mode?: string) => {
      const md = mode === 'comfort' || mode === 'hum' ? mode : 'temp'
      const idsOf = (z: { bimId?: string; bimIds?: string[] }) =>
        (z.bimIds && z.bimIds.length ? z.bimIds : (z.bimId ? [z.bimId] : [])).filter(id => isGuid(id))
      const sig = md + '|' + (zones || []).map(z => `${idsOf(z).join(',')}:${round1(z.tempC)}:${round1(z.rh)}:${round1(z.co2)}`).join(';')
      if (sig === heatSig) return
      heatSig = sig
      dropHeatSheets()
      type Room = { model: any; geoms: THREE.BufferGeometry[]; x: number; y: number; z: number; hx: number; hz: number; t: number }
      const rooms: Room[] = []
      for (const z of zones || []) {
        const raw = md === 'comfort' ? z.co2 : md === 'hum' ? z.rh : z.tempC
        const t = heatT(md, raw == null ? null : Number(raw))
        if (t == null) continue
        for (const bimId of idsOf(z)) {
          const entry = await locate(bimId)
          if (!entry?.localBox || entry.localBox.isEmpty()) continue
          const geoms = await geomsFor(bimId, entry)
          if (!geoms.length) continue
          const c = entry.localBox.getCenter(new THREE.Vector3())
          const size = entry.localBox.getSize(new THREE.Vector3())
          rooms.push({ model: entry.model, geoms, x: c.x, y: c.y, z: c.z, hx: size.x / 2, hz: size.z / 2, t })
        }
      }
      const stops = HEAT_STOPS[md] || HEAT_STOPS.temp
      const low = new THREE.Color(stops[0])
      const high = new THREE.Color(stops[1])
      const byModel = new Map<any, Room[]>()
      for (const room of rooms) {
        const list = byModel.get(room.model) || []
        list.push(room)
        byModel.set(room.model, list)
      }
      byModel.forEach((samples, model) => {
        let near = 0, nearN = 0
        for (let i = 0; i < samples.length; i++) {
          let best = Infinity
          for (let j = 0; j < samples.length; j++) {
            if (i === j) continue
            best = Math.min(best, Math.hypot(samples[i].x - samples[j].x, samples[i].z - samples[j].z))
          }
          if (isFinite(best) && best > 0) { near += best; nearN++ }
        }
        const sigma = Math.max(nearN ? (near / nearN) * 0.85 : 1, 0.5)
        const root = heatRootOf(model)
        for (const room of samples) {
          for (const geom of room.geoms) {
            const mesh = paintRoomPlate(geom, room, samples, sigma, low, high)
            root.add(mesh)
            heatSheets.push(mesh)
          }
        }
      })
      syncGhost()
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
      if (s.currentProject?.assetLinks === prev.currentProject?.assetLinks) return
      void resolveAllAssetPositions()
      try { (window as { EKO?: { set?: (patch: object) => void } }).EKO?.set?.({}) } catch { /* the dashboard redraws on its next refresh */ }
    })

    /* While the heatmap is up, the architecture model stays present but light,
       so the room colour reads through the walls. Glass that is already fainter
       is left as it is. Other disciplines stay solid. */
    const ARCH_FADE = 0.35
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
    const fadeArch = (on: boolean) => {
      archFadeOn = on
      for (const rec of useModelStore.getState().models) {
        if (disciplineOf(rec.originalFileName || '') !== 'arch') continue
        const root = modelObject(rec)
        if (!root) continue
        root.traverse((obj: any) => {
          const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : []
          for (const mat of mats) {
            if (!mat) continue
            if (on) {
              if (mat.userData?.ekoArchFade === ARCH_FADE && mat.opacity === ARCH_FADE && mat.depthWrite === false) continue
              if (!mat.userData?.ekoArchSaved && mat.transparent && typeof mat.opacity === 'number' && mat.opacity < ARCH_FADE) continue
              if (!mat.userData.ekoArchSaved) {
                mat.userData.ekoArchSaved = { opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite }
              }
              mat.userData.ekoArchFade = ARCH_FADE
              mat.opacity = ARCH_FADE
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
          if (on) {
            if (obj.userData.ekoArchCast == null) obj.userData.ekoArchCast = !!obj.castShadow
            obj.castShadow = false
          } else if (obj.userData.ekoArchCast != null) {
            obj.castShadow = obj.userData.ekoArchCast
            delete obj.userData.ekoArchCast
          }
        })
      }
    }

    /* Whole models, by the discipline in the file name. Item visibility
       (the floor filter) is left as it is. */
    let lastLayerKey = ''
    const isolateLayer = (layerId: string | string[], force?: boolean) => {
      const key = Array.isArray(layerId) ? layerId.slice().sort().join('|') : String(layerId || '')
      if (!force && key === lastLayerKey) return
      lastLayerKey = key
      const models = useModelStore.getState().models
      const present = new Set(
        models.map(m => disciplineOf(m.originalFileName || '')).filter((d): d is NonNullable<typeof d> => !!d)
      )
      const hideStr = Array.isArray(layerId) && !layerId.includes('str')
      const fragList = engine.fragments?.models?.list
      for (const m of models) {
        const name = m.originalFileName || ''
        const disc = disciplineOf(name)
        let visible = layerShows(disc, layerId, present)
        if (hideStr && (disc === 'str' || /struct|(?:^|[^A-Z0-9])ST(?:[^A-Z0-9]|$)/i.test(name.toUpperCase()))) visible = false
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
    }

    const miniMap = createMiniMap(engine)
    const afterFrame = () => {
      drawGhost()
      miniMap.capture()
    }

    ;(window as any).EKO_HOST_ENGINE = {
      projectPoint,
      resolveAllAssetPositions,
      // data-map.js calls this on refresh: keep the selected equipment's colour current
      applyStatusColors: () => { syncColour(); void syncAlarmGlow() },
      flyToAsset,
      highlightAsset,
      clearHighlight,
      resetView: () => resetCameraToHome(engine),
      bimIdFor,
      isAlarmed,
      listMapped: () => links().list.map(m => ({ id: m.equip, bimId: m.guid })),
      listLevels: () => levels.map(l => ({ id: l.id, name: l.name })),
      isolateLevel,
      listLayers: () => layersFor(
        useModelStore.getState().models.map(m => disciplineOf(m.originalFileName || ''))
      ).map(id => ({ id, name: id })),
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
    }
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
    const controls = engine.world?.camera?.controls
    controls?.addEventListener('update', onCameraUpdate)
    engine.world?.renderer?.onBeforeUpdate?.add(syncGhost)
    engine.world?.renderer?.onAfterUpdate?.add(afterFrame)

    // Models can finish loading well after the dashboard: retry until located.
    // Any change to the loaded models forgets the "not found" answers and
    // drops entries that point at a model which is gone.
    const modelKeys = new WeakMap<object, number>()
    let nextKey = 0
    const keyOf = (m: object) => modelKeys.get(m) ?? (modelKeys.set(m, ++nextKey), nextKey)
    let modelsSig = ''
    const resolveTimer = setInterval(() => {
      const live = [...(engine.fragments?.models?.list?.values() ?? [])]
      const sig = live.map(keyOf).join('|')   // object identity: a reload of the same file counts as a change
      let modelsChanged = false
      if (sig !== modelsSig) {
        modelsChanged = true
        modelsSig = sig
        missing.clear()
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
      // A control room opened from its own URL goes home once its models load
      if (modelsChanged && live.length && document.querySelector('.dashboard-native-container[data-wall="1"]')) resetCameraToHome(engine)
    }, 3000)
    void resolveAllAssetPositions()
    void refreshLevels()

    return () => {
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
      engine.world?.renderer?.onBeforeUpdate?.remove(syncGhost)
      engine.world?.renderer?.onAfterUpdate?.remove(afterFrame)
      miniMap.dispose()
      clearInterval(resolveTimer)
      fadeArch(false)
      void clearHighlight()
      void clearSpaceHeat()
      removeGhost()
      unsubTemplate()
      unsubLinks()
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
    }
  }, [engineReady])

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
              livePoints: ${apiSettings.finLivePoints ? JSON.stringify(apiSettings.finLivePoints) : 'undefined'},
              endpoints: ${apiSettings.finEndpoints ? JSON.stringify(apiSettings.finEndpoints) : 'undefined'},
              workorderExpr: ${JSON.stringify(apiSettings.finWorkorderExpr || '')},
              meterProfile: ${apiSettings.finMeterProfile ? JSON.stringify(apiSettings.finMeterProfile) : 'undefined'},
              severityBands: ${apiSettings.finSeverityBands ? JSON.stringify(apiSettings.finSeverityBands) : 'undefined'},
              equipmentClasses: ${apiSettings.finEquipmentClasses ? JSON.stringify(apiSettings.finEquipmentClasses) : 'undefined'},
              realtimeEndpoints: ${apiSettings.finRealtimeEndpoints ? JSON.stringify(apiSettings.finRealtimeEndpoints) : 'undefined'}
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

        return loadScripts(Array.from(doc.querySelectorAll('script')), signal)
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
      try { (window as any).EKO_HOST_ENGINE?.clearHighlight?.() } catch {}
      try { (window as any).DashboardOverlayTeardown?.() } catch {}
      try { (window as any).DashboardData?.stop?.() } catch {}
      document.querySelectorAll('.dt-dashboard-injected').forEach(el => el.remove())
      if (containerRef.current) containerRef.current.innerHTML = ''
      delete (window as any).INJECTED_PROJECT_CONFIG
    }
  }, [visible, currentProject?.projectId, currentProject?.apiSettings])

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
    </div>
  )
}