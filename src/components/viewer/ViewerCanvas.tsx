import { useRef, useEffect, useState, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import * as THREE from 'three'
import * as OBF from '@thatopen/components-front'
import { pickRenderSettings } from '@/constants/renderSettings'
import { useFragmentsEngine } from '@/hooks/useFragmentsEngine'
import { useModelLoader } from '@/hooks/useModelLoader'
import { useMaterialOverrides } from '@/hooks/useMaterialOverrides'
import { useModelStore } from '@/store/useModelStore'
import { useAppStore } from '@/store/useAppStore'
import { useProjectStore } from '@/store/useProjectStore'
import { ViewerToolbar } from './ViewerToolbar'
import { ModelPositionPanel } from '@/components/viewer/ModelPositionPanel'
import { RenderPanel } from '@/components/viewer/RenderPanel'
// import { TemplateBar } from '@/components/viewer/TemplatePicker'
import { DashboardOverlay } from '@/components/viewer/DashboardOverlay'
import { MaterialPanel } from '@/components/viewer/MaterialPanel'
import { FocusModeWidget } from '@/components/viewer/FocusModeWidget'
import { ModelLoadingProgress } from '@/components/viewer/ModelLoadingProgress'
import { OrientationCube } from '@/components/viewer/OrientationCube'
import { useLoadingProgressStore } from '@/store/useLoadingProgressStore'
import { unloadAllModels } from '@/lib/sceneTeardown'
import { attachDevBridge } from '@/lib/devBridge'
import { installStudioViewerApi } from '@/lib/studioViewerApi'
import { SnappingClass, type FragmentsModel, type RaycastResult } from '@thatopen/fragments'
import { chooseSnapPoint, createMeasure, measureTool, setMeasureTool, type SnapCandidate } from '@/lib/measureTool'
import { createSlice, hasCuts, pointKept, setSliceTool, sliceTool } from '@/lib/sliceTool'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'

// The fragments snap window is about 10px. A corner on that same surface, a
// little deeper than the face under the cursor, should still win.
const SNAP_PX = 14
const SNAP_DEPTH = 0.45
// Left-drag orbits and right-drag pans, and the browser still fires click on release.
const CAMERA_DRAG_PX = 6

function snapScreenPx(camera: THREE.Camera, point: THREE.Vector3, rect: DOMRect, mouse: THREE.Vector2) {
  const v = point.clone().project(camera)
  if (!Number.isFinite(v.x) || v.z < -1 || v.z > 1) return Infinity
  const sx = (v.x * 0.5 + 0.5) * rect.width + rect.left
  const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top
  return Math.hypot(sx - mouse.x, sy - mouse.y)
}

function snapKind(hit: RaycastResult): SnapCandidate['kind'] {
  if (hit.snappingClass === SnappingClass.LINE) return 'line'
  if (hit.snappingClass === SnappingClass.FACE) return 'face'
  return 'point'
}

async function snapMeasurePoint(engine: FragmentsEngine, canvas: HTMLCanvasElement, mouse: THREE.Vector2): Promise<THREE.Vector3 | null> {
  const camera = engine.world.camera.three
  const classes = [SnappingClass.POINT, SnappingClass.LINE, SnappingClass.FACE]
  const models = [...(engine.fragments?.models?.list?.values() ?? [])] as FragmentsModel[]
  const batches = await Promise.all(models.map(async (model) => {
    if (model.object && !model.object.visible) return [] as RaycastResult[]
    try {
      model.object?.updateMatrixWorld(true)
      const found = await model.raycastWithSnapping({ camera, dom: canvas, mouse, snappingClasses: classes })
      return found ?? []
    } catch {
      return [] as RaycastResult[]
    }
  }))
  const hits = batches.flat().filter(hit => hit?.point && pointKept(hit.point))
  const rect = canvas.getBoundingClientRect()
  return chooseSnapPoint(
    hits.map(hit => ({ point: hit.point, distance: hit.distance, kind: snapKind(hit) })),
    point => snapScreenPx(camera, point, rect, mouse),
    SNAP_PX,
    SNAP_DEPTH,
  )
}

function hoverHit(engine: FragmentsEngine, clientX: number, clientY: number, rect: DOMRect): THREE.Vector3 | null {
  const x = ((clientX - rect.left) / rect.width) * 2 - 1
  const y = -((clientY - rect.top) / rect.height) * 2 + 1
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(x, y), engine.world.camera.three)
  const roots: THREE.Object3D[] = []
  for (const model of engine.fragments?.models?.list?.values() ?? []) {
    const obj = (model as { object?: THREE.Object3D }).object
    if (obj && obj.visible) roots.push(obj)
  }
  engine.world.scene.three.children.forEach(child => {
    if (child.userData?.modelId && child.visible && !child.userData.ekoMeasure) roots.push(child)
  })
  const hit = raycaster.intersectObjects(roots, true).find(h =>
    !h.object.userData?.ekoMeasure && !h.object.userData?.ekoSlice && pointKept(h.point))
  return hit ? hit.point.clone() : null
}

