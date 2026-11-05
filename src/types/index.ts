import type { RenderSettings } from '@/constants/renderSettings'

export type AppStep =
  | 'projects'
  | 'map'
  | 'idle'
  | 'uploading'
  | 'converting'
  | 'viewing'
  | 'error'

export interface LoadedModel {
  modelId: string
  originalFileName: string
  originalFileSizeBytes: number
  convertedFileSizeBytes: number
  conversionTimeMs: number
  fragBytes: ArrayBuffer
  type?: 'frag' | 'glb'
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

export interface ConversionProgress {
  progress: number
  label: string
}

export interface ProjectModelEntry {
  modelId: string
  originalFileName: string
  originalFileSizeBytes: number
  convertedFileSizeBytes: number
  conversionTimeMs: number
  fragFile: string
  addedAt: number
  type?: 'frag' | 'glb'
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

export interface MaterialOverride {
  id: string
  modelId: string
  targetId: number | string // Fragment Item ID or category name
  targetType: 'item' | 'category'
  color?: string
  roughness?: number
  metalness?: number
  opacity?: number
  transparent?: boolean
  /** assetsVersion 1 only — the image inlined as a base64 data URL */
  textureDataUrl?: string
  textureHash?: string
  textureScale?: number
  /** Set when the target model was removed; kept for recovery, excluded from exports */
  orphanedAt?: number
}

/** A texture stored beside project.json at textures/<hash>.<ext> */
export interface TextureAsset {
  hash: string
  src: string
  mime: string
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  bytes: number
}


export interface ProjectCamera {
  position: [number, number, number]
  target: [number, number, number]
}

/** [longitude, latitude] — MapLibre's order, not the geolocation field's */
export type LngLat = [number, number]

/** top-left, top-right, bottom-right, bottom-left */
export type GeoQuad = [LngLat, LngLat, LngLat, LngLat]

export interface MapCamera {
  center: LngLat
  zoom: number
  bearing?: number
  pitch?: number
}

/** No layer resolves to the flat background colour, which is a valid offline map */
export type MapBasemap =
  | { kind: 'void' }
  | { kind: 'image'; hash: string; coordinates: GeoQuad }
  | { kind: 'xyz'; template: string; tileSize?: 256 | 512; maxzoom?: number; attribution?: string }
  | { kind: 'pack'; hash: string; minzoom?: number; maxzoom?: number }

export interface MapOverlay {
  id: string
  /** key into ProjectMeta.mapAssets */
  hash: string
  coordinates: GeoQuad
  fadeIn?: [number, number]
  fadeOut?: [number, number]
  opacity?: number
  /** the level this render belongs to; absent means the root level */
  parentId?: string
  /** the tile rectangle it was snapped to, so the snap can be re-derived */
  grid?: { z: number; x: number; y: number; w: number; h: number }
  hidden?: boolean
}

export interface MapLocation {
  id: string
  /** absent = top level; present = a child of that location's level */
  parentId?: string
  name: string
  position: LngLat
  description?: string
  color?: string
  category?: string
  /** place and road are non-interactive labels, not pins */
  kind?: 'pin' | 'place' | 'road'
  rotation?: number
  polygon?: LngLat[]
  /** loaded into the 3D viewer when this pin is opened */
  modelIds?: string[]
  /** where the map lands when entering this node */
  view?: MapCamera
  /** the 3D camera restored once this pin's models are in */
  camera?: ProjectCamera
  stats?: { label: string; value: string }[]
}

export interface MapConfig {
  version: 1
  camera: MapCamera
  minZoom?: number
  maxZoom?: number
  maxPitch?: number
  /** maxBounds padding as a fraction of the content span */
  padding?: number
  basemap: MapBasemap
  /** Set false to drop the bundled Dubai render pyramid, e.g. for a site somewhere else */
  builtinRenders?: boolean
  overlays?: MapOverlay[]
  locations?: MapLocation[]
  categories?: { id: string; label: string; color?: string }[]
  intro?: { enabled: boolean; pullBack: number; bearingOffset: number; duration: number }
}

/** A map image or tile pack stored beside project.json at mapassets/<hash>.<ext> */
export interface MapAsset {
  kind: 'image' | 'pack'
  hash: string
  src: string
  mime: string
  bytes: number
  width?: number
  height?: number
  sourceWidth?: number
  sourceHeight?: number
}

/** Projects written before a setting existed simply omit it, so the store default applies */
export type ProjectRenderSettings =
  Partial<RenderSettings> & Pick<RenderSettings, 'realisticMode'>

export interface ProjectMeta {
  version: number
  /** 2 once textures live in textures/ instead of inline data URLs. Emitted first
   *  so the migration state can be read from a short prefix of the file. */
  assetsVersion?: number
  textures?: Record<string, TextureAsset>
  projectId: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  models: ProjectModelEntry[]
  geolocation: {
    latitude: number
    longitude: number
    altitude: number
    rotation: number
  } | null
  camera?: ProjectCamera
  renderSettings?: ProjectRenderSettings
  isFinProject?: boolean
  apiSettings?: ProjectApiSettings
  materialOverrides?: Record<string, MaterialOverride>
  mapConfig?: MapConfig
  mapAssets?: Record<string, MapAsset>
  /** FIN equipment and heatmap spaces ↔ model elements, edited in Equipment & Spaces */
  assetLinks?: AssetLink[]
  /** Attached from thumbnail.webp on open, and persisted back by saveProjectMeta */
  thumbnail?: string
}

/**
 * One named thing and the model element it is drawn as.
 * Equipment links omit `kind`. Space links set `kind: 'space'` and use `equip` as the heatmap name.
 * Keyed on the IFC GlobalId, which a revised model keeps.
 */
export interface AssetLink {
  /** FIN equipment name, or the heatmap name of a space */
  equip: string
  /** FIN equipment record id, so a rename in FIN can be followed */
  finId?: string
  /** IFC GlobalId */
  guid: string
  /** Equipment type (FCU, AHU…) or SPACE. The type picks the schematic drawn inside equipment. */
  type: string
  /** The element's name when it was linked */
  element?: string
  /** Absent on equipment links saved before spaces existed */
  kind?: 'equip' | 'space'
}

/** Everything the project list renders, so opening it never parses project.json */
export interface RecentProjectCard {
  projectId: string
  name: string
  modelCount: number
  updatedAt: number
  isFinProject?: boolean
  hasMap?: boolean
  thumbnail?: string
}

/** Same shapes as the backend config.json blocks of the same name */
export interface FinEquipmentClasses {
  system_tags?: string[]
  meter_tags?: string[]
  type_priority?: string[]
}

export interface FinMeterProfile {
  prefix?: string
  point_map?: Record<string, string[]>
}

export interface FinSeverityBands {
  order?: 'asc' | 'desc'
  critical?: number
  warning?: number
}

/**
 * How this project's heatmap is drawn. Absent fields keep the Marsa behaviour:
 * top view, ground floor, nothing faded, colour filling the whole room height.
 */
export interface HeatmapSetup {
  /** top looks straight down. inside looks in from a high corner, under the ceiling. */
  camera?: 'top' | 'inside'
  /** The heatmap top-view camera. Other panels keep the project camera. Absent uses the automatic top look. */
  view?: ProjectCamera
  /** A storey id from the model, or ALL. Absent isolates Ground floor. */
  floor?: string
  /** File names to fade while the heatmap is open. Absent, or an empty list, fades nothing. */
  fadeModels?: string[]
  /** How solid a faded model stays, from 0.15 to 0.8. Absent is 0.35. */
  fadeAmount?: number
  /** Pull the colour in under the ceiling so it reads inside the walls. */
  insideWalls?: boolean
  /**
   * Sample readings for linked rooms that have no FIN value. The rooms share seven sensors.
   * Absent is on. Set false to colour only rooms named IS-01 or IAQ-02.
   * Marsa has no space links, so its rooms are never filled. A real FIN reading is kept.
   */
  sampleSpaces?: boolean
}

/** Per-project FIN settings live here. A field a project does not set falls back to the
 *  backend config.json default, so projects saved before a field existed keep working. */
export interface ProjectApiSettings {
  /** FIN_SETTINGS_VERSION at the last Save Settings; absent on projects saved before it existed */
  schemaVersion?: number
  /** IANA timezone of the site ("Asia/Dubai"): the day boundary for today's readings */
  siteTimezone?: string
  /** Show the prototype's demo figures (Marsa Al Arab fixture) in the dashboard. Off: only FIN
   *  readings and this project's own settings are shown. */
  dashboardDemo?: boolean
  /** The sample data set the demo figures come from; absent = Marsa Al Arab. Only used with dashboardDemo. */
  dashboardSampleData?: 'medical'
  /** The dashboard's module set. 'extended' adds ESG, Maintenance, and Security and life safety; absent = standard. */
  dashboardModules?: 'extended'
  /** Reporting basis. A cost or CO₂ figure whose rate is not set is reported as unavailable. */
  energyTariff?: number
  gasTariff?: number
  /** ISO 4217 code shown with every cost, e.g. "AED" */
  currency?: string
  /** Names the tariff in the report basis, e.g. "DEWA-C 2026-Q3" */
  tariffName?: string
  /** kg CO₂ per kWh */
  co2Factor?: number
  /** Names the emission factor in the report basis, e.g. "DEWA grid 2025" */
  co2FactorName?: string
  /** The Power page's distribution boards. Absent: the built-in board keys, shown where the
   *  project maps them (Marsa Al Arab's six through config.json). Each board names Data Mapping
   *  keys, never a FIN point ID. */
  finPowerBoards?: PowerBoard[]
  finBaseUrl?: string
  finProjectName?: string
  finDisplayName?: string
  finInterval?: number
  finDirectMode?: boolean
  finLivePoints?: Record<string, string>
  finEndpoints?: Record<string, string>
  finWorkorderExpr?: string
  /** This project's own gate for critical-alarm notifications; absent = not configured (never enabled by default) */
  notificationsCriticalAlarmsEnabled?: boolean
  finMeterProfile?: FinMeterProfile
  finSeverityBands?: FinSeverityBands
  finEquipmentClasses?: FinEquipmentClasses
  finRealtimeEndpoints?: Record<string, string>
  finRealtimeMs?: number
  weatherApiKey?: string
  weatherLat?: number
  weatherLon?: number

