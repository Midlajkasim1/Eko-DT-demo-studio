import { studioAdjustOf, type StudioAdjust, type TemplateId } from './renderSettings'
import { studioLocks } from './studioPalette'

export type SkyStop = [number, string]

export interface TemplateSurfaces {
  wash: number
  tint: string
  glow: number
  reflect: number
  faceted: boolean
  solidify: number
  ghost: number
  /** Materials already painted in these colours are left at that colour. */
  locks?: { color: string; opacity?: number }[]
}

export interface TemplateFrame {
  toneMapping: 'none' | 'aces' | 'neutral'
  exposure: number
  ao: { radius: number; intensity: number } | null
  bloom: { strength: number; radius: number; threshold: number } | null
  ink: { color: string; thickness: number; depth: number; crease: number; strength: number } | null
  grade: {
    saturation: number
    contrast: number
    warmth: number
    vignette: number
    levels: number
  } | null
}

export interface TemplateScene {
  sky: SkyStop[]
  lights: {
    sun: { color: string; intensity: number; from: [number, number, number] }
    fill: { color: string; intensity: number }
    bounce: { sky: string; ground: string; intensity: number }
    ambient: number
  }
  surfaces: TemplateSurfaces
  frame: TemplateFrame
}

export interface TemplateCard {
  sky: SkyStop[]
  horizon: string
  face: string
  shade: string
  ink: string
  glow: number
  line: boolean
}

export interface ViewTemplate {
  id: TemplateId
  label: string
  note: string
  description: string
  scene: TemplateScene | null
  card: TemplateCard
}

/** Light Studio backdrop from the runbook: top, then the slightly darker bottom. */
const STUDIO_SKY: SkyStop[] = [
  [0, '#F4F5F7'],
  [1, '#E3E6EA'],
]
/**
 * Backdrop behind every style while the dashboard is open in dark mode.
 * Top stays a step lighter than the bottom, as in the light Studio pair.
 */
export const DASHBOARD_DARK_SKY: SkyStop[] = [
  [0, '#1C2436'],
  [1, '#121824'],
]