async function keptModelHits(
  model: FragmentsModel,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  mouse: THREE.Vector2,
): Promise<RaycastResult[]> {
  if (model.object && !model.object.visible) return []
  try {
    model.object?.updateMatrixWorld(true)
    const data = { camera: camera as THREE.PerspectiveCamera | THREE.OrthographicCamera, dom: canvas, mouse }
    const found = hasCuts() ? await model.raycastAll(data) : [await model.raycast(data)]
    return (found ?? []).filter(hit => !!hit?.point && pointKept(hit.point))
  } catch {
    return []
  }
}

async function sliceSurface(
  engine: FragmentsEngine,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): Promise<{ point: THREE.Vector3, normal: THREE.Vector3 } | null> {
  const camera = engine.world.camera.three
  const mouse = new THREE.Vector2(clientX, clientY)
  const models = [...(engine.fragments?.models?.list?.values() ?? [])] as FragmentsModel[]
  const hits = await Promise.all(models.map(async (model) => {
    const found = await keptModelHits(model, camera, canvas, mouse)
    let best: { point: THREE.Vector3, normal: THREE.Vector3, distance: number } | null = null
    for (const hit of found) {
      if (!hit.normal || hit.normal.lengthSq() < 1e-8) continue
      const distance = hit.distance ?? hit.rayDistance ?? 0
      if (!best || distance < best.distance) best = { point: hit.point, normal: hit.normal, distance }
    }
    return best
  }))
  let best: { point: THREE.Vector3, normal: THREE.Vector3, distance: number } | null = null
  for (const hit of hits) {
    if (hit && (!best || hit.distance < best.distance)) best = hit
  }
  if (best) return { point: best.point.clone(), normal: best.normal.clone() }

  const rect = canvas.getBoundingClientRect()
  const x = ((clientX - rect.left) / rect.width) * 2 - 1
  const y = -((clientY - rect.top) / rect.height) * 2 + 1
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
  const roots: THREE.Object3D[] = []
  for (const model of models) {
    if (model.object?.visible) roots.push(model.object)
  }
  const faceHit = raycaster.intersectObjects(roots, true).find(h =>
    h.face && !h.object.userData?.ekoSlice && !h.object.userData?.ekoMeasure && pointKept(h.point))
  if (!faceHit?.face) return null
  const normal = faceHit.face.normal.clone().transformDirection(faceHit.object.matrixWorld)
  if (normal.dot(raycaster.ray.direction) > 0) normal.negate()
  return { point: faceHit.point.clone(), normal }
}

// The ruler keeps going at the height of the last point when the cursor
// leaves the model. This viewer is Y-up, so that plane is horizontal.
function levelPoint(engine: FragmentsEngine, clientX: number, clientY: number, rect: DOMRect): THREE.Vector3 | null {
  const last = measureTool()?.lastPoint()
  if (!last || rect.width <= 0 || rect.height <= 0) return null
  const x = ((clientX - rect.left) / rect.width) * 2 - 1
  const y = -((clientY - rect.top) / rect.height) * 2 + 1
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(x, y), engine.world.camera.three)
  const dir = raycaster.ray.direction
  if (Math.abs(dir.y) < 0.001) return null
  const t = (last.y - raycaster.ray.origin.y) / dir.y
  if (!(t > 0) || t > 500) return null
  const point = raycaster.ray.origin.clone().addScaledVector(dir, t)
  return pointKept(point) ? point : null
}

interface ViewerCanvasProps {
  onEngineReady?: (engineRef: React.MutableRefObject<FragmentsEngine | null>) => void
  adminMode?: boolean
  isFinProject?: boolean
}

