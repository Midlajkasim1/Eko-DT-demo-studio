import * as THREE from 'three'
import type * as FRAGS from '@thatopen/fragments'
import type { TemplateSurfaces } from '@/constants/viewTemplates'

/**
 * The slab the model stands on while a view template is running: its top sits at
 * grade, so the building stands on it and any basement stays underneath, and it is
 * turned onto the building's own grid rather than the world axes. A soft contact
 * shadow is laid on top where the building meets it.
 *
 * Ported from the EllisDon review viewer, where the platform is what grounds the
 * model — without it a template renders a building floating in an empty sky.
 */

/** Elements that are built on the structural grid, used to measure its angle. */
const GRID_CATEGORIES = [/^IFCWALL$/, /^IFCWALLSTANDARDCASE$/, /^IFCSLAB$/, /^IFCCOLUMN$/]

/** How many of those elements to read geometry for, per model. */
const GRID_SAMPLE = 150

/** Storey names that sit below grade, so the platform goes on top of them. */
const BELOW_GRADE = /basement|cellar|sub[- ]?level|parking|foundation|lower/i

/** Where the building sits in plan, measured in the frame its own grid runs in. */
interface Footprint {
  /** Angle of that frame around Y, in radians. */
  angle: number
  /** Centre of the footprint along the frame's two axes. */
  u: number
  v: number
  width: number
  depth: number
}

export class TemplatePlatform {
  readonly group = new THREE.Group()
  private readonly pad: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  private readonly padEdges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private readonly contact: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  /** Ground level, worked out once the models are in. */
  private grade: number | null = null
  /** Set while build() is in flight, so overlapping calls do not fight. */
  private building = false
  /** What the last build was measured against, so it is not redone needlessly. */
  private builtFor = ''

