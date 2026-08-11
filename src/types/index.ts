import type { RenderSettings } from '@/constants/renderSettings'

export type AppStep =
  | 'projects'
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
  /** Attached from thumbnail.webp on open, and persisted back by saveProjectMeta */
  thumbnail?: string
}

/** Everything the project list renders, so opening it never parses project.json */
export interface RecentProjectCard {
  projectId: string
  name: string
  modelCount: number
  updatedAt: number
  isFinProject?: boolean
  thumbnail?: string
}

export interface ProjectApiSettings {
  finBaseUrl?: string
  finProjectName?: string
  finInterval?: number
  finDirectMode?: boolean
  finLivePoints?: Record<string, string>
  finEndpoints?: Record<string, string>
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
}

export interface ProjectModel extends ProjectModelEntry {
  fragBytes: ArrayBuffer
}
