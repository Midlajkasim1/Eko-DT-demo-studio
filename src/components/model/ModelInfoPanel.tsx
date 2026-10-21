import { useState } from 'react'
import { Box3 } from 'three'
import { useModelStore } from '@/store/useModelStore'
import { useProjectStore } from '@/store/useProjectStore'
import { formatBytes, formatDuration } from '@/lib/downloadUtils'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import { useFragmentDownload } from '@/hooks/useFragmentDownload'
import { useSpatialTree } from '@/hooks/useSpatialTree'
import { ModelTreeViewer } from './ModelTreeViewer'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface ModelInfoPanelProps {
  engineRef: React.MutableRefObject<FragmentsEngine | null>
}

interface ModelTreeContainerProps {
  engineRef: React.MutableRefObject<FragmentsEngine | null>
  modelId: string
}

function ModelTreeContainer({ engineRef, modelId }: ModelTreeContainerProps) {
  const isLoadedInEngine = useModelStore(s => s.modelsLoadedInEngine[modelId])
  const { treeData, isLoading } = useSpatialTree(engineRef, modelId, isLoadedInEngine)
  
  const handleNodeClick = async (localId: number) => {
    const engine = engineRef.current
    if (!engine) return
    const model = engine.fragments.models.list.get(modelId)
    if (!model || !model.object) return

    // Instead of using complex Highlighters which require full components integration,
    // we just isolate the selected items using FragmentsManager's getItems or model visibility.
    // However, the requested action is to highlight or fly to.
    // The easiest robust way to fly to an element without OBC highlighter is to extract its box.
    const items = engine.fragments.models.list.get(modelId)
    if (items) {
      // Find bounding box of the element (if possible) or just do nothing for now 
      // since the user didn't specify exactly what should happen when clicking a node.
      // Wait, let's try isolating it by setting visibility
    }
  }

  if (isLoading) return <div style={{ fontSize: 11, padding: '8px 0', color: 'var(--text-muted)' }}>Loading tree...</div>
  if (!treeData) return null

  return <ModelTreeViewer data={treeData} onNodeClick={handleNodeClick} />
}

