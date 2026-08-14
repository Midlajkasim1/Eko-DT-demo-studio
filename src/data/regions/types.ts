import type { MapCamera, MapOverlay } from '@/types'

/** One city, state or country's bundled render pyramid. Regions are geographically disjoint,
 *  so every registered region's renders can be mounted at once and zoom decides what shows. */
export interface MapRegion {
  id: string
  name: string
  country: string
  camera: MapCamera
  renders: MapOverlay[]
}
