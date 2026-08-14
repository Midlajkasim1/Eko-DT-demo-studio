import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { useMapStore } from '@/store/useMapStore'
import { useProjectStore } from '@/store/useProjectStore'
import { emptyMapConfig, childrenOf, findLocation } from '@/lib/mapConfig'
import { removeLocation, updateLocation, setCamera, setZoomLimits } from '@/lib/mapDraft'
import { MapOverlayEditor } from '@/components/map/MapOverlayEditor'
import type { MapEngine } from '@/lib/mapEngine'
import type { MapConfig, ProjectMeta } from '@/types'

/** Renders ship with the app per region, so per-project imagery authoring stays out of the way */
const SHOW_RENDER_EDITOR = false

const parseLimit = (value: string) => (value.trim() === '' ? undefined : Number(value))

/** Subscribes on its own so the camera does not re-render the whole panel */
function ZoomReadout({ engine }: { engine: MapEngine | null }) {
  const zoom = useSyncExternalStore(
    useCallback((notify: () => void) => engine?.subscribe(notify) ?? (() => {}), [engine]),
    useCallback(() => engine?.getState().zoom ?? 0, [engine])
  )
  return <p className="map-hint">Now at z{zoom.toFixed(1)}</p>
}

interface MapEditorPanelProps {
  engine: MapEngine | null
  meta: ProjectMeta
  levelId: string | null
}