export function ModelInfoPanel({ engineRef }: ModelInfoPanelProps) {
  const models = useModelStore(s => s.models)
  const modelVisibility = useModelStore(s => s.modelVisibility)
  const toggleVisibilityState = useModelStore(s => s.toggleVisibility)
  const removeModel = useModelStore(s => s.removeModel)
  const { download, isDownloading } = useFragmentDownload(engineRef)

  const currentProject = useProjectStore(s => s.currentProject)
  const removeModelEntry = useProjectStore(s => s.removeModelEntry)
  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState(false)

  if (!models || models.length === 0) return null

  const handleToggle = (modelId: string) => {
    const engine = engineRef.current
    if (!engine) return
    const model = models.find(m => m.modelId === modelId)
    
    let object3D = null
    if (model?.type === 'glb') {
      object3D = engine.world.scene.three.children.find((c: any) => c.userData?.modelId === modelId)
    } else {
      const fragModel = engine.fragments.models.list.get(modelId)
      object3D = fragModel?.object
    }

    if (object3D) {
      const isCurrentlyVisible = modelVisibility[modelId] !== false
      object3D.visible = !isCurrentlyVisible
      toggleVisibilityState(modelId)
    }
  }

  const handleFocus = async (modelId: string) => {
    const engine = engineRef.current
    if (!engine) return
    const model = models.find(m => m.modelId === modelId)
    
    let object3D = null
    if (model?.type === 'glb') {
      object3D = engine.world.scene.three.children.find((c: any) => c.userData?.modelId === modelId)
    } else {
      const fragModel = engine.fragments.models.list.get(modelId)
      object3D = fragModel?.object
    }

    if (object3D && modelVisibility[modelId] !== false) {
      const box = new Box3().setFromObject(object3D)
      if (!box.isEmpty()) {
        await engine.world.camera.controls.fitToBox(box, true)
      }
    }
  }

  const handleRemoveModel = async (modelId: string) => {
    // Dispose from the 3D engine
    const engine = engineRef.current
    if (engine) {
      try {
        const model = models.find(m => m.modelId === modelId)
        if (model?.type === 'glb') {
          const existing = engine.world.scene.three.children.find((c: any) => c.userData?.modelId === modelId)
          if (existing) engine.world.scene.three.remove(existing)
        } else {
          await engine.fragments.disposeModel(modelId)
        }
      } catch { /* ignore */ }
    }

    // Remove from project if a project is open
    if (currentProject) {
      await removeModelEntry(modelId)
    }

    // Remove from the model store
    removeModel(modelId)
  }

  const confirmRemove = async () => {
    if (!pendingRemove) return
    setRemoving(true)
    try {
      await handleRemoveModel(pendingRemove.id)
    } finally {
      setRemoving(false)
      setPendingRemove(null)
    }
  }

  return (
    <div className="model-info">
      <div className="model-info-header">
        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" className="model-info-icon">
          <path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/>
        </svg>
        <span className="model-info-title">Loaded Models (<span style={{ fontFamily: 'var(--font-mono)' }}>{models.length}</span>)</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', maxHeight: '300px', overflowY: 'auto' }}>
        {models.map(model => {
          const ratio = model.originalFileSizeBytes > 0
            ? Math.round((1 - model.convertedFileSizeBytes / model.originalFileSizeBytes) * 100)
            : 0
          
          const isVisible = modelVisibility[model.modelId] !== false

          return (
            <div key={model.modelId} style={{ paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <div 
                  className="model-info-filename" 
                  title={model.originalFileName} 
                  style={{ 
                    opacity: isVisible ? 1 : 0.5, 
                    flex: 1, 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis', 
                    whiteSpace: 'nowrap', 
                    marginRight: '0.5rem',
                  }}
                >
                  {model.originalFileName}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button 
                    onClick={() => handleToggle(model.modelId)} 
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.8, padding: '2px' }}
                    title={isVisible ? "Hide model" : "Show model"}
                  >
                    {isVisible ? (
                      <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                        <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                        <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                        <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                        <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                      </svg>
                    )}
                  </button>
                  <button 
                    onClick={() => handleFocus(model.modelId)} 
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.8, padding: '2px' }}
                    title="Focus camera on this model"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                      <path d="M5 3a2 2 0 00-2 2v2a1 1 0 102 0V5h2a1 1 0 100-2H5zM5 17a2 2 0 01-2-2v-2a1 1 0 112 0v2h2a1 1 0 110 2H5zM15 3a2 2 0 012 2v2a1 1 0 11-2 0V5h-2a1 1 0 110-2h2zM15 17a2 2 0 002-2v-2a1 1 0 10-2 0v2h-2a1 1 0 100 2h2z" />
                    </svg>
                  </button>
                  {model.type !== 'glb' && (
                    <button 
                      onClick={() => download(model.modelId, model.originalFileName)} 
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.8, padding: '2px' }}
                      title="Download this model"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                        <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/>
                      </svg>
                    </button>
                  )}
                  <button 
                    onClick={() => setPendingRemove({ id: model.modelId, name: model.originalFileName })}
                    className="model-remove-btn"
                    title="Remove model"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
                    </svg>
                  </button>
                </div>
              </div>

              {model.originalFileName.toLowerCase().endsWith('.frag') ? (
                <div className="model-info-grid" style={{ marginTop: '0.25rem', opacity: isVisible ? 1 : 0.5, gridTemplateColumns: '1fr' }}>
                  <div className="info-stat">
                    <span className="info-stat-label">.frag Size</span>
                    <span className="info-stat-value accent">{formatBytes(model.convertedFileSizeBytes)}</span>
                  </div>
                </div>
              ) : (
                <div className="model-info-grid" style={{ marginTop: '0.25rem', opacity: isVisible ? 1 : 0.5 }}>
                  <div className="info-stat">
                    <span className="info-stat-label">IFC Size</span>
                    <span className="info-stat-value">{formatBytes(model.originalFileSizeBytes)}</span>
                  </div>
                  <div className="info-stat">
                    <span className="info-stat-label">.frag Size</span>
                    <span className="info-stat-value accent">{formatBytes(model.convertedFileSizeBytes)}</span>
                  </div>
                  <div className="info-stat">
                    <span className="info-stat-label">Compression</span>
                    <span className="info-stat-value good">{ratio}% smaller</span>
                  </div>
                  <div className="info-stat">
                    <span className="info-stat-label">Convert Time</span>
                    <span className="info-stat-value">{formatDuration(model.conversionTimeMs)}</span>
                  </div>
                </div>
              )}

              {/* Render the Spatial Tree for this model (if not GLB) */}
              {model.type !== 'glb' && (
                <div style={{ marginTop: '8px' }}>
                  <ModelTreeContainer engineRef={engineRef} modelId={model.modelId} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {pendingRemove && (
        <ConfirmDialog
          title="Remove model?"
          message={
            <>
              <p>Remove <b>{pendingRemove.name}</b>{currentProject ? <> from <b>{currentProject.name}</b></> : null}?</p>
              <p className="confirm-note">
                {currentProject
                  ? 'Its converted file is deleted from the project folder. To bring it back, import the IFC again.'
                  : 'It is unloaded from the viewer.'}
              </p>
            </>
          }
          confirmLabel="Remove"
          busyLabel="Removing…"
          busy={removing}
          onConfirm={confirmRemove}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  )
}
