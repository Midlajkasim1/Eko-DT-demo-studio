import * as THREE from 'three'
import type { SkyStop, TemplateSurfaces } from '@/constants/viewTemplates'

/**
 * The pieces a view template puts on the scene that are not plain renderer flags:
 * the sky it is seen against, the same sky wrapped round for reflections, and
 * what every item material is made to look like.
 */

function paint(stops: SkyStop[], width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')!
  const gradient = context.createLinearGradient(0, 0, 0, height)
  for (const [at, color] of stops) gradient.addColorStop(at, color)
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  return canvas
}

/**
 * The sky as a flat texture. Three lays a plain texture over the viewport rather
 * than around the scene, so the wash stays put as the camera orbits — the same
 * way a painted backdrop does.
 */
export function makeSkyTexture(stops: SkyStop[]) {
  const texture = new THREE.CanvasTexture(paint(stops, 8, 512))
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * The same sky wrapped around the scene, for reflections. The top half is the
 * sky itself; below the horizon it settles into the ground tone, which is what
 * glass and metal facing down pick up.
 */
export function makeSkyEnvironment(stops: SkyStop[]) {
  const horizon = stops[stops.length - 1][1]
  const ground = new THREE.Color(horizon).multiplyScalar(0.72).getStyle()
  const wrapped: SkyStop[] = [
    ...stops.map(([at, color]) => [at * 0.5, color] as SkyStop),
    [0.62, horizon],
    [1, ground],
  ]

  const texture = new THREE.CanvasTexture(paint(wrapped, 8, 512))
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Below this luminance a delivered colour carries no information — it is a glass
 * tint or a placeholder — and is replaced before the template's wash is applied.
 */
const DARK_FLOOR = 0.06

/** What those surfaces start from instead: a neutral mid-grey. */
const NEUTRAL_DARK = new THREE.Color(0.45, 0.45, 0.45)

/** What a material arrived as, so a template can be dialled back off it. */
interface DeliveredMaterial {
  color: THREE.Color
  emissive: THREE.Color | null
  opacity: number
  transparent: boolean
  depthWrite: boolean
  flatShading: boolean
  envMap: THREE.Texture | null
  envMapIntensity: number | null
  reflectivity: number | null
  combine: THREE.Combine | null
}

export type DeliveredMaterials = WeakMap<THREE.Material, DeliveredMaterial>

function capture(mat: any): DeliveredMaterial {
  return {
    color: mat.color.clone(),
    emissive: mat.emissive ? mat.emissive.clone() : null,
    opacity: mat.opacity,
    transparent: mat.transparent,
    depthWrite: mat.depthWrite,
    flatShading: mat.flatShading ?? false,
    envMap: mat.envMap ?? null,
    envMapIntensity: 'envMapIntensity' in mat ? mat.envMapIntensity : null,
    reflectivity: 'reflectivity' in mat ? mat.reflectivity : null,
    combine: 'combine' in mat ? mat.combine : null,
  }
}

/**
 * Puts the template's surface treatment on one item material: washed towards the
 * template's tint, self-lit, mirroring the sky, and pushed towards solid or
 * towards see-through.
 *
 * Returns false for materials it deliberately leaves alone.
 */
export function dressMaterial(
  material: THREE.Material,
  surfaces: TemplateSurfaces,
  env: THREE.Texture | null,
  cache: DeliveredMaterials,
): boolean {
  const mat = material as any
  // The LOD boxes are stand-ins for geometry that has not streamed in yet
  if (!mat || mat.isLodMaterial || !mat.color) return false

  let base = cache.get(material)
  if (!base) {
    base = capture(mat)
    cache.set(material, base)
  }

  // Everything else is dressed, including the barely-there materials architectural
  // glass arrives as. They used to be skipped here, to stop IfcSpace proxy volumes
  // solidifying into boxes — but that is handled properly now by hiding the
  // non-physical categories outright, and skipping them left every glass panel
  // with its delivered dark tint and its translucency: unwashed, unsolidified, and
  // stacking up into grey rectangles across a white model. The reference dresses
  // every material it is handed, and so does this.

  const { wash, tint, glow, reflect, faceted, solidify, ghost } = surfaces

  // Some models ship surfaces at near-zero luminance — glass tints and outright
  // #000000 placeholders. Lit by anything they stay black, and a template with a
  // light wash cannot lift them: Photoreal pulls only 10% towards its tint, so
  // #000000 lands on #171717. They read as holes punched through the model, and
  // because the geometry is single-sided they vanish when you orbit past them,
  // which is what makes them look like a rendering fault rather than model data.
  // Anything under DARK_FLOOR starts from a neutral grey instead of its delivered
  // colour. Authored colours are untouched — this only catches surfaces that
  // carry no usable colour at all. Set DARK_FLOOR to 0 for the delivered colours.
  const luminance = 0.2126 * base.color.r + 0.7152 * base.color.g + 0.0722 * base.color.b
  const start = luminance < DARK_FLOOR ? NEUTRAL_DARK : base.color

  mat.color.copy(start).lerp(new THREE.Color(tint), wash)
  if (mat.emissive) mat.emissive.copy(mat.color).multiplyScalar(glow)
  if ('flatShading' in mat) mat.flatShading = faceted

  mat.envMap = reflect > 0 ? env : base.envMap
  if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
    mat.envMapIntensity = reflect
  } else {
    // Lambert and Phong mix the reflection in themselves rather than through IBL
    if ('combine' in mat) mat.combine = THREE.MixOperation
    if ('reflectivity' in mat) mat.reflectivity = reflect
  }

  // Glass and fabric arrive translucent. Solidifying them is what lets a drawn or
  // white-model template read as one object instead of layers seen through each
  // other — and once a surface is opaque it can write depth again, which is what
  // stops stacked translucent layers from flickering. Ghost does the opposite:
  // every surface is pulled toward see-through so an X-ray template can read
  // floors and structure through the enclosure.
  mat.opacity = THREE.MathUtils.lerp(base.opacity, 1, solidify)
  if (ghost > 0) mat.opacity = THREE.MathUtils.lerp(mat.opacity, 0.22, ghost)
  const solid = mat.opacity > 0.99
  mat.transparent = !solid
  mat.depthWrite = solid

  mat.needsUpdate = true
  return true
}

/** Puts a material back the way the model delivered it. */
export function restoreMaterial(material: THREE.Material, cache: DeliveredMaterials) {
  const base = cache.get(material)
  if (!base) return
  const mat = material as any

  mat.color.copy(base.color)
  if (mat.emissive && base.emissive) mat.emissive.copy(base.emissive)
  mat.opacity = base.opacity
  mat.transparent = base.transparent
  mat.depthWrite = base.depthWrite
  if ('flatShading' in mat) mat.flatShading = base.flatShading
  mat.envMap = base.envMap
  if (base.envMapIntensity !== null) mat.envMapIntensity = base.envMapIntensity
  if (base.reflectivity !== null) mat.reflectivity = base.reflectivity
  if (base.combine !== null) mat.combine = base.combine

  mat.needsUpdate = true
  cache.delete(material)
}