export const VIEW_TEMPLATES: ViewTemplate[] = [
  {
    id: 'default',
    label: 'Default',
    note: 'Project settings',
    description: 'Uses your own sky, lights and render settings. Switch on Advanced Rendering or Render Lite below for extra quality.',
    scene: null,
    card: {
      sky: [
        [0, '#c8e2f3'],
        [1, '#c4b59c'],
      ],
      horizon: '#c4b59c',
      face: '#f1f4f7',
      shade: '#cbd5e0',
      ink: '#b3bcc7',
      glow: 0,
      line: false,
    },
  },
  {
    id: 'photoreal',
    label: 'Photoreal',
    note: 'Soft daylight',
    description: 'Warm blue sky with a soft sun, cast shadows, contact shading and a subtle colour grade. Best for realistic presentation views.',
    scene: {
      sky: [
        [0, '#5388c2'],
        [0.28, '#86b0da'],
        [0.5, '#b7d3ea'],
        [0.72, '#dde9f4'],
        [1, '#f7f4ee'],
      ],
      lights: {
        sun: { color: '#fff2da', intensity: 3, from: [0.62, 1, 0.42] },
        fill: { color: '#cddef3', intensity: 0.9 },
        bounce: { sky: '#a7c8ea', ground: '#e0d5c4', intensity: 0.85 },
        ambient: 0.22,
      },
      surfaces: {
        wash: 0.1,
        tint: '#e9e6e0',
        glow: 0,
        reflect: 0.22,
        faceted: false,
        solidify: 0.2,
        ghost: 0,
      },
      frame: {
        toneMapping: 'neutral',
        exposure: 1.08,
        ao: { radius: 1.6, intensity: 0.95 },
        bloom: null,
        ink: null,
        grade: { saturation: 1.06, contrast: 1.06, warmth: 0.03, vignette: 0.22, levels: 0 },
      },
    },
    card: {
      sky: [
        [0, '#5388c2'],
        [0.5, '#b7d3ea'],
        [1, '#f7f4ee'],
      ],
      horizon: '#f4f1e9',
      face: '#efece5',
      shade: '#a9a49a',
      ink: '#8d8880',
      glow: 0.15,
      line: false,
    },
  },
  {
    id: 'minimal',
    label: 'Minimalist',
    note: 'White model',
    description: 'Bleached-white surfaces on a bright studio backdrop, with a soft sun shadow, grey AO and thin pencil-line edges.',
    scene: {
      sky: [
        [0, '#e9eff5'],
        [0.5, '#f5f8fb'],
        [1, '#ffffff'],
      ],
      lights: {
        sun: { color: '#ffffff', intensity: 2.1, from: [0.5, 1, 0.4] },
        fill: { color: '#eef3f9', intensity: 1.2 },
        bounce: { sky: '#dfe8f2', ground: '#f4f1ec', intensity: 0.8 },
        ambient: 0.35,
      },
      surfaces: {
        wash: 0.92,
        tint: '#f2f4f6',
        glow: 0,
        reflect: 0.05,
        faceted: false,
        solidify: 0.55,
        ghost: 0,
      },
      frame: {
        toneMapping: 'none',
        exposure: 1,
        ao: { radius: 2.4, intensity: 0.85 },
        bloom: null,
        ink: { color: '#93a1af', thickness: 1, depth: 1.3, crease: 0.85, strength: 0.9 },
        grade: { saturation: 0.35, contrast: 1.06, warmth: 0, vignette: 0.1, levels: 0 },
      },
    },
    card: {
      sky: [
        [0, '#e9eff5'],
        [1, '#ffffff'],
      ],
      horizon: '#ffffff',
      face: '#ffffff',
      shade: '#dbe2e9',
      ink: '#93a1af',
      glow: 0,
      line: true,
    },
  },
  /*
  {
    id: 'monochrome',
    label: 'Monochrome',
    note: 'Bold B&W linework',
    description: 'Full greyscale with punchy contrast, tight AO corner shadows and bold black ink lines on silhouettes and edges.',
    scene: {
      sky: [
        [0, '#d4d4d4'],
        [0.4, '#e8e8e8'],
        [0.7, '#f4f4f4'],
        [1, '#ffffff'],
      ],
      lights: {
        sun: { color: '#ffffff', intensity: 2.8, from: [0.45, 1, 0.35] },
        fill: { color: '#d0d8e8', intensity: 0.55 },
        bounce: { sky: '#e0e0e0', ground: '#f0f0f0', intensity: 0.6 },
        ambient: 0.25,
      },
      surfaces: {
        wash: 1.0,
        tint: '#c8c8c8',
        glow: 0,
        reflect: 0.02,
        faceted: false,
        solidify: 0.55,
        ghost: 0,
      },
      frame: {
        toneMapping: 'none',
        exposure: 1.0,
        ao: { radius: 1.2, intensity: 1.2 },
        bloom: null,
        ink: { color: '#1a1a1a', thickness: 1.1, depth: 1.5, crease: 1.0, strength: 0.95 },
        grade: { saturation: 0, contrast: 1.22, warmth: 0, vignette: 0.18, levels: 0 },
      },
    },
    card: {
      sky: [
        [0, '#d4d4d4'],
        [1, '#ffffff'],
      ],
      horizon: '#f4f4f4',
      face: '#e0e0e0',
      shade: '#8a8a8a',
      ink: '#1a1a1a',
      glow: 0,
      line: true,
    },
  },
  */
  {
    id: 'xray',
    label: 'X-ray',
    note: 'See through structure',
    description: 'Dark night sky with blue-tinted translucent surfaces — all floors and walls become see-through so structure reads at a glance.',
    scene: {
      sky: [
        [0, '#070b14'],
        [0.4, '#0e1a2e'],
        [0.72, '#152840'],
        [1, '#1a3348'],
      ],
      lights: {
        sun: { color: '#9fdcff', intensity: 1.15, from: [0.55, 1, 0.45] },
        fill: { color: '#4a8ec8', intensity: 0.7 },
        bounce: { sky: '#3d7aaa', ground: '#0a1520', intensity: 0.45 },
        ambient: 0.35,
      },
      surfaces: {
        wash: 0.82,
        tint: '#5aa8d4',
        glow: 0.05,
        reflect: 0.08,
        faceted: false,
        solidify: 0,
        ghost: 1,
      },
      frame: {
        toneMapping: 'aces',
        exposure: 1,
        ao: null,
        bloom: null,
        ink: null,
        grade: { saturation: 1.05, contrast: 1.08, warmth: -0.08, vignette: 0.28, levels: 0 },
      },
    },
    card: {
      sky: [
        [0, '#0e1a2e'],
        [1, '#152840'],
      ],
      horizon: '#152840',
      face: '#5aa8d4',
      shade: '#2a5a78',
      ink: '#9ad4f0',
      glow: 0.25,
      line: true,
    },
  },
  {
    id: 'studio',
    label: 'Studio',
    note: 'Neutral model',
    description: 'Grey studio backdrop with the muted palette. Shadows, shading and edges can be switched and adjusted below. Export keeps those choices with the Studio style.',
    scene: {
      sky: STUDIO_SKY,
      lights: {
        sun: { color: '#f7f8fa', intensity: 1.65, from: [0.55, 1, 0.38] },
        fill: { color: '#e6ebf1', intensity: 0.8 },
        bounce: { sky: '#eef1f4', ground: '#e3e6ea', intensity: 0.7 },
        ambient: 0.4,
      },
      surfaces: {
        wash: 0.94,
        tint: '#F2F3F5',
        glow: 0,
        reflect: 0.06,
        faceted: false,
        solidify: 0.15,
        ghost: 0,
        locks: studioLocks(),
      },
      frame: {
        toneMapping: 'none',
        exposure: 1,
        ao: { radius: 1.8, intensity: 0.55 },
        bloom: null,
        ink: { color: '#222222', thickness: 1, depth: 1.15, crease: 0.7, strength: 0.25 },
        grade: { saturation: 0.92, contrast: 1.04, warmth: 0, vignette: 0.12, levels: 0 },
      },
    },
    card: {
      sky: STUDIO_SKY,
      horizon: '#E3E6EA',
      face: '#F2F3F5',
      shade: '#E4E7EB',
      ink: '#222222',
      glow: 0,
      line: true,
    },
  },
]

