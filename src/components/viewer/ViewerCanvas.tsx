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
import type { FragmentsEngine } from '@/lib/fragmentsEngine'

interface ViewerCanvasProps {
  onEngineReady?: (engineRef: React.MutableRefObject<FragmentsEngine | null>) => void
  adminMode?: boolean
  isFinProject?: boolean
}

export function ViewerCanvas({ onEngineReady, adminMode = true, isFinProject = false }: ViewerCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (isFinProject || !adminMode) {
      setDashboardVisible(true)
    }
  }, [isFinProject, adminMode])



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

  const handleCanvasClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    // The dashboard Select tool is the resting tool. A click on the model
    // then opens the same card a marker tap does.
    const selectArmed = dashboardVisible && (window as any).EKO?.state?.dock?.tool === 'select'
    if (!pickerActive && !materialPickerActive && !selectArmed) return
    const engine = engineRef.current
    if (!engine) return
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const canvas = container.querySelector('canvas')
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
              let hit = await mAny.raycast({
                camera: engine.world.camera.three,
                dom: canvas,
                mouse: rawPx,
              });
              if (hit && typeof hit.localId === 'number') {
                const dist = hit.distance ?? hit.rayDistance ?? 0;
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
       if (mesh.visible) {
           hits.push(h)
       }
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

      {step === 'viewing' && adminMode && isToolbarVisible && (
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
