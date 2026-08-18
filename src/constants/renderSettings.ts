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

/** Every knob the render panel owns, and the look the viewer had before it was tunable */
export const RENDER_DEFAULTS = {
  realisticMode: false,
  renderLite: false,
  gridVisible: false,

  // Gradient sky — CanvasTexture applied to scene.background (integrates with tone mapping)
  // Defaults to Autodesk BIM 360 standard look
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
  progressiveRendering: true,  // Pause AO + edges while camera is moving (Autodesk-style)
  ambientOcclusion: false,
  aoRadius: 0.15,
  aoIntensity: 0.5,
  outlineEdges: false,
  ssrEnabled: false,

  pbrMaterials: true,
}

export type RenderSettings = typeof RENDER_DEFAULTS

export const RENDER_SETTING_KEYS = Object.keys(RENDER_DEFAULTS) as (keyof RenderSettings)[]

export function pickRenderSettings(source: RenderSettings): RenderSettings {
  return Object.fromEntries(RENDER_SETTING_KEYS.map(key => [key, source[key]])) as RenderSettings
}
