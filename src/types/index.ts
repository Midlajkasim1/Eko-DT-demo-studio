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
 * CCTV links set `kind: 'cctv'` and the camera's space in `room`.
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
  kind?: 'equip' | 'space' | 'cctv'
  /** IFC GlobalId of the saved space a CCTV camera is in */
  room?: string
  /** Storey of a space */
  level?: string
  /** A camera's demo clip (V1–V7) or 'none'; absent: the clip in order */
  clip?: string
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
  /** People drawn on the occupancy tab. Absent is 80. Capped at 400. */
  people?: number
  /** How fast those people walk. 1 is a stroll. Absent is 1. */
  speed?: number
  /**
   * People stand still except in rooms whose name matches walkRooms.
   * Absent is on. Set false and everyone walks, still inside their own room.
   */
  stillRooms?: boolean
  /**
   * Room-name words where people walk, matched inside the room label.
   * Absent is corridor, circulation, public area, lobby, waiting, and lounge.
   * An empty list means nobody walks while stillRooms is on.
   */
  walkRooms?: string[]
}

/** One O&M or warranty PDF. `ref` is the FIN record, "@p:project:r:id". */
export interface FinManual {
  name: string
  nameAr?: string
  ref: string
}

/** Equipment that share one O&M manual and one warranty. Match words are the same ones
 *  om-warranty.json uses: tags, codes in the asset id, and words in the type or the id. */
export interface FinDocumentFamily {
  id: string
  /** The name typed in Dashboard Settings. The id stays put when this is renamed. */
  label?: string
  tags: string[]
  codes: string[]
  types: string[]
  names: string[]
  om?: FinManual
  warranty?: FinManual
}

/** Per-project FIN settings live here. A field a project does not set falls back to the
 *  backend config.json default, so projects saved before a field existed keep working. */
export interface ProjectApiSettings {
  /** FIN_SETTINGS_VERSION at the last Save Settings; absent on projects saved before it existed */
  schemaVersion?: number
  /** IANA timezone of the site ("Asia/Dubai"): the day boundary for today's readings */
  siteTimezone?: string
  /** Show the sample data set's demo figures in the dashboard. Off: FIN readings and this project's
   *  own settings; with the medical set, its figures stay wherever the project maps no FIN data. */
  dashboardDemo?: boolean
  /** The sample data set: the dashboard's layout and its sample figures; absent = Marsa Al Arab. */
  dashboardSampleData?: 'medical'
  /** The dashboard's module set. 'extended' adds ESG, Maintenance, and Security and life safety; absent = standard. */
  dashboardModules?: 'extended'
  /** 'model': every CCTV element of the loaded model; absent: only linked FIN cameras */
  dashboardCameraSource?: 'model'
  /** Reporting basis. A cost or CO₂ figure whose rate is not set is reported as unavailable. */
  energyTariff?: number
  gasTariff?: number
  /** ISO 4217 code shown with every cost, e.g. "AED" */
  currency?: string
  /** Names the tariff in the report basis, e.g. "DEWA-C 2026-Q3" */
  tariffName?: string
  /** kg CO₂ per kWh */
  co2Factor?: number
  /** The hourly energy history also fills current load, the hourly chart, and the month totals. */
  energyFromHourly?: boolean
  /** Words in the FIN point name for the asset chart. Blank keeps return air and zone temp. */
  ahuTemp?: string
  ahuSetpoint?: string
  fcuTemp?: string
  fcuSetpoint?: string
  /** Which FIN points the dashboard may write. Absent uses the standard roles and names. */
  pointControl?: PointControlSettings
  /** Names the emission factor in the report basis, e.g. "DEWA grid 2025" */
  co2FactorName?: string
  /** The Power page's distribution boards. Absent: the built-in board keys, shown where the
   *  project maps them (Marsa Al Arab's six through config.json). Each board names Data Mapping
   *  keys, never a FIN point ID. */
  finPowerBoards?: PowerBoard[]
  /** The meters on Energy › Anomalies. Absent: every meter FIN reports. */
  finMeters?: MeterLink[]
  /** PMU measurement: Anomalies leads with every meter, not only the main ones */
  anomalyAllMeters?: boolean
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
  /** O&M and warranty manuals for this project. Saved: the dashboard uses this list and does not
   *  read om-warranty.json. Absent: that file stays the catalog for the site it belongs to. */
  finDocuments?: FinDocumentFamily[]
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

export type PointControlClass = 'fcu' | 'vav' | 'ahu' | 'fahu' | 'mahu'
export type PointControlRole = 'setpoint' | 'status' | 'output' | 'choice'

/** Per-project FIN write policy. A missing class keeps that equipment's standard roles.
 *  Name fields add to the standard names; they do not replace them. */
export interface PointControlSettings {
  /** Absent means on. */
  enabled?: boolean
  equipment?: Partial<Record<PointControlClass, PointControlRole[]>>
  /** Writable numbers that are not already named Sp or Setpoint. */
  setpoints?: string
  /** Writable on/off points to add, such as Occupancy. */
  statusPoints?: string
  /** Writable valve, damper, and speed commands to add. */
  outputPoints?: string
  /** Writable mode points to add. The point must have a FIN enum. */
  choicePoints?: string
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
  /** The board's own FIN point (p:{project}:r:…), polled under liveKey */
  point?: string
  /** The hisRead query for that point, read under historyKey */
  history?: string
}

export interface MeterLink {
  name: string
  equip: string
  /** Its energy point, p:{project}:r:… */
  point?: string
  history?: string
  main?: boolean
}

export interface ProjectModel extends ProjectModelEntry {
  fragBytes: ArrayBuffer
}