export function ViewerCanvas({ onEngineReady, adminMode = true, isFinProject = false }: ViewerCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cameraDrag = useRef(false)
  const skipToolClick = useRef(false)
  const statsRef = useRef<any>(null)
  const statsContainerRef = useRef<HTMLDivElement>(null)
  const [statsVisible, setStatsVisible] = useState(false)
  const [pickerActive, setPickerActive] = useState(false)
  const [dashboardVisible, setDashboardVisible] = useState(isFinProject || !adminMode)
  const [pickedCoord, setPickedCoord] = useState<[number, number, number] | null>(null)
  const materialPickerActive = useAppStore(s => s.materialPickerActive)
  const setMaterialPickerActive = useAppStore(s => s.setMaterialPickerActive)
  const selectedMaterialElement = useAppStore(s => s.selectedMaterialElement)
  const setSelectedMaterialElement = useAppStore(s => s.setSelectedMaterialElement)
  const isFullscreen = useAppStore(s => s.isFullscreen)
  const isToolbarVisible = useAppStore(s => s.isToolbarVisible)
  const renderPanelActive = useAppStore(s => s.renderPanelActive)
  const [wallOn, setWallOn] = useState(() => typeof document !== 'undefined' && !!document.querySelector('.dashboard-native-container[data-wall="1"]'))

  useEffect(() => {
    if (isFinProject || !adminMode) {
      setDashboardVisible(true)
    }
  }, [isFinProject, adminMode])

  useEffect(() => {
    const onWall = (e: Event) => setWallOn(!!(e as CustomEvent).detail?.on)
    window.addEventListener('dashboard-wall', onWall)
    return () => window.removeEventListener('dashboard-wall', onWall)
  }, [])

  useEffect(() => {
    let startX = 0
    let startY = 0
    let tracking = false
    const down = (e: PointerEvent) => {
      const el = containerRef.current
      if (!el || !el.contains(e.target as Node)) return
      tracking = true
      cameraDrag.current = false
      skipToolClick.current = false
      startX = e.clientX
      startY = e.clientY
    }
    const move = (e: PointerEvent) => {
      if (!tracking || cameraDrag.current || e.buttons === 0) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (dx * dx + dy * dy > CAMERA_DRAG_PX * CAMERA_DRAG_PX) cameraDrag.current = true
    }
    const up = () => {
      if (tracking && cameraDrag.current) skipToolClick.current = true
      tracking = false
      cameraDrag.current = false
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [])



  const { engineRef, isReady, error } = useFragmentsEngine(containerRef)
  const { loadModel, isLoading } = useModelLoader(engineRef)
  const progressSessionActive = useLoadingProgressStore(s => s.sessionActive)
  
  // Initialize material overrides
  useMaterialOverrides(engineRef)

  const models = useModelStore(s => s.models)
  const step = useAppStore(s => s.step)
  const renderSettings = useAppStore(useShallow(pickRenderSettings))
  // Subscribed (not getState) so project switches actually re-run the effects below
  const currentProjectId = useProjectStore(s => s.currentProject?.projectId)

  useEffect(() => {
    if (!isReady) return
    if (onEngineReady) onEngineReady(engineRef)
    attachDevBridge(engineRef)
  }, [isReady, onEngineReady])

  useEffect(() => { installStudioViewerApi() }, [])

  useEffect(() => {
    if (!isReady || !engineRef.current) return
    const engine = engineRef.current
    const scene = engine.world?.scene?.three
    const camera = engine.world?.camera?.three
    if (!scene || !camera) return
    const tool = createMeasure({
      scene,
      getCamera: () => engine.world.camera.three,
      getViewHeight: () => containerRef.current?.clientHeight || 800,
      controls: engine.world.camera.controls,
    })
    setMeasureTool(tool)
    const dom = containerRef.current
    const slice = dom ? createSlice({
      scene,
      dom,
      getCamera: () => engine.world.camera.three,
      getViewHeight: () => containerRef.current?.clientHeight || 800,
      controls: engine.world.camera.controls,
      fragments: engine.fragments,
      renderer: engine.world.renderer?.three,
    }) : null
    if (slice) setSliceTool(slice)
    return () => {
      tool.dispose()
      setMeasureTool(null)
      slice?.dispose()
      setSliceTool(null)
    }
  }, [isReady])

  // Restore the saved view every time a project is opened. The engine is created
  // once and outlives project switches, so this cannot hang off engine-ready alone.
  useEffect(() => {
    if (!isReady || !currentProjectId) return
    const camera = useProjectStore.getState().currentProject?.camera
    const controls = engineRef.current?.world?.camera?.controls
    if (!camera || !controls) return
    try {
      controls.setLookAt(
        camera.position[0], camera.position[1], camera.position[2],
        camera.target[0], camera.target[1], camera.target[2],
        false
      )
    } catch (e) {
      console.warn('Failed to restore camera in ViewerCanvas:', e)
    }
  }, [isReady, currentProjectId])

  useEffect(() => {
    if (isReady && engineRef.current) {
      engineRef.current.setLightingParams(renderSettings)
    }
  }, [renderSettings, isReady])

  const loadedIdsRef = useRef<Set<string>>(new Set())
  const isLoadingRef = useRef(false)

  useEffect(() => {
    if (!isReady) return
    // Models stream in one at a time, so this effect re-runs while an earlier
    // pass is still going — keep engine loads strictly sequential. Teardown sits
    // inside the same section so it can never interleave with a load.
    if (isLoadingRef.current) return
    isLoadingRef.current = true

    const loadSequentially = async () => {
      try {
        // An empty store only means "project closed" once something was actually
        // loaded; on first mount it is just the session that has not started yet
        if (useModelStore.getState().models.length === 0 && loadedIdsRef.current.size > 0) {
          await unloadAllModels(engineRef.current)
          loadedIdsRef.current.clear()
          useLoadingProgressStore.getState().endSession()
        }
        for (;;) {
          // Re-read the store each pass so models added mid-load are picked up
          const next = useModelStore.getState().models.find(
            m => m.fragBytes && !loadedIdsRef.current.has(m.modelId)
          )
          if (!next) break
          loadedIdsRef.current.add(next.modelId)
          const hasCamera = !!useProjectStore.getState().currentProject?.camera
          await loadModel(next.fragBytes, next.modelId, next.type, {
            position: next.position,
            rotation: next.rotation,
            scale: next.scale,
          }, adminMode && !hasCamera)
          
          if (engineRef.current) {
            engineRef.current.setLightingParams(pickRenderSettings(useAppStore.getState()))
          }
        }
      } finally {
        isLoadingRef.current = false
      }
    }

    loadSequentially()
  }, [models, isReady])

  useEffect(() => {
    setPickerActive(false)
    setPickedCoord(null)
    measureTool()?.clear()
    sliceTool()?.clear()
    setStatsVisible(false)
    setDashboardVisible(isFinProject || !adminMode)
    useAppStore.getState().setMaterialPickerActive(false)
    useAppStore.getState().setSelectedMaterialElement(null)
  }, [currentProjectId, isFinProject, adminMode])

  useEffect(() => {
    if (!isReady || !statsContainerRef.current) return
    let Stats: any
    import('stats.js').then((mod) => {
      Stats = mod.default
      const stats = new Stats()
      stats.showPanel(0)
      stats.dom.style.position = 'absolute'
      stats.dom.style.top = '0'
      stats.dom.style.left = '0'
      setStatsVisible(prev => {
        stats.dom.style.display = prev ? 'block' : 'none'
        return prev
      })
      statsContainerRef.current?.appendChild(stats.dom)
      statsRef.current = stats

      const engine = engineRef.current
      if (engine) {
        engine.world.renderer.onBeforeUpdate.add(() => stats.begin())
        engine.world.renderer.onAfterUpdate.add(() => stats.end())
      }
    })

    return () => {
      if (statsRef.current?.dom?.parentNode) {
        statsRef.current.dom.parentNode.removeChild(statsRef.current.dom)
      }
    }
  }, [isReady])

  useEffect(() => {
    if (statsRef.current?.dom) {
      statsRef.current.dom.style.display = statsVisible ? 'block' : 'none'
    }
  }, [statsVisible])

  // Draw selection edges (EdgesGeometry for both IFC and GLB)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    let glbEdges = engine.world.scene.three.getObjectByName('glb-selection-edges') as THREE.LineSegments;
    if (!glbEdges) {
      glbEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false }));
      glbEdges.name = 'glb-selection-edges';
      glbEdges.visible = false;
      engine.world.scene.three.add(glbEdges);
    }

    if (materialPickerActive && selectedMaterialElement) {
      const { modelId, id } = selectedMaterialElement;
      const model = engine.fragments.models.list.get(modelId) as any;
      
      glbEdges.visible = false;

      if (model && typeof model.getItemsGeometry === 'function') {
        const fetchEdges = async () => {
          try {
            const geometries = await model.getItemsGeometry([id]);
            if (geometries && geometries[0] && geometries[0].length > 0) {
              let totalPositions = 0;
              let totalIndices = 0;
              for (const meshData of geometries[0]) {
                if (!meshData.positions) continue;
                totalPositions += meshData.positions.length / 3;
                totalIndices += meshData.indices ? meshData.indices.length : meshData.positions.length / 3;
              }

              if (totalPositions > 0) {
                const posArray = new Float32Array(totalPositions * 3);
                const indexArray = new Uint32Array(totalIndices);

                let posOffset = 0;
                let idxOffset = 0;
                let vertexOffset = 0;
                const tempVec = new THREE.Vector3();

                for (const meshData of geometries[0]) {
                  if (!meshData.positions) continue;
                  
                  let matrix = new THREE.Matrix4();
                  if (meshData.transform instanceof THREE.Matrix4) {
                    matrix.copy(meshData.transform);
                  } else if (Array.isArray(meshData.transform)) {
                    matrix.fromArray(meshData.transform);
                  } else if ((meshData.transform as any).elements) {
                    matrix.fromArray((meshData.transform as any).elements);
                  }
                  
                  const pos = meshData.positions;
                  for (let i = 0; i < pos.length; i += 3) {
                    tempVec.set(pos[i], pos[i + 1], pos[i + 2]);
                    tempVec.applyMatrix4(matrix);
                    posArray[posOffset++] = tempVec.x;
                    posArray[posOffset++] = tempVec.y;
                    posArray[posOffset++] = tempVec.z;
                  }
                  
                  if (meshData.indices) {
                    for (let i = 0; i < meshData.indices.length; i++) {
                      indexArray[idxOffset++] = meshData.indices[i] + vertexOffset;
                    }
                  } else {
                    for (let i = 0; i < pos.length / 3; i++) {
                      indexArray[idxOffset++] = i + vertexOffset;
                    }
                  }
                  vertexOffset += pos.length / 3;
                }

                const geom = new THREE.BufferGeometry();
                geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
                geom.setIndex(new THREE.BufferAttribute(indexArray, 1));
                
                glbEdges.geometry.dispose();
                glbEdges.geometry = new THREE.EdgesGeometry(geom);
                
                // IF the model itself has a transform (like when positioned in the scene), apply it to the mesh matrix
                if (model.object && model.object.matrixWorld) {
                   glbEdges.matrix.copy(model.object.matrixWorld);
                } else {
                   glbEdges.matrix.identity();
                }
                glbEdges.matrixAutoUpdate = false;
                glbEdges.visible = true;
              }
            }
          } catch (e) {
            console.warn('[ViewerCanvas] Failed to extract edges for IFC element:', e);
          }
        };
        fetchEdges();
      } else {
        // Fallback for GLB standard objects
        const obj = engine.world.scene.three.children.find((c: any) => c.userData?.modelId === modelId);
        if (obj) {
          let mesh: THREE.Mesh | null = null;
          obj.traverse((child: any) => {
            if (child.isMesh && !mesh) mesh = child;
          });
          if (mesh) {
            glbEdges.geometry.dispose();
            glbEdges.geometry = new THREE.EdgesGeometry(mesh.geometry);
            glbEdges.matrix.copy(mesh.matrixWorld);
            glbEdges.matrixAutoUpdate = false;
            glbEdges.visible = true;
          }
        }
      }
    } else {
      if (glbEdges) glbEdges.visible = false;
    }
  }, [selectedMaterialElement, materialPickerActive, engineRef]);

  const hoverStamp = useRef(0)
  const measureQueue = useRef<Promise<void>>(Promise.resolve())
  const onMeasureMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const tool = measureTool()
    if (!tool?.pending()) return
    if (cameraDrag.current) {
      tool.hover(null)
      return
    }
    const now = performance.now()
    if (now - hoverStamp.current < 40) return
    hoverStamp.current = now
    const engine = engineRef.current
    const container = containerRef.current
    if (!engine || !container) return
    const rect = container.getBoundingClientRect()
    tool.hover(hoverHit(engine, e.clientX, e.clientY, rect) || levelPoint(engine, e.clientX, e.clientY, rect))
  }

  const handleCanvasClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    // The dashboard Select tool is the resting tool. A click on the model
    // then opens the same card a marker tap does.
    const selectArmed = dashboardVisible && (window as any).EKO?.state?.dock?.tool === 'select'
    const measureArmed = dashboardVisible && (window as any).EKO?.state?.dock?.tool === 'measure'
    const sliceArmed = dashboardVisible && (window as any).EKO?.state?.dock?.tool === 'slice'
    if (!pickerActive && !materialPickerActive && !selectArmed && !measureArmed && !sliceArmed) return
    const engine = engineRef.current
    if (!engine) return
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const canvas = container.querySelector('canvas')
    const dragged = skipToolClick.current
    skipToolClick.current = false
    if (sliceArmed) {
      if (sliceTool()?.suppressClick()) return
      if (dragged || sliceTool()?.hitsHandle(e.clientX, e.clientY)) return
      if (canvas) {
        const hit = await sliceSurface(engine, canvas, e.clientX, e.clientY)
        if (hit) sliceTool()?.place(hit.point, hit.normal)
      }
      return
    }
    if ((measureArmed || selectArmed) && dragged) return
    if (canvas) {
      const canvasRect = canvas.getBoundingClientRect()
    }

    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    const ndc = new THREE.Vector2(x, y)
    // The library m.raycast function actually expects raw window coordinates and handles the container offset itself!
    const rawPx = new THREE.Vector2(e.clientX, e.clientY)

    let hitExpressId: string | null = null;
    let hitModelId: string | null = null;
    let hitPoint: THREE.Vector3 | null = null;
    let fragHitDistance = Infinity;

    try {
      // 1. Native Fragment Raycast
      if (canvas) {
        for (const [modelId, m] of engine.fragments.models.list.entries()) {
          try {
            const mAny = m as any;
            if (m.object) m.object.updateMatrixWorld(true);
            if (typeof mAny.raycast === 'function') {
              const found = await keptModelHits(m as FragmentsModel, engine.world.camera.three, canvas, rawPx)
              for (const hit of found) {
                if (typeof hit.localId !== 'number') continue
                const dist = hit.distance ?? hit.rayDistance ?? 0
                if (dist < fragHitDistance) {
                  fragHitDistance = dist;
                  hitModelId = modelId;
                  hitExpressId = hit.localId.toString();
                  hitPoint = hit.point;
                }
              }
            }
          } catch (err) {}
        }
      }
    } catch (err) {}

    // 2. Fallback: standard THREE.Raycaster individually catching crashes
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, engine.world.camera.three)
    
    let allHits: THREE.Intersection[] = [];
    const scene = engine.world.scene.three;
    scene.updateMatrixWorld(true);
    
    scene.traverse((child: any) => {
      if (child.isMesh && child.visible && child.name !== 'SkyDome' && child.name !== 'CloudsDome') {
        // Check if any parent is hidden
        let isVisible = true;
        let curr = child;
        while (curr) {
            if (curr.visible === false) {
                isVisible = false;
                break;
            }
            curr = curr.parent;
        }
        
        if (isVisible) {
          try {
            const hits = raycaster.intersectObject(child, false);
            allHits.push(...hits);
          } catch (err) {
            // Ignore crashing meshes
          }
        }
      }
    });
    
    allHits.sort((a, b) => a.distance - b.distance);
    
    let stdHitModelId: string | null = null;
    let stdHitExpressId: string | null = null;
    let stdHitPoint: THREE.Vector3 | null = null;
    let stdHitDistance = Infinity;

    let hits: THREE.Intersection[] = []
    for (const h of allHits) {
       const mesh = h.object as THREE.Mesh
       if (!mesh.visible || mesh.userData?.ekoSlice || mesh.userData?.ekoMeasure) continue
       if (!pointKept(h.point)) continue
       hits.push(h)
    }
    hits.sort((a, b) => a.distance - b.distance)

    if (hits.length > 0) {
       const hit = hits[0]
       stdHitDistance = hit.distance;
       stdHitPoint = hit.point;
       const mesh = hit.object as THREE.Mesh & { getItemID?: (idx: number) => string };
       
       let modelId = mesh.userData?.modelId;
       let curr: any = mesh;
       while (!modelId && curr.parent) {
         curr = curr.parent;
         modelId = curr.userData?.modelId;
       }
       
       if (!modelId) {
         for (const [id, model] of engine.fragments.models.list.entries()) {
           const m = model as any;
           if (m === mesh || m.object === mesh || m === curr || m.object === curr) {
             modelId = id; break;
           }
           if (m.children?.includes(mesh) || m.items?.some((i: any) => i.mesh === mesh)) {
             modelId = id; break;
           }
         }
       }

       if (modelId) {
          stdHitModelId = modelId;
          
          let expressId = mesh.userData?.expressId;
          if (mesh.userData?.faceToExpressId && hit.faceIndex !== undefined) {
             expressId = mesh.userData.faceToExpressId[hit.faceIndex];
          }
          
          stdHitExpressId = expressId?.toString() || hit.instanceId?.toString() || (hit as any).batchId?.toString() || (hit as any).localId?.toString() || '0';
          if (typeof mesh.getItemID === 'function' && hit.instanceId !== undefined) {
            stdHitExpressId = mesh.getItemID(hit.instanceId);
          }
       }
    }

    if (stdHitModelId && stdHitExpressId && stdHitDistance < fragHitDistance) {
       hitModelId = stdHitModelId;
       hitExpressId = stdHitExpressId;
       if (stdHitPoint) hitPoint = stdHitPoint;
    }

    if (measureArmed) {
      const fallback = hitPoint ? hitPoint.clone() : null
      const mouse = rawPx.clone()
      const clientX = e.clientX
      const clientY = e.clientY
      const job = measureQueue.current.then(async () => {
        let point = fallback
        if (canvas) {
          const snapped = await snapMeasurePoint(engine, canvas, mouse)
          if (snapped) point = snapped
        }
        if (!point) point = levelPoint(engine, clientX, clientY, rect)
        if (point) measureTool()?.click(point)
      })
      measureQueue.current = job.catch(() => {})
      return
    }

    if (hitModelId && hitExpressId) {
      if (pickerActive && hitPoint) {
         setPickedCoord([
           parseFloat(hitPoint.x.toFixed(3)),
           parseFloat(hitPoint.y.toFixed(3)),
           parseFloat(hitPoint.z.toFixed(3)),
         ])
      } else if (materialPickerActive) {
         const expressId = parseInt(hitExpressId, 10) || 0;
         
         // Start with fallback
         let resolvedCategory = 'Object';
         
         const fragModel = engine.fragments.models.list.get(hitModelId) as any;
         if (fragModel && typeof fragModel.getCategories === 'function' && typeof fragModel.getItemsByQuery === 'function') {
           fragModel.getCategories().then(async (cats: string[]) => {
             for (const cat of cats) {
               try {
                 const ids = await fragModel.getItemsByQuery({ categories: [new RegExp(cat, 'i')] });
                 if (ids && ids.includes(expressId)) {
                   resolvedCategory = cat;
                   break;
                 }
               } catch (e) {
                 // ignore
               }
             }
             
             setSelectedMaterialElement({
               modelId: hitModelId,
               id: expressId,
               category: resolvedCategory
             });
           }).catch(() => {
             // fallback
             setSelectedMaterialElement({
               modelId: hitModelId,
               id: expressId,
               category: resolvedCategory
             });
           });
         } else {
           setSelectedMaterialElement({
             modelId: hitModelId,
             id: expressId,
             category: resolvedCategory
           });
         }
      } else if (selectArmed) {
         const localId = parseInt(hitExpressId, 10) || 0;
         const fragModel = engine.fragments.models.list.get(hitModelId) as any;
         if (!fragModel || typeof fragModel.getGuidsByLocalIds !== 'function') return;
         try {
           const guids = await fragModel.getGuidsByLocalIds([localId]);
           const guid = guids && guids[0];
           if (!guid) return;
           let name = '', type = '', category = '';
           if (typeof fragModel.getItemsData === 'function') {
             const rows = await fragModel.getItemsData([localId]);
             const row = rows && rows[0];
             const text = (keys: string[]) => {
               if (!row) return '';
               for (const k of keys) {
                 const v = row[k];
                 const raw = v && typeof v === 'object' && 'value' in v ? v.value : v;
                 if (raw != null && raw !== '') return String(raw);
               }
               return '';
             };
             name = text(['Name', 'LongName']);
             type = text(['ObjectType', 'PredefinedType', 'Tag']);
             category = text(['_category', 'category']);
           }
           window.dispatchEvent(new CustomEvent('viewer-command', {
             detail: { action: 'openAssetByBimId', bimId: guid, expressId: localId, name, type, category }
           }));
         } catch { /* a miss is not a selection */ }
      }
    }
  }, [pickerActive, materialPickerActive, dashboardVisible])

  return (
    <div className="viewer-canvas-wrapper">
      <FocusModeWidget />
      {/* Three.js mount */}
      <div
        ref={containerRef}
        className={`viewer-canvas-container${(pickerActive || materialPickerActive) ? ' picker-cursor' : ''}`}
        onClick={handleCanvasClick}
        onMouseMove={onMeasureMove}
        style={{ visibility: step === 'viewing' ? 'visible' : 'hidden' }}
      />

      {/* Stats overlay */}
      <div ref={statsContainerRef} className="stats-overlay" />

      {/* Dashboard Overlay */}
      {step === 'viewing' && (
        <DashboardOverlay visible={dashboardVisible} engineRef={engineRef} engineReady={isReady} />
      )}

      {/* Orientation Cube (ViewCube) */}
      {step === 'viewing' && (
        <OrientationCube engineRef={engineRef} dashboardVisible={dashboardVisible} />
      )}

      {step === 'viewing' && isToolbarVisible && (adminMode || wallOn) && (
        <ViewerToolbar
          engineRef={engineRef}
          onToggleStats={() => setStatsVisible(v => !v)}
          statsVisible={statsVisible}
          pickerActive={pickerActive}
          onTogglePicker={() => {
            setPickerActive(!pickerActive)
            if (!pickerActive) setMaterialPickerActive(false)
          }}
          dashboardVisible={dashboardVisible}
          onToggleDashboard={() => setDashboardVisible(v => !v)}
          materialPickerActive={materialPickerActive}
          onToggleMaterialPicker={() => {
            setMaterialPickerActive(!materialPickerActive)
            if (!materialPickerActive) setPickerActive(false)
          }}
          renderPanelActive={renderPanelActive}
          onToggleRenderPanel={() => useAppStore.getState().setRenderPanelActive(!renderPanelActive)}
        />
      )}

      {/* Floating template pill — only when the FIN dashboard overlay is active */}
      {/* {step === 'viewing' && renderSettings.templateSwitcher !== false && dashboardVisible && (
        <div style={{ '--tpl-bar-bottom': '140px' } as React.CSSProperties}>
          <TemplateBar defaultOpen={false} />
        </div>
      )} */}

      {/* Right side panels */}
      {step === 'viewing' && (adminMode || renderPanelActive) && (!isFullscreen || isToolbarVisible) && (
        <div className="right-panels-container" key={currentProjectId || 'empty'}>
          {(adminMode || renderPanelActive) && <RenderPanel />}
          {adminMode && (
            <ModelPositionPanel 
              engineRef={engineRef} 
              pickedCoord={pickedCoord}
              onClearPickedCoord={() => setPickedCoord(null)}
            />
          )}
          {adminMode && <MaterialPanel engineRef={engineRef} />}
        </div>
      )}

      {/* Loading progress — per-model status with live percentage */}
      <ModelLoadingProgress />
      {isLoading && !progressSessionActive && (
        <div className="viewer-overlay">
          <div className="viewer-overlay-inner">
            <div className="viewer-spinner" />
            <p>Loading model into scene...</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="viewer-overlay">
          <div className="viewer-overlay-inner error">
            <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <p>3D engine error</p>
            <p className="error-detail">{error}</p>
          </div>
        </div>
      )}

      {/* Empty state hint — studio only; the exported viewer has no upload flow */}
      {step !== 'viewing' && !error && isReady && adminMode && (
        <div className="viewer-empty">
          <div className="viewer-empty-inner">
            <svg viewBox="0 0 64 64" fill="none" width="64" height="64" opacity="0.15">
              <rect x="8" y="20" width="20" height="28" rx="2" stroke="currentColor" strokeWidth="2"/>
              <rect x="32" y="12" width="20" height="36" rx="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M8 44h44" stroke="currentColor" strokeWidth="2"/>
            </svg>
            <p>Upload an IFC file to begin</p>
          </div>
        </div>
      )}
    </div>
  )
}
