import { useEffect, useRef, useState } from 'react'
import { createMapEngine } from '@/lib/mapEngine'
import type { MapEngine, MapEngineOptions } from '@/lib/mapEngine'

type Handlers = Pick<
  MapEngineOptions,
  'onSelectLocation' | 'onEnterLocation' | 'onOpenLocation' | 'onMapClick' | 'onLocationMoved'
>
type Options = Omit<MapEngineOptions, keyof Handlers>

/** Creates the map once per container and disposes it on unmount, mirroring useFragmentsEngine.
 *  Config, level and handler changes are pushed into the live map rather than rebuilding it. */
export function useMapEngine(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: Options | null,
  handlers: Handlers
) {
  const optionsRef = useRef(options)
  const handlersRef = useRef(handlers)
  const [engine, setEngine] = useState<MapEngine | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    optionsRef.current = options
    handlersRef.current = handlers
  })

  const enabled = !!options
  const config = options?.config
  const levelId = options?.levelId ?? null

  useEffect(() => {
    const container = containerRef.current
    const initial = optionsRef.current
    if (!container || !initial) return

    const created = createMapEngine(container, {
      ...initial,
      // Read fresh: a captured resolver cannot see assets imported after the map mounted
      resolveAsset: hash => optionsRef.current?.resolveAsset(hash) ?? Promise.resolve(null),
      onSelectLocation: location => handlersRef.current.onSelectLocation?.(location),
      onEnterLocation: location => handlersRef.current.onEnterLocation?.(location),
      onOpenLocation: location => handlersRef.current.onOpenLocation?.(location),
      onMapClick: lngLat => handlersRef.current.onMapClick?.(lngLat),
      onLocationMoved: (id, lngLat) => handlersRef.current.onLocationMoved?.(id, lngLat),
    })
    setEngine(created)

    const unsubscribe = created.subscribe(state => setReady(state.ready))

    return () => {
      unsubscribe()
      created.dispose()
      setEngine(null)
      setReady(false)
    }
  }, [containerRef, enabled])

  useEffect(() => {
    if (engine && config) void engine.setConfig(config)
  }, [engine, config])

  useEffect(() => {
    engine?.setLevel(levelId)
  }, [engine, levelId])

  return { engine, ready }
}
