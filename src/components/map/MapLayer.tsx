import { Suspense, lazy, useCallback, useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useProjectStore } from '@/store/useProjectStore'
import { useModelStore } from '@/store/useModelStore'
import { useMapStore } from '@/store/useMapStore'
import { useLoadingProgressStore } from '@/store/useLoadingProgressStore'
import { loadHttpModelSet, loadModelSet } from '@/lib/projectLoad'
import { unloadAllModels } from '@/lib/sceneTeardown'
import { hasMap, liveModelIds } from '@/lib/mapConfig'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import type { MapLocation } from '@/types'

const MapView = lazy(() =>
  import('@/components/map/MapView').then(m => ({ default: m.MapView }))
)

interface MapLayerProps {
  adminMode: boolean
  engineRef: React.MutableRefObject<FragmentsEngine | null>
  /** Studio has a project list; the exported viewer does not */
  showProjectExit?: boolean
}

/** The 3D world keeps rendering its full composer chain even when hidden, so it is paused
 *  while the map is up and resumed on the way into the viewer. */
function setWorldEnabled(engine: FragmentsEngine | null, enabled: boolean) {
  const world = engine?.world
  if (world) world.enabled = enabled
}

export function MapLayer({ adminMode, engineRef, showProjectExit = true }: MapLayerProps) {
  const step = useAppStore(s => s.step)
  const setStep = useAppStore(s => s.setStep)
  const currentProject = useProjectStore(s => s.currentProject)
  const folderHandle = useProjectStore(s => s.folderHandle)

  const setPhase = useMapStore(s => s.setPhase)
  const setActiveLocationId = useMapStore(s => s.setActiveLocationId)

  const onMap = step === 'map'

  useEffect(() => {
    setWorldEnabled(engineRef.current, !onMap)
  }, [onMap, engineRef])

  const openLocation = useCallback(async (location: MapLocation) => {
    const meta = useProjectStore.getState().currentProject
    if (!meta) return

    const modelIds = liveModelIds(meta, location)
    if (!modelIds.length) return

    setPhase('loading')
    setActiveLocationId(location.id)
    setWorldEnabled(engineRef.current, true)
    setStep('viewing')

    try {
      const handle = useProjectStore.getState().folderHandle
      if (handle) {
        await loadModelSet(engineRef.current, handle, meta, modelIds)
      } else {
        await loadHttpModelSet(engineRef.current, meta, modelIds)
      }
    } finally {
      setPhase('idle')
    }

    history.pushState({ locationId: location.id }, '', `#${location.id}`)
  }, [engineRef, setPhase, setActiveLocationId, setStep])

  const returnToMap = useCallback(async () => {
    setPhase('leaving')
    useLoadingProgressStore.getState().endSession()
    await unloadAllModels(engineRef.current)
    useModelStore.getState().clearModels()
    useModelStore.getState().setActiveModelId(null)
    setWorldEnabled(engineRef.current, false)
    setStep('map')
    setPhase('idle')

    const id = useMapStore.getState().activeLocationId
    useMapStore.getState().select(id)
    requestAnimationFrame(() => {
      if (id) document.getElementById(`map-pin-${id}`)?.focus()
    })
  }, [engineRef, setPhase, setStep])

  useEffect(() => {
    ;(window as never as { __returnToMap?: () => void }).__returnToMap = returnToMap
    const onPopState = () => {
      if (useAppStore.getState().step === 'viewing' && useProjectStore.getState().currentProject?.mapConfig) {
        void returnToMap()
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      delete (window as never as { __returnToMap?: () => void }).__returnToMap
    }
  }, [returnToMap])

  const exitToProjects = useCallback(() => {
    useModelStore.getState().clearModels()
    useMapStore.getState().reset()
    setWorldEnabled(engineRef.current, true)
    useProjectStore.getState().closeProject()
    setStep('projects')
  }, [engineRef, setStep])

  if (step === 'viewing' && !adminMode && hasMap(currentProject)) {
    return (
      <button
        type="button"
        className="viewer-map-back"
        onClick={() => void returnToMap()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15" aria-hidden="true">
          <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z" strokeLinejoin="round" />
          <path d="M9 4v13M15 6.5v13" strokeLinejoin="round" />
        </svg>
        Back to map
      </button>
    )
  }

  if (!onMap || !currentProject) return null

  return (
    <Suspense fallback={<div className="map-layer" />}>
      <MapView
        meta={currentProject}
        folderHandle={folderHandle}
        adminMode={adminMode}
        onOpenLocation={openLocation}
        onExit={showProjectExit ? exitToProjects : undefined}
      />
    </Suspense>
  )
}