export const DEFAULT_TEMPLATE = VIEW_TEMPLATES[0]

export function getViewTemplate(id: TemplateId | undefined | null): ViewTemplate {
  return VIEW_TEMPLATES.find(t => t.id === id) ?? DEFAULT_TEMPLATE
}

export function getTemplateScene(
  id: TemplateId | undefined | null,
  xrayColor?: 'blue' | 'yellow' | 'white'
): TemplateScene | null {
  const t = VIEW_TEMPLATES.find(t => t.id === id) ?? DEFAULT_TEMPLATE
  if (!t.scene) return null

  // If we're on X-ray and a custom color is requested, deep clone and modify the scene
  if (id === 'xray' && xrayColor && xrayColor !== 'blue') {
    const scene = JSON.parse(JSON.stringify(t.scene)) as TemplateScene
    if (xrayColor === 'yellow') {
      scene.surfaces.tint = '#e8c848'
      if (scene.frame.ink) scene.frame.ink.color = '#f0d49a'
    } else if (xrayColor === 'white') {
      scene.surfaces.tint = '#e0e0e0'
      if (scene.frame.ink) scene.frame.ink.color = '#f0f0f0'
    }
    return scene
  }

  return t.scene
}

/**
 * Studio scene with the saved adjustments applied.
 * The shared template is left as it is, so the style card and the defaults stay put.
 */
export function applyStudioAdjust(scene: TemplateScene, adjust: Partial<StudioAdjust> | null | undefined): TemplateScene {
  const tune = studioAdjustOf(adjust)
  const ink = scene.frame.ink
  return {
    ...scene,
    lights: {
      ...scene.lights,
      sun: { ...scene.lights.sun, intensity: tune.sunIntensity },
      ambient: tune.ambient,
    },
    frame: {
      ...scene.frame,
      exposure: tune.exposure,
      ao: tune.ambientOcclusion
        ? { radius: tune.aoRadius, intensity: tune.aoIntensity }
        : null,
      ink: tune.edges && ink ? { ...ink, strength: tune.edgeStrength } : null,
    },
  }
}

export function skyCss(stops: SkyStop[]): string {
  return `linear-gradient(180deg, ${stops
    .map(([at, color]) => `${color} ${Math.round(at * 100)}%`)
    .join(', ')})`
}
