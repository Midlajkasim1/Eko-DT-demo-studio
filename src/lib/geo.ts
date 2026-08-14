import type { GeoQuad, LngLat } from '@/types'

const EQUATOR_METERS = 40075016.685578488
/** The latitude where Web Mercator is clipped square */
export const MAX_LATITUDE = 85.0511287798066
export const TILE_SIZE = 256

/** The whole Web Mercator world — the z0 tile, so one image on these corners is the globe */
export const WORLD_QUAD: GeoQuad = [
  [-180, MAX_LATITUDE],
  [180, MAX_LATITUDE],
  [180, -MAX_LATITUDE],
  [-180, -MAX_LATITUDE],
]

const clampLat = (lat: number) => Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat))

export const metersPerPixel = (lat: number, zoom: number) =>
  (EQUATOR_METERS * Math.cos((clampLat(lat) * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom)

export const zoomForResolution = (lat: number, metersPerPx: number) =>
  Math.log2((EQUATOR_METERS * Math.cos((clampLat(lat) * Math.PI) / 180)) / (TILE_SIZE * metersPerPx))

export const lonToTileX = (lon: number, zoom: number) => ((lon + 180) / 360) * 2 ** zoom

export function latToTileY(lat: number, zoom: number) {
  const rad = (clampLat(lat) * Math.PI) / 180
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom
}

export const tileXToLon = (x: number, zoom: number) => (x / 2 ** zoom) * 360 - 180

export const tileYToLat = (y: number, zoom: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** zoom))) * 180) / Math.PI

/** Normalised mercator y in [0,1] */
export const mercatorY = (lat: number) => latToTileY(lat, 0)

export interface TileGrid {
  z: number
  x: number
  y: number
  w: number
  h: number
}

/** The tile rectangle an image of this pixel size covers when centred here at this zoom */
export function gridForImage(center: LngLat, zoom: number, widthPx: number, heightPx: number): TileGrid {
  const z = Math.round(zoom)
  const w = Math.max(1, Math.round(widthPx / TILE_SIZE))
  const h = Math.max(1, Math.round(heightPx / TILE_SIZE))
  return {
    z,
    w,
    h,
    x: Math.round(lonToTileX(center[0], z) - w / 2),
    y: Math.round(latToTileY(center[1], z) - h / 2),
  }
}

/** Snap an arbitrary box outwards to whole tiles at `zoom` */
export function snapBoundsToGrid(bounds: [LngLat, LngLat], zoom: number): TileGrid {
  const z = Math.round(zoom)
  const [[west, south], [east, north]] = bounds
  const x = Math.floor(lonToTileX(west, z))
  const y = Math.floor(latToTileY(north, z))
  return {
    z,
    x,
    y,
    w: Math.max(1, Math.ceil(lonToTileX(east, z)) - x),
    h: Math.max(1, Math.ceil(latToTileY(south, z)) - y),
  }
}

/** Corners in MapLibre ImageSource order: top-left, top-right, bottom-right, bottom-left */
export function gridToQuad({ z, x, y, w, h }: TileGrid): GeoQuad {
  const west = tileXToLon(x, z)
  const east = tileXToLon(x + w, z)
  const north = tileYToLat(y, z)
  const south = tileYToLat(y + h, z)
  return [[west, north], [east, north], [east, south], [west, south]]
}

export const gridPixelSize = ({ w, h }: TileGrid) => [w * TILE_SIZE, h * TILE_SIZE] as const

/** [sw, ne] of everything passed in */
export function quadUnion(quads: GeoQuad[]): [LngLat, LngLat] | null {
  if (!quads.length) return null
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  for (const quad of quads) {
    for (const [lon, lat] of quad) {
      if (lon < west) west = lon
      if (lon > east) east = lon
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
  }
  return [[west, south], [east, north]]
}

export function expandBounds([[west, south], [east, north]]: [LngLat, LngLat], ratio: number): [LngLat, LngLat] {
  const padX = (east - west) * ratio
  const padY = (north - south) * ratio
  return [
    [Math.max(-180, west - padX), Math.max(-MAX_LATITUDE, south - padY)],
    [Math.min(180, east + padX), Math.min(MAX_LATITUDE, north + padY)],
  ]
}

export function quadContains(quad: GeoQuad, lon: number, lat: number) {
  const bounds = quadUnion([quad])
  if (!bounds) return false
  const [[west, south], [east, north]] = bounds
  return lon >= west && lon <= east && lat >= south && lat <= north
}

/** Smallest zoom at which `bounds` still fills a viewport of this pixel size.
 *  MapLibre's world is 512·2^z px, so solve each axis and take the tighter one. */
export function minZoomToCover(bounds: [LngLat, LngLat], widthPx: number, heightPx: number) {
  const [[west, south], [east, north]] = bounds
  const spanLon = Math.max(1e-9, east - west)
  const spanY = Math.max(1e-9, Math.abs(mercatorY(north) - mercatorY(south)))
  return Math.max(
    Math.log2((360 * widthPx) / (512 * spanLon)),
    Math.log2(heightPx / (512 * spanY))
  )
}

export const roundLngLat = ([lon, lat]: LngLat): LngLat =>
  [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7]
