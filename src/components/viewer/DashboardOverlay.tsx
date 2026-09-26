import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import * as OBC from '@thatopen/components'
import { useProjectStore } from '@/store/useProjectStore'
import { useAppStore } from '@/store/useAppStore'
import { useModelStore } from '@/store/useModelStore'
import { ASSET_BIM_MAPPING } from '@/constants/assetBimMapping'
import { resetCameraToHome } from '@/lib/cameraUtils'
import type { ProjectApiSettings } from '@/types'

import type { FragmentsEngine } from '@/lib/fragmentsEngine'

interface DashboardOverlayProps {
  visible: boolean
  engineRef?: React.MutableRefObject<FragmentsEngine | null>
  /** Flips true once the fragments engine exists. A ref write does not re-render. */
  engineReady?: boolean
}

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
    let colored: { bimId: string; alarm: boolean } | null = null
    let highlightSeq = 0

    /* IFC GlobalIds are 22 chars of [0-9A-Za-z_$]. FIN hands out point refs
       ("@p:site:r:…") in the same bimId field; those are not in the model. */
    const isGuid = (id: unknown): id is string => typeof id === 'string' && /^[0-9A-Za-z_$]{22}$/.test(id)
    const normAssetId = (id: string) => (id.startsWith('ast-') ? id.substring(4) : id)
    /* FIN names differ from the mapping keys by spaces and dashes ("FCU ANC09 GF 02"). */
    const fold = (id: string) => normAssetId(id).toUpperCase().replace(/[^A-Z0-9]/g, '')
    const mappedByFold = new Map<string, string>()
    const mappedList: { id: string; bimId: string }[] = []
    for (const [id, rec] of Object.entries(ASSET_BIM_MAPPING)) {
      if (!rec.bimId || !isGuid(rec.bimId)) continue
      mappedByFold.set(fold(id), rec.bimId)
      mappedList.push({ id, bimId: rec.bimId })
    }

    /* Asset id (with or without the ast- prefix) -> IFC GUID, or null.
       The curated mapping wins over whatever id the live feed carries. */
    const bimIdFor = (assetId?: string | null): string | null => {
      if (!assetId) return null
      const norm = normAssetId(assetId)
      const mapped = ASSET_BIM_MAPPING[norm]?.bimId || ASSET_BIM_MAPPING[assetId]?.bimId || mappedByFold.get(fold(assetId))
      if (mapped && isGuid(mapped)) return mapped
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
       The model's own materials are left alone. */
    const overlay = new THREE.Scene()
    // The nearest surface only: a depth-only pass, then the fill and edges on it
    const ghostDepth = new THREE.MeshBasicMaterial({
      colorWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    })
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
    let ghost: { group: THREE.Group; model: any } | null = null
    const tintGhost = (alarm: boolean) => {
      const c = alarm ? ALARM : HEALTHY
      ghostFill.uniforms.uColor.value.copy(c)
      ghostEdge.color.copy(c).multiplyScalar(0.45)   // a darker line of the same hue reads on light and dark styles
    }
    const removeGhost = () => {
      if (!ghost) return
      ghost.group.removeFromParent()
      ghost.group.traverse((o: any) => o.geometry?.dispose())
      ghost = null
    }
    // Runs after every frame the viewer draws, whichever style drew it
    const drawGhost = () => {
      if (!ghost || !ghost.group.visible) return
      const renderer = engine.world?.renderer?.three
      const camera = engine.world?.camera?.three
      if (!renderer || !camera) return
      const autoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.setRenderTarget(null)
      renderer.clearDepth()
      renderer.render(overlay, camera)
      renderer.autoClear = autoClear
    }
    // Follows the model's live transform and its visibility (model isolation)
    const syncGhost = () => {
      if (!ghost) return
      ghost.group.matrix.copy(ghost.model.object.matrixWorld)
      ghost.group.matrixWorldNeedsUpdate = true
      ghost.group.visible = ghost.model.object.visible !== false
    }
    const buildGhost = async (entry: Located, bimId: string, seq: number) => {
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
          depth.renderOrder = 0
          fill.renderOrder = 1
          edges.renderOrder = 2
          for (const o of [depth, fill, edges]) o.applyMatrix4(t)
          group.add(depth, fill, edges)
        }
      }
      if (!group.children.length) return
      removeGhost()
      ghost = { group, model: entry.model }
      syncGhost()
      overlay.add(group)
    }

    /* Keeps the highlight in step with live alarm state (green <-> red) */
    const syncColour = () => {
      const c = colored
      if (!c) return
      const alarm = isAlarmed(c.bimId)
      if (alarm === c.alarm) return
      c.alarm = alarm
      tintGhost(alarm)
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

    /* Highlights ONE piece of equipment (the selected one): red if it has an
       active alarm, green if healthy. Rapid clicks: only the latest one wins. */
    const highlightAsset = async (assetIdOrBimId: string) => {
      const seq = ++highlightSeq
      const bimId = toBimId(assetIdOrBimId)
      if (colored && colored.bimId === bimId && ghost) { syncColour(); return true }
      colored = null
      removeGhost()
      const entry = bimId ? await locate(bimId) : null
      if (seq !== highlightSeq || !bimId || !entry) return false
      const alarm = isAlarmed(bimId)
      colored = { bimId, alarm }
      tintGhost(alarm)
      await buildGhost(entry, bimId, seq)
      return seq === highlightSeq && !!ghost
    }

    /* Moves the camera only; colouring follows the dashboard's selection. */
    const flyToAsset = async (assetIdOrBimId: string) => {
      const controls = engine?.world?.camera?.controls
      const bimId = toBimId(assetIdOrBimId)
      const entry = bimId ? await locate(bimId) : null
      if (!controls || !entry) return false
      await controls.fitToBox(worldBoxOf(entry), true)
      return true
    }

    ;(window as any).EKO_HOST_ENGINE = {
      projectPoint,
      resolveAllAssetPositions,
      // data-map.js calls this on refresh: keep the selected equipment's colour current
      applyStatusColors: () => { syncColour() },
      flyToAsset,
      highlightAsset,
      clearHighlight,
      resetView: () => resetCameraToHome(engine),
      bimIdFor,
      isAlarmed,
      listMapped: () => mappedList.map(m => ({ id: m.id, bimId: m.bimId })),
    }
    // The dashboard may have rendered before the bridge existed: redraw so the
    // equipment markers (which need bimIdFor) appear.
    try { (window as any).EKO?.set?.({}) } catch {}

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
    engine.world?.renderer?.onAfterUpdate?.add(drawGhost)

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
      if (sig !== modelsSig) {
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
    }, 3000)
    void resolveAllAssetPositions()

    return () => {
      controls?.removeEventListener('update', onCameraUpdate)
      engine.world?.renderer?.onBeforeUpdate?.remove(syncGhost)
      engine.world?.renderer?.onAfterUpdate?.remove(drawGhost)
      clearInterval(resolveTimer)
      void clearHighlight()
      removeGhost()
      ghostDepth.dispose()
      ghostFill.dispose()
      ghostEdge.dispose()
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
        const { keyword } = customEvent.detail
        const models = useModelStore.getState().models
        const engine = engineRef?.current
        
        models.forEach(m => {
          // If keyword is 'all', show all. Otherwise, check if originalFileName contains the keyword.
          const isVisible = keyword === 'all' || m.originalFileName.toLowerCase().includes(keyword.toLowerCase())
          useModelStore.getState().setModelVisibility(m.modelId, isVisible)
          
          if (engine) {
            let object3D = null
            if (m.type === 'glb') {
              object3D = engine.world.scene.three.children.find((c: any) => c.userData?.modelId === m.modelId)
            } else {
              const fragModel = engine.fragments.models.list.get(m.modelId)
              object3D = fragModel?.object
            }
            if (object3D) {
              object3D.visible = isVisible
            }
          }
        })
      } else if (customEvent.detail?.action === 'resolveAssets') {
        (window as any).EKO_HOST_ENGINE?.resolveAllAssetPositions?.()
      } else if (customEvent.detail?.action === 'flyToAsset') {
        (window as any).EKO_HOST_ENGINE?.flyToAsset?.(customEvent.detail.assetId)
      } else if (customEvent.detail?.action === 'highlightAsset') {
        (window as any).EKO_HOST_ENGINE?.highlightAsset?.(customEvent.detail.assetId)
      } else if (customEvent.detail?.action === 'clearHighlight') {
        (window as any).EKO_HOST_ENGINE?.clearHighlight?.()
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

        const apiSettings: ProjectApiSettings = currentProject?.apiSettings || {}
        const configScript = `
          window.INJECTED_PROJECT_CONFIG = {
            initialTemplate: "${currentProject?.renderSettings?.templateId || 'default'}",
            initialXrayColor: "${currentProject?.renderSettings?.xrayColor || 'blue'}",
            fin: {
              baseUrl: "${apiSettings.finBaseUrl || 'https://localhost'}",
              project: "${apiSettings.finProjectName || ''}",
              interval: ${apiSettings.finInterval || 5000},
              directMode: ${apiSettings.finDirectMode || false},
              livePoints: ${apiSettings.finLivePoints ? JSON.stringify(apiSettings.finLivePoints) : 'undefined'},
              endpoints: ${apiSettings.finEndpoints ? JSON.stringify(apiSettings.finEndpoints) : 'undefined'}
            }
          };
        `
        try { window.eval(configScript) } catch (err) { console.error(err) }

        return loadScripts(Array.from(doc.querySelectorAll('script')), signal)
      })

    return () => {
      signal.mounted = false
      window.removeEventListener('dashboard-event', handler)
      // The selection dies with the dashboard: don't leave its equipment coloured
      try { (window as any).EKO_HOST_ENGINE?.clearHighlight?.() } catch {}
      try { (window as any).DashboardOverlayTeardown?.() } catch {}
      try { (window as any).DashboardData?.stop?.() } catch {}
      document.querySelectorAll('.dt-dashboard-injected').forEach(el => el.remove())
      if (containerRef.current) containerRef.current.innerHTML = ''
      delete (window as any).INJECTED_PROJECT_CONFIG
    }
  }, [visible, currentProject?.apiSettings])

  if (!visible) return null

  return (
    <div className="dashboard-overlay-container">
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