  constructor(private readonly models: FRAGS.FragmentsModels) {
    this.group.name = 'TemplatePlatform'
    this.pad = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    )
    this.padEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.pad.geometry),
      new THREE.LineBasicMaterial(),
    )
    this.contact = createContactShadow()
    this.group.add(this.pad, this.padEdges, this.contact)
    this.group.visible = false
  }

  get visible() {
    return this.group.visible
  }

  set visible(value: boolean) {
    this.group.visible = value
  }

  /** The template's own colours for the slab. */
  setStyle(surfaces: TemplateSurfaces, env: THREE.Texture | null) {
    const { platform } = surfaces
    this.pad.material.color.set(platform.color)
    this.pad.material.roughness = platform.roughness
    this.pad.material.envMap = env
    this.pad.material.envMapIntensity = 0.6
    this.pad.material.needsUpdate = true
    this.padEdges.material.color.set(platform.edge)
    this.contact.material.opacity = platform.shadow
  }

  /**
   * Measures the loaded models and lays the slab under them. Cheap to call again:
   * it re-measures only when the set of loaded models has changed.
   */
  async build(force = false) {
    const key = [...this.models.models.list.keys()].sort().join('|')
    if (!key) {
      this.group.visible = false
      return null
    }
    if (this.building || (!force && key === this.builtFor)) return this.grade
    this.building = true

    try {
      const box = this.modelsBox()
      if (!box) {
        this.group.visible = false
        return null
      }

      const grade = (await this.findGrade()) ?? box.min.y
      this.grade = grade
      const footprint = await this.findFootprint(box)

      const span = Math.max(footprint.width, footprint.depth)
      // Even border on all four sides, so the building reads as centred on the slab
      const margin = span * 0.08
      const width = footprint.width + margin * 2
      const depth = footprint.depth + margin * 2
      const thickness = THREE.MathUtils.clamp(span / 110, 0.3, 2.5)
      // A hair below grade so the slab is never coplanar with the ground floor
      const top = grade - 0.02

      // Turning the group means its children are laid out in the footprint's own
      // frame: local x runs along the building's length, local z across it.
      this.group.rotation.y = -footprint.angle

      this.pad.geometry.dispose()
      this.pad.geometry = new THREE.BoxGeometry(width, thickness, depth)
      this.pad.position.set(footprint.u, top - thickness / 2, footprint.v)

      this.padEdges.geometry.dispose()
      this.padEdges.geometry = new THREE.EdgesGeometry(this.pad.geometry)
      this.padEdges.position.copy(this.pad.position)

      // Soft occlusion hugging the footprint, never spilling past the slab
      this.contact.scale.set(
        Math.min(footprint.width * 1.15, width),
        Math.min(footprint.depth * 1.15, depth),
        1,
      )
      this.contact.position.set(footprint.u, top + 0.01, footprint.v)

      this.group.updateMatrixWorld(true)
      this.builtFor = key
      return grade
    } finally {
      this.building = false
    }
  }

  /** Forces the next build() to re-measure, e.g. after a model is added or moved. */
  invalidate() {
    this.builtFor = ''
  }

  dispose() {
    this.pad.geometry.dispose()
    this.pad.material.dispose()
    this.padEdges.geometry.dispose()
    this.padEdges.material.dispose()
    this.contact.geometry.dispose()
    this.contact.material.map?.dispose()
    this.contact.material.dispose()
    this.group.removeFromParent()
  }

  private modelsBox() {
    const box = new THREE.Box3()
    for (const model of this.models.models.list.values()) {
      const object = (model as any).object
      if (object?.updateWorldMatrix) box.expandByObject(object)
    }
    return box.isEmpty() ? null : box
  }

  /**
   * The building's footprint in plan: the angle its grid runs at, and the centre
   * and size of the rectangle around it measured in that frame.
   */
  private async findFootprint(box: THREE.Box3): Promise<Footprint> {
    const angle = (await this.findGridAngle()) ?? 0
    const corners: number[] = []

    for (const model of this.models.models.list.values()) {
      const boxes = await (model as any).getBoxes?.()
      if (!boxes) continue
      for (const item of boxes) {
        corners.push(
          item.min.x, item.min.z,
          item.min.x, item.max.z,
          item.max.x, item.min.z,
          item.max.x, item.max.z,
        )
      }
    }

    if (!corners.length) {
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      return { angle, u: center.x, v: center.z, width: size.x, depth: size.z }
    }

    // The size comes from the item boxes with the far tail dropped: a handful of
    // strays otherwise double the slab. They are world-axis aligned, which is why
    // they set the size but never the angle.
    return { angle, ...trimmedSpanAt(corners, angle, 0.0005) }
  }

  /**
   * The angle the building's grid runs at, taken from the walls themselves. The
   * normals of vertical faces point across the grid, so averaging them lands on
   * it — at four times the angle, which folds the four quadrants onto each other
   * so opposite and perpendicular faces reinforce instead of cancelling.
   */
  private async findGridAngle() {
    let re = 0
    let im = 0
    let area = 0

    for (const model of this.models.models.list.values()) {
      const found = await (model as any).getItemsOfCategories?.(GRID_CATEGORIES)
      if (!found) continue
      const ids = Object.values(found).flat() as number[]
      if (!ids.length) continue

      // A sample is plenty for an area-weighted average, and pulling every wall
      // across from the worker would hold up the load.
      const stride = Math.max(1, Math.ceil(ids.length / GRID_SAMPLE))
      const sample = ids.filter((_, index) => index % stride === 0)

      for (const meshes of await (model as any).getItemsGeometry(sample)) {
        for (const mesh of meshes) {
          if (!mesh?.positions) continue
          for (const face of faceNormals(mesh)) {
            // Sloped and horizontal faces say nothing about the plan grid
            if (Math.abs(face.y) > 0.2) continue
            const azimuth = Math.atan2(face.z, face.x)
            re += face.area * Math.cos(4 * azimuth)
            im += face.area * Math.sin(4 * azimuth)
            area += face.area
          }
        }
      }
    }

    if (!area) return null
    // Near 1 the walls all agree; low means the building has no grid to speak of,
    // and turning the slab to a number pulled out of noise would look arbitrary.
    if (Math.hypot(re, im) / area < 0.35) return null
    return Math.atan2(im, re) / 4
  }

  /**
   * Grade is the lowest storey that is not a basement. Storey elevations are
   * measured from the building datum (and Revit writes them in millimetres), so
   * they are anchored to the lowest geometry rather than used as world heights.
   */
  private async findGrade() {
    for (const model of this.models.models.list.values()) {
      const found = await (model as any).getItemsOfCategories?.([/^IFCBUILDINGSTOREY$/])
      if (!found) continue
      const localIds = Object.values(found).flat() as number[]
      if (localIds.length < 2) continue

      const data = await (model as any).getItemsData(localIds, {
        attributesDefault: false,
        attributes: ['Name', 'Elevation'],
        relationsDefault: { attributes: false, relations: false },
      })

      const storeys = data
        .map((item: any) => ({
          name: readAttribute(item, 'Name') ?? '',
          elevation: Number(readAttribute(item, 'Elevation')),
        }))
        .filter((storey: any) => Number.isFinite(storey.elevation))
        .sort((a: any, b: any) => a.elevation - b.elevation)
      if (storeys.length < 2) continue

      const lowest = storeys[0]
      const ground = storeys.find((storey: any) => !BELOW_GRADE.test(storey.name)) ?? lowest
      const rise = ground.elevation - lowest.elevation
      const spread = storeys[storeys.length - 1].elevation - lowest.elevation
      const unit = spread > 100 ? 0.001 : 1 // millimetres or metres
      return (model as any).box.min.y + rise * unit
    }
    return null
  }
}

