import { roundLngLat } from '@/lib/geo'
import { newId, subtreeIds, wouldCycle } from '@/lib/mapConfig'
import type { LngLat, MapConfig, MapLocation, MapOverlay } from '@/types'

/** Pure edits on a MapConfig draft. Every one returns a new config so the store's
 *  one-level spread stays the only mutation idiom in the app. */

export function addLocation(config: MapConfig, position: LngLat, parentId: string | null): MapConfig {
  const siblings = (config.locations ?? []).filter(l => (l.parentId ?? null) === parentId)
  const location: MapLocation = {
    id: newId('loc'),
    name: `Location ${siblings.length + 1}`,
    position: roundLngLat(position),
    kind: 'pin',
    modelIds: [],
    ...(parentId ? { parentId } : {}),
  }
  return { ...config, locations: [...(config.locations ?? []), location] }
}

export function updateLocation(config: MapConfig, id: string, patch: Partial<MapLocation>): MapConfig {
  if (patch.parentId !== undefined && wouldCycle(config.locations, id, patch.parentId)) return config
  return {
    ...config,
    locations: (config.locations ?? []).map(l => {
      if (l.id !== id) return l
      const next = { ...l, ...patch }
      if (patch.position) next.position = roundLngLat(patch.position)
      return next
    }),
  }
}

/** Removing a node takes its whole subtree — a breadcrumb into nothing is worse than a gap */
export function removeLocation(config: MapConfig, id: string): MapConfig {
  const doomed = subtreeIds(config.locations, id)
  return {
    ...config,
    locations: (config.locations ?? []).filter(l => !doomed.has(l.id)),
    overlays: (config.overlays ?? []).filter(o => !o.parentId || !doomed.has(o.parentId)),
  }
}

export function addOverlay(config: MapConfig, overlay: MapOverlay): MapConfig {
  return { ...config, overlays: [...(config.overlays ?? []), overlay] }
}

export function updateOverlay(config: MapConfig, id: string, patch: Partial<MapOverlay>): MapConfig {
  return {
    ...config,
    overlays: (config.overlays ?? []).map(o => (o.id === id ? { ...o, ...patch } : o)),
  }
}

export function removeOverlay(config: MapConfig, id: string): MapConfig {
  return { ...config, overlays: (config.overlays ?? []).filter(o => o.id !== id) }
}

export const setCamera = (config: MapConfig, camera: MapConfig['camera']): MapConfig =>
  ({ ...config, camera })

/** An absent limit means "auto", so clearing one deletes the key rather than storing undefined */
export function setZoomLimits(config: MapConfig, limits: { minZoom?: number; maxZoom?: number }): MapConfig {
  const next: MapConfig = { ...config }
  for (const key of ['minZoom', 'maxZoom'] as const) {
    if (!(key in limits)) continue
    const value = limits[key]
    if (value === undefined || Number.isNaN(value)) delete next[key]
    else next[key] = value
  }
  return next
}

export const setBasemap = (config: MapConfig, basemap: MapConfig['basemap']): MapConfig =>
  ({ ...config, basemap })
