import { useCallback, useEffect, useMemo, useRef } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@/styles/map.css'
import { useMapEngine } from '@/hooks/useMapEngine'
import { useMapStore } from '@/store/useMapStore'
import { createAssetResolver } from '@/lib/mapAssets'
import { addLocation, updateLocation } from '@/lib/mapDraft'
import {
  childrenOf, findLocation, hasChildren, liveModelIds, pathTo, starterMapConfig, withBuiltinRenders,
} from '@/lib/mapConfig'
import { MapBreadcrumb } from '@/components/map/MapBreadcrumb'
import { MapControls } from '@/components/map/MapControls'
import { MapLocationPanel } from '@/components/map/MapLocationPanel'
import { MapLoadProgress } from '@/components/map/MapLoadProgress'
import { MapEditorPanel } from '@/components/map/MapEditorPanel'
import type { MapLocation, ProjectMeta } from '@/types'

interface MapViewProps {
  meta: ProjectMeta
  folderHandle: FileSystemDirectoryHandle | null
  adminMode: boolean
  onOpenLocation: (location: MapLocation) => void
  onExit: () => void
}

export function MapView({ meta, folderHandle, adminMode, onOpenLocation, onExit }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const path = useMapStore(s => s.path)
  const selectedId = useMapStore(s => s.selectedId)
  const phase = useMapStore(s => s.phase)
  const editing = useMapStore(s => s.editing)
  const draft = useMapStore(s => s.draft)
  const editTool = useMapStore(s => s.editTool)
  const select = useMapStore(s => s.select)
  const enterLevel = useMapStore(s => s.enterLevel)
  const setPath = useMapStore(s => s.setPath)

  const updateDraft = useMapStore(s => s.updateDraft)
  const setEditTool = useMapStore(s => s.setEditTool)

  // A project being given its first map has nothing saved yet, so the starter config renders
  const config = useMemo(
    () => withBuiltinRenders((editing && draft) || meta.mapConfig || starterMapConfig()),
    [editing, draft, meta.mapConfig]
  )
  const locations = config.locations
  const levelId = path.length ? path[path.length - 1] : null
  const resolveAsset = useMemo(
    () => createAssetResolver(meta, folderHandle),
    [meta, folderHandle]
  )

  const engineOptions = useMemo(
    () => ({ config, levelId, resolveAsset }),
    [config, levelId, resolveAsset]
  )

  const handleSelect = useCallback((location: MapLocation) => {
    select(location.id)
  }, [select])

  const handleEnter = useCallback((location: MapLocation) => {
    if (hasChildren(locations, location.id)) enterLevel(location.id)
  }, [locations, enterLevel])

  /** Models win the double click; a pin with none falls back to going in, so it always does something */
  const handleOpen = useCallback((location: MapLocation) => {
    if (liveModelIds(meta, location).length) onOpenLocation(location)
    else if (hasChildren(locations, location.id)) enterLevel(location.id)
  }, [locations, meta, enterLevel, onOpenLocation])

  const handleMapClick = useCallback((lngLat: [number, number]) => {
    if (editTool === 'pin') {
      updateDraft(d => addLocation(d, lngLat, levelId))
      setEditTool('none')
      return
    }
    select(null)
  }, [editTool, levelId, select, updateDraft, setEditTool])

  const handleMoved = useCallback((id: string, lngLat: [number, number]) => {
    updateDraft(d => updateLocation(d, id, { position: lngLat }))
  }, [updateDraft])

  const { engine } = useMapEngine(containerRef, engineOptions, {
    onSelectLocation: handleSelect,
    onEnterLocation: handleEnter,
    onOpenLocation: handleOpen,
    onMapClick: handleMapClick,
    onLocationMoved: handleMoved,
  })

  useEffect(() => {
    engine?.setDraggable(editing && editTool === 'none')
  }, [engine, editing, editTool])

  useEffect(() => {
    engine?.setSelected(selectedId)
  }, [engine, selectedId])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as never as { __mapEngineForTest?: unknown }).__mapEngineForTest = engine?.map
  }, [engine])

  // Only the main map flies on select: a level frames itself, and inside one the render already fills the screen
  const selectedEntersLevel = !!selectedId && hasChildren(locations, selectedId)
  useEffect(() => {
    if (!selectedId || levelId !== null || selectedEntersLevel) return
    engine?.flyToLocation(selectedId)
    // `locations` is deliberately not a dependency: renaming a pin would re-fly the camera
  }, [engine, selectedId, levelId, selectedEntersLevel])

  const selected = findLocation(locations, selectedId)
  const canExplore = !!selected && liveModelIds(meta, selected).length > 0

  const trail = useMemo(
    () => pathTo(locations, levelId).map(id => findLocation(locations, id)).filter(Boolean) as MapLocation[],
    [locations, levelId]
  )

  const handleGoTo = useCallback((id: string | null) => {
    setPath(id ? pathTo(locations, id) : [])
  }, [setPath, locations])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (useMapStore.getState().editTool !== 'none') {
        useMapStore.getState().setEditTool('none')
        return
      }
      if (useMapStore.getState().selectedId) {
        select(null)
        return
      }
      // Escape never leaves the map — stepping up a level is as far as it goes
      if (useMapStore.getState().path.length) useMapStore.getState().exitLevel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [select])

  const levelLocations = childrenOf(locations, levelId)

  return (
    <div
      className={`map-layer ${phase === 'leaving' ? 'map-layer--leaving' : ''}`}
      role="application"
      aria-label="Project location map"
    >
      <div ref={containerRef} className="map-canvas" />

      <header className="map-topbar">
        <MapBreadcrumb projectName={meta.name} trail={trail} onGoTo={handleGoTo} />
        <div className="map-spacer" />
        <button className="map-pill" onClick={onExit}>Back to projects</button>
      </header>

      <MapControls engine={engine} />

      {selected && (
        <MapLocationPanel
          location={selected}
          childCount={childrenOf(locations, selected.id).length}
          canExplore={canExplore}
          busy={phase === 'loading'}
          onExplore={() => onOpenLocation(selected)}
          onClose={() => select(null)}
        />
      )}

      {adminMode && <MapEditorPanel engine={engine} meta={meta} levelId={levelId} />}

      {levelLocations.length === 0 && !editing && (
        <div className="map-empty">
          <p>No locations at this level{adminMode ? ' — open Edit map to add one.' : '.'}</p>
        </div>
      )}

      <MapLoadProgress />
    </div>
  )
}
