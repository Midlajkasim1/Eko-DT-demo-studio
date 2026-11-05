export type ToneMappingId = 'none' | 'linear' | 'reinhard' | 'cineon' | 'aces' | 'agx' | 'neutral'

export const TONE_MAPPING_OPTIONS: { value: ToneMappingId; label: string }[] = [
  { value: 'aces', label: 'ACES Filmic' },
  { value: 'agx', label: 'AgX' },
  { value: 'neutral', label: 'Khronos Neutral' },
  { value: 'reinhard', label: 'Reinhard' },
  { value: 'cineon', label: 'Cineon' },
  { value: 'linear', label: 'Linear' },
  { value: 'none', label: 'None' },
]

export const SHADOW_MAP_SIZES = [1024, 2048, 4096, 8192]

export const TEMPLATE_IDS = ['default', 'photoreal', 'minimal', 'studio', 'xray', 'monochrome'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

/** What the Studio style can turn on and tune. Exported inside renderSettings. */
export interface StudioAdjust {
  shadows: boolean
  softShadows: boolean
  /** PCF shadow radius for the Studio sun. */
  shadowRadius: number
  ambientOcclusion: boolean
  /** GTAO radius in world units. */
  aoRadius: number
  aoIntensity: number
  edges: boolean
  edgeStrength: number
  sunIntensity: number
  ambient: number
  exposure: number
}

export const STUDIO_ADJUST_DEFAULTS: StudioAdjust = {
  shadows: true,
  softShadows: true,
  shadowRadius: 4,
  ambientOcclusion: true,
  aoRadius: 1.8,
  aoIntensity: 0.55,
  edges: true,
  edgeStrength: 0.25,
  sunIntensity: 1.65,
  ambient: 0.4,
  exposure: 1,
}

/** Fills any key a saved project left out, so older files still open on the Studio look. */
export function studioAdjustOf(source: Partial<StudioAdjust> | null | undefined): StudioAdjust {
  const next = { ...STUDIO_ADJUST_DEFAULTS }
  if (!source) return next
  for (const key of Object.keys(STUDIO_ADJUST_DEFAULTS) as (keyof StudioAdjust)[]) {
    const value = source[key]
    if (value !== undefined) next[key] = value as never
  }
  return next
}

export const RENDER_DEFAULTS = {
  templateId: 'default' as TemplateId,
  templateSwitcher: true,

  realisticMode: false,
  renderLite: false,
  gridVisible: false,

  gradientSkyEnabled: true,
  gradientSkyTop: '#c8e2f3',
  gradientSkyBottom: '#c4b59c',

  exposure: 0.85,
  toneMapping: 'aces' as ToneMappingId,
  lightIntensity: 1.2,
  ambientIntensity: 0.3,
  timeOfDay: 14.5,

  iblEnabled: true,
  syncIblWithSun: true,
  envIntensity: 1.0,
  envRotation: 0,

  skyboxEnabled: true,
  skyTurbidity: 5.0,
  skyRayleigh: 2.0,
  skyMieCoefficient: 0.005,
  skyMieDirectionalG: 0.98,

  xrayColor: 'blue' as 'blue' | 'yellow' | 'white',

  cloudsEnabled: true,
  cloudDensity: 0.5,
  cloudSpeed: 1.0,
  cloudColor: '#ffffff',
  cloudShadowsEnabled: true,

  shadowsEnabled: true,
  softShadows: false,
  shadowMapSize: 4096,

  fogEnabled: true,
  fogDensity: 0.00015,
  fogColor: '#88aacc',

  bloomEnabled: false,
  bloomStrength: 0.15,
  bloomRadius: 0.4,
  bloomThreshold: 1.5,

  godRaysEnabled: false,
  godRayStrength: 0.8,

  dofEnabled: false,
  autoFocus: false,
  dofFocus: 2000.0,
  dofAperture: 0.0001,
  dofMaxBlur: 0.01,

  visualSaturation: 1.0,
  visualTemperature: 6500.0,
  visualContrast: 1.0,
  visualVignette: 0.4,
  chromaticAberration: 0.0,

  antialiasing: true,
  progressiveRendering: true, 
  ambientOcclusion: false,
  aoRadius: 50.0,
  aoIntensity: 1.0,
  outlineEdges: false,
  ssrEnabled: false,

  pbrMaterials: true,

  /**
   * Adjustments for the Studio dashboard style only.
   * Kept apart from shadowsEnabled / aoRadius: those belong to Advanced Rendering
   * and Render Lite, and their AO radius is in different units (N8AO, default 50).
   */
  studioAdjust: { ...STUDIO_ADJUST_DEFAULTS },
}

export type RenderSettings = typeof RENDER_DEFAULTS

/**
 * The template a project opens on: the one it saved, or Basic when it saved none (settings from before templates
 * existed) or one this build does not know. Studio is chosen per project, never filled in here.
 */
export function savedTemplateId(saved: { templateId?: TemplateId } | null | undefined): TemplateId {
  const id = saved?.templateId
  return id && TEMPLATE_IDS.includes(id) ? id : RENDER_DEFAULTS.templateId
}

export const RENDER_SETTING_KEYS = Object.keys(RENDER_DEFAULTS) as (keyof RenderSettings)[]

export function pickRenderSettings(source: RenderSettings): RenderSettings {
  return Object.fromEntries(RENDER_SETTING_KEYS.map(key => [key, source[key]])) as RenderSettings
}