/**
 * Normals of an item's triangles, each with the area it stands for, in the model's
 * own coordinates. Positions arrive in the geometry's local frame with the mesh
 * transform alongside, and are only ever uploaded to the GPU, so this is the one
 * place the geometry can be read.
 */
function faceNormals(mesh: FRAGS.MeshData) {
  const positions = mesh.positions!
  const matrix = mesh.transform
  const indices = mesh.indices
  const count = indices ? indices.length / 3 : positions.length / 9
  const vertex = new THREE.Vector3()
  const a = new THREE.Vector3()
  const edge1 = new THREE.Vector3()
  const edge2 = new THREE.Vector3()
  const cross = new THREE.Vector3()
  const faces: { x: number; y: number; z: number; area: number }[] = []

  const read = (index: number, target: THREE.Vector3) => {
    const at = indices ? indices[index] : index
    target.set(positions[at * 3], positions[at * 3 + 1], positions[at * 3 + 2])
    return matrix ? target.applyMatrix4(matrix as THREE.Matrix4) : target
  }

  for (let face = 0; face < count; face++) {
    read(face * 3, a)
    read(face * 3 + 1, vertex)
    edge1.copy(vertex).sub(a)
    read(face * 3 + 2, vertex)
    edge2.copy(vertex).sub(a)
    cross.crossVectors(edge1, edge2)

    const length = cross.length()
    if (length < 1e-9) continue
    faces.push({ x: cross.x / length, y: cross.y / length, z: cross.z / length, area: length / 2 })
  }
  return faces
}

/**
 * Centre and size in the rotated frame with the outermost `tail` of the samples
 * ignored on each of the four sides, so a few strays cannot set the size.
 */
function trimmedSpanAt(points: number[], angle: number, tail: number) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const count = points.length / 2
  const us = new Float64Array(count)
  const vs = new Float64Array(count)

  for (let i = 0; i < count; i++) {
    const x = points[i * 2]
    const z = points[i * 2 + 1]
    us[i] = x * cos + z * sin
    vs[i] = z * cos - x * sin
  }
  us.sort()
  vs.sort()

  const cut = Math.min(Math.floor(count * tail), Math.floor((count - 1) / 2))
  const minU = us[cut]
  const maxU = us[count - 1 - cut]
  const minV = vs[cut]
  const maxV = vs[count - 1 - cut]
  return {
    u: (minU + maxU) / 2,
    v: (minV + maxV) / 2,
    width: maxU - minU,
    depth: maxV - minV,
  }
}

/** A radial gradient laid on the platform: cheap contact shadow, no shadow maps. */
function createContactShadow() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  // Painted at full strength; how dark it actually goes is the template's to say
  gradient.addColorStop(0, 'rgba(27, 36, 48, 1)')
  gradient.addColorStop(0.45, 'rgba(27, 36, 48, 0.4)')
  gradient.addColorStop(1, 'rgba(27, 36, 48, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    }),
  )
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

/** Item attributes arrive as `{ value, type }` wrappers. */
function readAttribute(data: FRAGS.ItemData | undefined, key: string) {
  const raw = data?.[key]
  if (raw === undefined || Array.isArray(raw)) return null
  const value = (raw as { value?: unknown }).value ?? raw
  if (value === null || typeof value === 'object') return null
  return String(value)
}
