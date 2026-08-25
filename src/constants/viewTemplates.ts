import type { TemplateId } from './renderSettings'

/**
 * A template is one row of settings for the whole picture: the sky behind the
 * model, the lights on it, what its surfaces are made to look like, and which
 * post-processing passes run over the frame. Everything the eye reads as
 * "rendering style" is in here, so a new style is a new entry in
 * {@link VIEW_TEMPLATES} and nothing else.
 *
 * Ported from the EllisDon review viewer's "looks", so Photoreal, Minimalist and
 * X-ray read the same way here as they do there.
 */

/** One stop of a vertical gradient: how far down, and the colour there. */
export type SkyStop = [number, string]

export interface TemplateSurfaces {
  /** How far item colours are pulled towards {@link tint}: 0 keeps IFC's own. */
  wash: number
  tint: string
  /** Self-lit floor, so unlit faces keep some colour. */
  glow: number
  /** How much sky the surfaces mirror back. */
  reflect: number
  /** Facets instead of smooth normals. */
  faceted: boolean
  /** Pushes translucent items — glass, fabric — towards solid. */
  solidify: number
  /**
   * Pulls every surface toward see-through. 0 leaves opacity alone; 1 makes the
   * whole model a soft ghost so interiors read through the enclosure.
   */
  ghost: number
  /** The slab the model stands on, and how dark it sits into it. */
  platform: { color: string; roughness: number; edge: string; shadow: number }
}

export interface TemplateFrame {
  toneMapping: 'none' | 'aces' | 'neutral'
  exposure: number
  /** Contact darkening in corners and under overhangs. The radius is in world
   *  units (metres), the way the reference viewer's GTAO reads it — N8AO is put
   *  into world-space mode for templates so the same number means the same thing. */
  ao: { radius: number; intensity: number } | null
  /** Glow spilling off the brightest surfaces. */
  bloom: { strength: number; radius: number; threshold: number } | null
  /** Drawn lines along silhouettes and creases. */
  ink: { color: string; thickness: number; depth: number; crease: number; strength: number } | null
  /** Colour grade over the finished frame. `levels` of 0 leaves it continuous. */
  grade: {
    saturation: number
    contrast: number
    /** Positive warms the frame, negative cools it. */
    warmth: number
    vignette: number
    levels: number
  } | null
}

export interface TemplateScene {
  /** Sky wash, zenith first. Painted behind the model and used for reflections. */
  sky: SkyStop[]
  lights: {
    /** The sun: colour, strength, and the direction it comes from. */
    sun: { color: string; intensity: number; from: [number, number, number] }
    /** Cool light from the opposite side, so shaded faces do not go flat black. */
    fill: { color: string; intensity: number }
    /** Bounce: sky above, ground below. */
    bounce: { sky: string; ground: string; intensity: number }
    ambient: number
  }
  surfaces: TemplateSurfaces
  frame: TemplateFrame
}

/** Colours for the little scene drawn on the template's card. */
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
  /** null — no template pipeline; the project's own render settings drive the scene. */
  scene: TemplateScene | null
  card: TemplateCard
}

export const VIEW_TEMPLATES: ViewTemplate[] = [
  {
    id: 'default',
    label: 'Default',
    note: 'Project settings',
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
        platform: { color: '#d8d4cb', roughness: 0.8, edge: '#b6afa4', shadow: 0.45 },
      },
      frame: {
        toneMapping: 'neutral',
        exposure: 1.08,
        ao: { radius: 1.6, intensity: 0.95 },
        bloom: { strength: 0.12, radius: 0.5, threshold: 0.9 },
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
        platform: { color: '#ffffff', roughness: 0.95, edge: '#c8d0d8', shadow: 0.2 },
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
  {
    id: 'xray',
    label: 'X-ray',
    note: 'See through structure',
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
        platform: { color: '#0c1520', roughness: 0.9, edge: '#3a6a88', shadow: 0.15 },
      },
      frame: {
        toneMapping: 'aces',
        exposure: 1,
        ao: null,
        // The reference look carries a 0.12 bloom here. It is dropped on purpose:
        // X-ray is the one template whose scene is drawn by RenderPass rather than
        // by the ambient-occlusion pass, and in that chain UnrealBloomPass
        // intermittently hands back an empty frame while the camera moves — half
        // the frames of a drag come out blank. Measured: bloom on 4/8 blank, bloom
        // off 0/8, with every other pass ablated in turn. Over a near-black sky at
        // that strength it is close to invisible, so stability wins.
        bloom: null,
        ink: { color: '#9ad4f0', thickness: 1.2, depth: 0.65, crease: 0.45, strength: 0.75 },
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
]

export const DEFAULT_TEMPLATE = VIEW_TEMPLATES[0]

export function getViewTemplate(id: TemplateId | undefined | null): ViewTemplate {
  return VIEW_TEMPLATES.find(t => t.id === id) ?? DEFAULT_TEMPLATE
}

/** The scene a template drives, or null when it defers to the project settings. */
export function getTemplateScene(id: TemplateId | undefined | null): TemplateScene | null {
  return getViewTemplate(id).scene
}

/** A stop list as a CSS gradient, for the page and the picker cards. */
export function skyCss(stops: SkyStop[]): string {
  return `linear-gradient(180deg, ${stops
    .map(([at, color]) => `${color} ${Math.round(at * 100)}%`)
    .join(', ')})`
}
