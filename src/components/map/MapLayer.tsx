import { Suspense, lazy, useCallback, useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useProjectStore } from '@/store/useProjectStore'
import { useModelStore } from '@/store/useModelStore'
import { useMapStore } from '@/store/useMapStore'
import { useLoadingProgressStore } from '@/store/useLoadingProgressStore'
import { loadModelSet } from '@/lib/projectLoad'
import { unloadAllModels } from '@/lib/sceneTeardown'
import { liveModelIds } from '@/lib/mapConfig'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import type { MapLocation } from '@/types'

const MapView = lazy(() =>
  import('@/components/map/MapView').then(m => ({ default: m.MapView }))
)

interface MapLayerProps {
  adminMode: boolean
  engineRef: React.MutableRefObject<FragmentsEngine | null>
}

/** The 3D world keeps rendering its full composer chain even when hidden, so it is paused
 *  while the map is up and resumed on the way into the viewer. */
function setWorldEnabled(engine: FragmentsEngine | null, enabled: boolean) {
  const world = engine?.world
  if (world) world.enabled = enabled
}

export function MapLayer({ adminMode, engineRef }: MapLayerProps) {
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
    const handle = useProjectStore.getState().folderHandle
    if (!meta || !handle) return

    const modelIds = liveModelIds(meta, location)
    if (!modelIds.length) return

    setPhase('loading')
    setActiveLocationId(location.id)
    setWorldEnabled(engineRef.current, true)
    setStep('viewing')

    try {
      await loadModelSet(engineRef.current, handle, meta, modelIds)
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

  if (!onMap || !currentProject) return null

  return (
    <Suspense fallback={<div className="map-layer" />}>
      <MapView
        meta={currentProject}
        folderHandle={folderHandle}
        adminMode={adminMode}
        onOpenLocation={openLocation}
        onExit={exitToProjects}
      />
    </Suspense>
  )
}