export function MapEditorPanel({ engine, meta, levelId }: MapEditorPanelProps) {
  const editing = useMapStore(s => s.editing)
  const draft = useMapStore(s => s.draft)
  const editTool = useMapStore(s => s.editTool)
  const selectedId = useMapStore(s => s.selectedId)
  const beginEdit = useMapStore(s => s.beginEdit)
  const endEdit = useMapStore(s => s.endEdit)
  const updateDraft = useMapStore(s => s.updateDraft)
  const setEditTool = useMapStore(s => s.setEditTool)
  const select = useMapStore(s => s.select)

  const saveMapConfig = useProjectStore(s => s.saveMapConfig)
  const setDirty = useProjectStore(s => s.setDirty)

  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirtyRef = useRef(false)

  const patchDraft = useCallback((fn: (config: MapConfig) => MapConfig) => {
    updateDraft(fn)
    if (!dirtyRef.current) {
      dirtyRef.current = true
      setDirty(true)
    }
    setSaved(false)
  }, [updateDraft, setDirty])

  const start = () => {
    beginEdit(meta.mapConfig ?? emptyMapConfig())
    setOpen(true)
  }

  const finish = async () => {
    if (!draft) return
    setSaving(true)
    await saveMapConfig(draft)
    setSaving(false)
    dirtyRef.current = false
    setSaved(true)
    endEdit()
  }

  const discard = () => {
    dirtyRef.current = false
    setDirty(false)
    endEdit()
    setConfirmDelete(null)
  }

  const config = draft
  const currentZoom = () => Math.round((engine?.getState().zoom ?? 12) * 10) / 10
  const zoomLocked =
    config?.minZoom !== undefined && config.minZoom === config.maxZoom

  const toggleZoomLock = (on: boolean) => {
    const zoom = currentZoom()
    patchDraft(d => setZoomLimits(d, on
      ? { minZoom: zoom, maxZoom: zoom }
      : { minZoom: undefined, maxZoom: undefined }))
  }

  const selected = findLocation(config?.locations, selectedId)
  const siblings = childrenOf(config?.locations, levelId)

  const captureView = () => {
    if (!engine) return
    const state = engine.getState()
    const camera = { center: state.center, zoom: state.zoom, bearing: state.bearing, pitch: state.pitch }
    if (selected) patchDraft(d => updateLocation(d, selected.id, { view: camera }))
    else patchDraft(d => setCamera(d, camera))
    setSaved(false)
  }

  if (!editing) {
    return (
      <div className="map-editor">
        <button className="map-editor-tab" onClick={start}>Edit map</button>
      </div>
    )
  }

  return (
    <div className={`map-editor ${open ? 'open' : ''}`}>
      <button className="map-editor-tab" onClick={() => setOpen(o => !o)}>
        {open ? 'Hide' : 'Edit map'}
      </button>

      <div className="map-editor-body">
        <div className="map-section-title">
          {selected ? 'Location' : levelId ? 'This level' : 'Map'}
        </div>

        <button className="map-ghost-btn" onClick={captureView}>
          {selected ? 'Use current view for this pin' : 'Use current view as start'}
        </button>

        {!selected && (
          <>
            <div className="map-section-title">Zoom limits</div>
            <label className="map-check">
              <input type="checkbox" checked={zoomLocked} onChange={e => toggleZoomLock(e.target.checked)} />
              Lock zoom at the current level
            </label>
            <div className="map-row">
              <div className="map-field">
                <label className="map-label" htmlFor="map-zoom-out">Zoom out limit</label>
                <input
                  id="map-zoom-out"
                  className="map-input map-input-mono"
                  type="number" step="0.1" placeholder="auto"
                  value={config?.minZoom ?? ''}
                  onChange={e => patchDraft(d => setZoomLimits(d, { minZoom: parseLimit(e.target.value) }))}
                />
              </div>
              <div className="map-field">
                <label className="map-label" htmlFor="map-zoom-in">Zoom in limit</label>
                <input
                  id="map-zoom-in"
                  className="map-input map-input-mono"
                  type="number" step="0.1" placeholder="18.4"
                  value={config?.maxZoom ?? ''}
                  onChange={e => patchDraft(d => setZoomLimits(d, { maxZoom: parseLimit(e.target.value) }))}
                />
              </div>
            </div>
            <div className="map-row">
              <button className="map-ghost-btn" onClick={() => patchDraft(d => setZoomLimits(d, { minZoom: currentZoom() }))}>
                Set out here
              </button>
              <button className="map-ghost-btn" onClick={() => patchDraft(d => setZoomLimits(d, { maxZoom: currentZoom() }))}>
                Set in here
              </button>
              <button
                className="map-ghost-btn"
                onClick={() => patchDraft(d => setZoomLimits(d, { minZoom: undefined, maxZoom: undefined }))}
              >
                Clear
              </button>
            </div>
            <ZoomReadout engine={engine} />

            <div className="map-section-title">Locations here</div>
            <button
              className={`map-ghost-btn ${editTool === 'pin' ? 'active' : ''}`}
              onClick={() => setEditTool(editTool === 'pin' ? 'none' : 'pin')}
            >
              {editTool === 'pin' ? 'Click the map to place…' : '+ Add location'}
            </button>

            <div className="map-list">
              {siblings.map(location => (
                <div
                  key={location.id}
                  className="map-list-row"
                  onClick={() => select(location.id)}
                >
                  <span className="map-list-row-name">{location.name}</span>
                  <span className="map-list-row-meta">
                    {childrenOf(config?.locations, location.id).length
                      ? `${childrenOf(config?.locations, location.id).length} sub`
                      : `${location.modelIds?.length ?? 0} mdl`}
                  </span>
                </div>
              ))}
              {!siblings.length && <p className="map-hint">Nothing here yet.</p>}
            </div>
          </>
        )}

        {selected && config && (
          <>
            <div className="map-field">
              <label className="map-label" htmlFor="map-loc-name">Name</label>
              <input
                id="map-loc-name"
                className="map-input"
                value={selected.name}
                onChange={e => patchDraft(d => updateLocation(d, selected.id, { name: e.target.value }))}
              />
            </div>

            <div className="map-field">
              <label className="map-label" htmlFor="map-loc-desc">Description</label>
              <textarea
                id="map-loc-desc"
                className="map-textarea"
                rows={3}
                value={selected.description ?? ''}
                onChange={e => patchDraft(d => updateLocation(d, selected.id, { description: e.target.value }))}
              />
            </div>

            <div className="map-row">
              <div className="map-field">
                <label className="map-label" htmlFor="map-loc-lon">Longitude</label>
                <input
                  id="map-loc-lon"
                  className="map-input map-input-mono"
                  value={selected.position[0]}
                  onChange={e => {
                    const lon = Number(e.target.value)
                    if (Number.isFinite(lon)) {
                      patchDraft(d => updateLocation(d, selected.id, { position: [lon, selected.position[1]] }))
                    }
                  }}
                />
              </div>
              <div className="map-field">
                <label className="map-label" htmlFor="map-loc-lat">Latitude</label>
                <input
                  id="map-loc-lat"
                  className="map-input map-input-mono"
                  value={selected.position[1]}
                  onChange={e => {
                    const lat = Number(e.target.value)
                    if (Number.isFinite(lat)) {
                      patchDraft(d => updateLocation(d, selected.id, { position: [selected.position[0], lat] }))
                    }
                  }}
                />
              </div>
            </div>

            <div className="map-section-title">Models ({selected.modelIds?.length ?? 0})</div>
            <div className="map-list">
              {meta.models.map(model => {
                const checked = selected.modelIds?.includes(model.modelId) ?? false
                const alsoIn = (config.locations ?? [])
                  .filter(l => l.id !== selected.id && l.modelIds?.includes(model.modelId))
                  .map(l => l.name)
                return (
                  <label className="map-list-row" key={model.modelId}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => {
                        const next = new Set(selected.modelIds ?? [])
                        if (e.target.checked) next.add(model.modelId)
                        else next.delete(model.modelId)
                        patchDraft(d => updateLocation(d, selected.id, { modelIds: [...next] }))
                      }}
                    />
                    <span className="map-list-row-name" title={model.originalFileName}>
                      {model.originalFileName}
                    </span>
                    {!!alsoIn.length && (
                      <span className="map-list-row-meta" title={`also in: ${alsoIn.join(', ')}`}>
                        +{alsoIn.length}
                      </span>
                    )}
                  </label>
                )
              })}
              {!meta.models.length && <p className="map-hint">This project has no models yet.</p>}
            </div>

            <p className="map-hint">
              A location with sub-locations becomes a level; one with models opens the 3D viewer.
            </p>

            {confirmDelete === selected.id ? (
              <div className="map-row">
                <button
                  className="map-ghost-btn"
                  onClick={() => {
                    patchDraft(d => removeLocation(d, selected.id))
                    select(null)
                    setConfirmDelete(null)
                  }}
                >
                  Delete + contents
                </button>
                <button className="map-ghost-btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              </div>
            ) : (
              <button className="map-ghost-btn" onClick={() => setConfirmDelete(selected.id)}>
                Remove location
              </button>
            )}

            <button className="map-ghost-btn" onClick={() => select(null)}>Back to level</button>
          </>
        )}

        {SHOW_RENDER_EDITOR && (
          <MapOverlayEditor engine={engine} meta={meta} levelId={levelId} patchDraft={patchDraft} />
        )}

        <div className="map-row" style={{ marginTop: 'auto' }}>
          <button className="map-cta" onClick={finish} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save map'}
          </button>
          <button className="map-ghost-btn" onClick={discard}>Discard</button>
        </div>
      </div>
    </div>
  )
}