  // Dashboard Configuration
  navButtons?: Array<{ id: string, icon: string, tooltip: string, action: string, panel?: string, event?: string }>
  leftCards?: Array<{ id: string, label: string, icon: string, accent: string, source: string, format?: string, field?: string }>
  rightCards?: Array<{ id: string, label: string, icon: string, accent: string, source: string, format?: string, field?: string }>
  sideButtons?: Array<{ id: string, icon: string, label: string, action: string, dashboard: string, enabled?: boolean }>
  subPanels?: Record<string, { label: string, type: string }>
  modelsConfig?: Array<{ id: string, label: string, name: string, active: boolean }>
  floorsConfig?: Array<{ id: string, label: string, name: string }>
  /** Heatmap camera, floor, and which models fade. Absent keeps the Marsa heatmap. */
  heatmap?: HeatmapSetup
}

/** One distribution board on the Power page */
export interface PowerBoard {
  name: string
  /** A key of FIN Live Points Mapping (e.g. "mcc1"): the board's reading */
  liveKey: string
  /** A key of FIN Historical Endpoints (e.g. "Hourly_EC_MCC1_his"): its hourly energy */
  historyKey?: string
  /** The meter that feeds it, as the meter profile names it (e.g. "PMU09") */
  meter?: string
}

export interface ProjectModel extends ProjectModelEntry {
  fragBytes: ArrayBuffer
}
