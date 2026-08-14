import { DUBAI } from './dubai'
import type { MapRegion } from './types'
import type { MapOverlay } from '@/types'

/** Add a region here and drop its renders in public/map/regions/<id>/ — nothing else changes. */
export const REGIONS: MapRegion[] = [DUBAI]

export const BUILTIN_RENDERS: MapOverlay[] = REGIONS.flatMap(region => region.renders)

export const findRegion = (id: string) => REGIONS.find(region => region.id === id) ?? null

export type { MapRegion }
export { BUILTIN_PREFIX, BUILTIN_RENDERS_DIR, builtinHash } from './paths'
