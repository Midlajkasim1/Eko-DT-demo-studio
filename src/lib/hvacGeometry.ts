import * as THREE from 'three'
import { watchClipping, unwatchClipping } from '@/lib/sliceTool'

export const COIL_CLOSED = new THREE.Color(0x7f8c9a)
export const COIL_OPEN   = new THREE.Color(0xb56a3c)
export const COIL_IDLE   = new THREE.Color(0x8d939b)
export const FAN_ON      = new THREE.Color(0xc0392b)
export const FAN_OFF     = new THREE.Color(0x4b5563)
export const FILTER_CLEAN = new THREE.Color(0xc8d6df)
export const FILTER_DIRTY = new THREE.Color(0x9c6b2e)
/** A part whose reading is missing: neither the healthy nor the fault colour. */
export const NO_DATA      = new THREE.Color(0x9aa3ab)
export const UV_ON        = new THREE.Color(0x8b5cf6)
export const UV_ALARM     = new THREE.Color(0xef4444)

export type HvacPoint = { navName?: string; currentValue?: string | null }

/** What the viewer needs from any equipment schematic. */
export interface HvacSchematic {
  group:   THREE.Group
  apply:   (points: HvacPoint[]) => unknown
  tick:    (dt: number) => void
  dispose: () => void
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export const noRaycast: THREE.Mesh['raycast'] = () => {}

export function keyOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function clean(value: string | null | undefined): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s || s === '—' || s === '--' || s === 'N/A' || /^null$/i.test(s)) return null
  return s
}

export function numberOf(raw: string | null): number | null {
  if (!raw) return null
  const m = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = parseFloat(m[0])
  return Number.isFinite(n) ? n : null
}

export function findPoint<T extends HvacPoint>(points: T[], test: (key: string) => boolean): T | null {
  for (const p of points) {
    if (test(keyOf(p.navName || ''))) return p
  }
  return null
}

export function shown(raw: string | null, unit: string): string {
  if (!raw) return '—'
  const upper = raw.trim().toUpperCase()
  if (['T', 'TRUE', 'ON', 'RUN', 'RUNNING'].includes(upper)) return 'On'
  if (['F', 'FALSE', 'OFF', 'STOP', 'STOPPED'].includes(upper)) return 'Off'
  const n = numberOf(raw)
  if (n != null && unit && !raw.includes(unit) && !/[a-zA-Z°]/.test(raw)) {
    const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
    return text + unit
  }
  return raw
}

/** On / off, or null when the reading is missing or unreadable — never a guessed "off". */
export function stateOf(raw: string | null): boolean | null {
  if (!raw) return null
  const upper = raw.trim().toUpperCase()
  if (['ON', 'RUN', 'RUNNING', 'TRUE', 'T', 'START', 'YES', 'OPEN'].includes(upper)) return true
  if (['OFF', 'STOP', 'STOPPED', 'FALSE', 'F', 'NO', 'CLOSED'].includes(upper)) return false
  const n = numberOf(raw)
  return n == null ? null : n > 0
}

export function isRunning(raw: string | null): boolean {
  return stateOf(raw) === true
}

/** A filter status: "Dirty"/"Clean" text, or a pressure switch's T/F (T = high DP = dirty); null when unknown. */
// ponytail: T-means-dirty is unconfirmed until FIN shows a dirty filter; flip here if not.
export function dirtyOf(raw: string | null): boolean | null {
  if (!raw) return null
  if (/dirty|alarm|fault|high/i.test(raw)) return true
  if (/clean|normal|ok|low/i.test(raw)) return false
  return stateOf(raw)
}

/** Centre X of each section laid end to end along the casing, in airflow order, widths by weight. */
export function bayCentres<K extends string>(hx: number, bays: [K, number][]): { xs: Record<K, number>; unit: number } {
  const unit = hx * 1.78 / bays.reduce((s, [, w]) => s + w, 0)
  const xs = {} as Record<K, number>
  let at = -hx * 0.88
  for (const [bay, w] of bays) {
    xs[bay] = at + unit * w / 2
    at += unit * w
  }
  return { xs, unit }
}

/** A 0..1 fraction from "0.4", "40" or "40 %". */
export function fractionOf(raw: string | null): number | null {
  const n = numberOf(raw)
  if (n == null) return null
  const frac = n <= 1 && !raw!.includes('%')
  return Math.min(1, Math.max(0, frac ? n : n / 100))
}

export interface CasingFrame {
  center: THREE.Vector3
  long:   THREE.Vector3
  up:     THREE.Vector3
  width:  THREE.Vector3
  hx: number
  hy: number
  hz: number
}

export function casingCloud(root: THREE.Object3D): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  const v = new THREE.Vector3()
  root.updateMatrixWorld(true)
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert()
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.userData?.ekoGhostDepth) return
    const attr = mesh.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!attr) return
    const step = Math.max(1, Math.ceil(attr.count / 2500))
    for (let i = 0; i < attr.count; i += step) {
      pts.push(v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(toLocal).clone())
    }
  })
  return pts
}

export function eigenAxes(
  m00: number, m01: number, m02: number,
  m11: number, m12: number, m22: number,
): THREE.Vector3[] {
  const A = [[m00, m01, m02], [m01, m11, m12], [m02, m12, m22]]
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let iter = 0; iter < 16; iter++) {
    let p = 0, q = 1, max = Math.abs(A[0][1])
    if (Math.abs(A[0][2]) > max) { max = Math.abs(A[0][2]); p = 0; q = 2 }
    if (Math.abs(A[1][2]) > max) { max = Math.abs(A[1][2]); p = 1; q = 2 }
    if (max < 1e-12) break
    const app = A[p][p], aqq = A[q][q], apq = A[p][q]
    const tau = (aqq - app) / (2 * apq || 1e-12)
    const tt  = Math.sign(tau || 1) / (Math.abs(tau) + Math.hypot(1, tau))
    const c   = 1 / Math.hypot(1, tt)
    const s   = tt * c
    A[p][p] = app - tt * apq
    A[q][q] = aqq + tt * apq
    A[p][q] = A[q][p] = 0
    for (let r = 0; r < 3; r++) {
      if (r === p || r === q) continue
      const arp = A[r][p], arq = A[r][q]
      A[r][p] = A[p][r] = c * arp - s * arq
      A[r][q] = A[q][r] = s * arp + c * arq
    }
    for (let r = 0; r < 3; r++) {
      const vp = V[r][p], vq = V[r][q]
      V[r][p] = c * vp - s * vq
      V[r][q] = s * vp + c * vq
    }
  }
  return [0, 1, 2].map(i => new THREE.Vector3(V[0][i], V[1][i], V[2][i]).normalize())
}

const CASING_BINS = 32
const CASING_BULK = 0.58

function axisCoord(p: THREE.Vector3, axis: number): number {
  return axis === 0 ? p.x : axis === 1 ? p.y : p.z
}

/**
 * The equipment proxy is the thick casing plus thin extras (a base slab that
 * runs past the casing, an end plate, pipe stubs). Fitting the schematic to
 * every vertex parks the fan on that slab. Keep the longest run of slices
 * whose cross-section is close to the thickest slice — the casing — and drop
 * the thin ones. Empty slices do not break the run, so a box stored as corner
 * vertices still counts as one body.
 */
/**
 * A base slab is short. Columns over the casing run nearly the full height;
 * columns that only hit the slab do not. Drop those, so the fan is not
 * placed on the slab that sticks out past the casing.
 */
function dropShortColumns(pts: THREE.Vector3[], up: THREE.Vector3): THREE.Vector3[] {
  if (pts.length < 8) return pts
  const ax = [Math.abs(up.x), Math.abs(up.y), Math.abs(up.z)]
  const upAxis = ax[0] >= ax[1] && ax[0] >= ax[2] ? 0 : ax[1] >= ax[2] ? 1 : 2
  const a = (upAxis + 1) % 3
  const b = (upAxis + 2) % 3
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity
  for (const p of pts) {
    const ca = axisCoord(p, a)
    const cb = axisCoord(p, b)
    if (ca < minA) minA = ca
    if (ca > maxA) maxA = ca
    if (cb < minB) minB = cb
    if (cb > maxB) maxB = cb
  }
  const spanA = maxA - minA
  const spanB = maxB - minB
  if (spanA < 1e-6 || spanB < 1e-6) return pts
  const N = 18
  const cells = Array.from({ length: N * N }, () => ({ lo: Infinity, hi: -Infinity, n: 0 }))
  const indexOf = (p: THREE.Vector3) => {
    let ia = Math.floor((axisCoord(p, a) - minA) / spanA * N)
    let ib = Math.floor((axisCoord(p, b) - minB) / spanB * N)
    if (ia < 0) ia = 0
    else if (ia >= N) ia = N - 1
    if (ib < 0) ib = 0
    else if (ib >= N) ib = N - 1
    return ia * N + ib
  }
  for (const p of pts) {
    const cell = cells[indexOf(p)]
    const u = axisCoord(p, upAxis)
    if (u < cell.lo) cell.lo = u
    if (u > cell.hi) cell.hi = u
    cell.n++
  }
  let maxH = 0
  for (const cell of cells) if (cell.n) maxH = Math.max(maxH, cell.hi - cell.lo)
  if (maxH < 1e-6) return pts
  const kept = pts.filter(p => {
    const cell = cells[indexOf(p)]
    return cell.n > 0 && (cell.hi - cell.lo) >= maxH * 0.6
  })
  if (kept.length < 8) return pts
  const spanOf = (arr: THREE.Vector3[], axis: number) => {
    let lo = Infinity, hi = -Infinity
    for (const p of arr) {
      const c = axisCoord(p, axis)
      if (c < lo) lo = c
      if (c > hi) hi = c
    }
    return hi - lo
  }
  for (const axis of [a, b]) {
    const before = spanOf(pts, axis)
    if (before > 1e-6 && spanOf(kept, axis) < before * 0.4) return pts
  }
  return kept
}

function withoutThinExtensions(pts: THREE.Vector3[]): THREE.Vector3[] {
  if (pts.length < 8) return pts
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const p of pts) {
    for (let a = 0; a < 3; a++) {
      const c = axisCoord(p, a)
      if (c < min[a]) min[a] = c
      if (c > max[a]) max[a] = c
    }
  }
  const span = [0, 1, 2].map(a => max[a] - min[a])
  const ranges: Array<[number, number] | null> = [null, null, null]

  for (let axis = 0; axis < 3; axis++) {
    if (span[axis] < 1e-6) continue
    const o0 = (axis + 1) % 3
    const o1 = (axis + 2) % 3
    const bins = Array.from({ length: CASING_BINS }, () => ({
      n: 0, a0: Infinity, b0: -Infinity, a1: Infinity, b1: -Infinity,
    }))
    for (const p of pts) {
      let i = Math.floor((axisCoord(p, axis) - min[axis]) / span[axis] * CASING_BINS)
      if (i < 0) i = 0
      else if (i >= CASING_BINS) i = CASING_BINS - 1
      const bin = bins[i]
      const c0 = axisCoord(p, o0)
      const c1 = axisCoord(p, o1)
      bin.n++
      if (c0 < bin.a0) bin.a0 = c0
      if (c0 > bin.b0) bin.b0 = c0
      if (c1 < bin.a1) bin.a1 = c1
      if (c1 > bin.b1) bin.b1 = c1
    }
    let max0 = 0
    let max1 = 0
    for (const bin of bins) {
      if (!bin.n) continue
      const e0 = bin.b0 - bin.a0
      const e1 = bin.b1 - bin.a1
      if (e0 > max0) max0 = e0
      if (e1 > max1) max1 = e1
    }
    if (max0 < 1e-6 || max1 < 1e-6) continue
    let lo = -1
    let hi = -1
    for (let i = 0; i < CASING_BINS; i++) {
      const bin = bins[i]
      if (!bin.n) continue
      const bulky =
        (bin.b0 - bin.a0) >= max0 * CASING_BULK &&
        (bin.b1 - bin.a1) >= max1 * CASING_BULK
      if (!bulky) continue
      if (lo < 0) lo = i
      hi = i
    }
    if (lo > 0 || (hi >= 0 && hi < CASING_BINS - 1)) ranges[axis] = [lo, hi]
  }

  const kept = pts.filter(p => {
    for (let axis = 0; axis < 3; axis++) {
      const range = ranges[axis]
      if (!range) continue
      let i = Math.floor((axisCoord(p, axis) - min[axis]) / span[axis] * CASING_BINS)
      if (i < 0) i = 0
      else if (i >= CASING_BINS) i = CASING_BINS - 1
      if (i < range[0] || i > range[1]) return false
    }
    return true
  })
  if (kept.length < 8) return pts

  const keptMin = [Infinity, Infinity, Infinity]
  const keptMax = [-Infinity, -Infinity, -Infinity]
  for (const p of kept) {
    for (let a = 0; a < 3; a++) {
      const c = axisCoord(p, a)
      if (c < keptMin[a]) keptMin[a] = c
      if (c > keptMax[a]) keptMax[a] = c
    }
  }
  for (let a = 0; a < 3; a++) {
    if (span[a] < 1e-6) continue
    const next = keptMax[a] - keptMin[a]
    if (next < span[a] * 0.35 || next < 1e-4) return pts
  }
  return kept
}

/**
 * Rotation of the thick casing, not the first mesh. On the AHU the first
 * mesh is the base slab and its rotation does not match the casing, so a
 * box built from it hangs the fan out of the unit.
 */
function thickMeshQuaternion(root: THREE.Object3D): THREE.Quaternion | null {
  let best = 0
  let quat: THREE.Quaternion | null = null
  const box = new THREE.Box3()
  const size = new THREE.Vector3()
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.userData?.ekoGhostDepth) return
    const attr = mesh.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!attr) return
    box.setFromBufferAttribute(attr)
    box.getSize(size).multiply(mesh.scale)
    const dims = [size.x, size.y, size.z].sort((a, b) => a - b)
    if (dims[2] < 1e-4 || dims[0] < dims[2] * 0.2) return
    const volume = dims[0] * dims[1] * dims[2]
    if (volume <= best) return
    best = volume
    quat = mesh.quaternion.clone()
  })
  return quat
}

export function frameFromCasing(root: THREE.Object3D, localUp: THREE.Vector3): CasingFrame | null {
  const pts = casingCloud(root)
  if (pts.length < 8) return null
  const mid = new THREE.Vector3()
  for (const p of pts) mid.add(p)
  mid.multiplyScalar(1 / pts.length)
  let m00 = 0, m01 = 0, m02 = 0, m11 = 0, m12 = 0, m22 = 0
  for (const p of pts) {
    const x = p.x - mid.x, y = p.y - mid.y, z = p.z - mid.z
    m00 += x * x; m01 += x * y; m02 += x * z
    m11 += y * y; m12 += y * z; m22 += z * z
  }
  const axes = eigenAxes(m00, m01, m02, m11, m12, m22)
  let upI = 0, best = -1
  axes.forEach((axis, i) => {
    const a = Math.abs(axis.dot(localUp))
    if (a > best) { best = a; upI = i }
  })
  const up = axes[upI].clone()
  if (up.dot(localUp) < 0) up.negate()
  const spanOf = (axis: THREE.Vector3) => {
    let lo = Infinity, hi = -Infinity
    for (const p of pts) {
      const t = axis.dot(p) - axis.dot(mid)
      if (t < lo) lo = t
      if (t > hi) hi = t
    }
    return { half: (hi - lo) / 2, mid: (hi + lo) / 2 }
  }
  let longI = upI === 0 ? 1 : 0
  let longSpan = spanOf(axes[longI])
  for (let i = 0; i < 3; i++) {
    if (i === upI) continue
    const s = spanOf(axes[i])
    if (s.half > longSpan.half) { longSpan = s; longI = i }
  }
  const long = axes[longI].clone()
  const width = new THREE.Vector3().crossVectors(long, up)
  if (width.lengthSq() < 1e-8) return null
  width.normalize()
  const upSpan    = spanOf(up)
  const widthSpan = spanOf(width)
  if (longSpan.half < 0.05 || upSpan.half < 0.05 || widthSpan.half < 0.05) return null
  const center = mid.clone()
    .addScaledVector(long,  longSpan.mid)
    .addScaledVector(up,    upSpan.mid)
    .addScaledVector(width, widthSpan.mid)
  return { center, long, up, width, hx: longSpan.half, hy: upSpan.half, hz: widthSpan.half }
}

export function resolveFrame(
  localBox:    THREE.Box3,
  modelMatrix: THREE.Matrix4,
  casing?:     THREE.Object3D,
): CasingFrame | null {
  if (!localBox || localBox.isEmpty()) return null
  const size = localBox.getSize(new THREE.Vector3())
  if ([size.x, size.y, size.z].some(d => d < 0.05)) return null

  const meshTransform = casing?.userData?.meshTransform as THREE.Matrix4 | undefined
  const bodyQuat = casing ? thickMeshQuaternion(casing) : null
  let transformToUse = modelMatrix
  if (bodyQuat) {
    transformToUse = new THREE.Matrix4().makeRotationFromQuaternion(bodyQuat)
  } else if (meshTransform) {
    // Extract only rotation from meshTransform (ignore translation/scale) to keep it a pure rotation matrix
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    meshTransform.decompose(position, quaternion, scale)
    transformToUse = new THREE.Matrix4().makeRotationFromQuaternion(quaternion)
  }

  const localUp = new THREE.Vector3(0, 1, 0).transformDirection(new THREE.Matrix4().copy(transformToUse).invert())

  if (casing && !meshTransform) {
    const fitted = frameFromCasing(casing, localUp)
    if (fitted) return fitted
  }

  const center = new THREE.Vector3()
  let dims = [0, 0, 0]
  const axes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ]

  if (casing && meshTransform) {
    // We have the exact physical points AND the mesh rotation.
    // Calculate the perfect Oriented Bounding Box (OBB) without PCA.
    const pts = casingCloud(casing)
    if (pts.length > 0) {
      const toLocal = new THREE.Matrix4().copy(transformToUse).invert()
      const localPts = pts.map(p => p.clone().applyMatrix4(toLocal))
      const bodyPts = withoutThinExtensions(dropShortColumns(localPts, localUp))
      const box = new THREE.Box3()
      for (const p of bodyPts) box.expandByPoint(p)

      box.getCenter(center)
      center.applyMatrix4(transformToUse)
      
      const size = box.getSize(new THREE.Vector3())
      dims = [size.x, size.y, size.z]
    }
  } else {
    // Fallback if no meshTransform is available
    localBox.getCenter(center)
    center.applyMatrix4(transformToUse)
    const size = localBox.getSize(new THREE.Vector3())
    dims = [size.x, size.y, size.z]
  }

  let upI = 1, best = -1
  axes.forEach((axis, i) => {
    const a = Math.abs(axis.dot(localUp))
    if (a > best) { best = a; upI = i }
  })
  if (axes[upI].dot(localUp) < 0) axes[upI].negate()
  
  let longI = 0, longS = -1
  for (let i = 0; i < 3; i++) {
    if (i === upI) continue
    if (dims[i] > longS) { longS = dims[i]; longI = i }
  }
  
  const widthI = 3 - upI - longI
  const up     = axes[upI].clone().transformDirection(transformToUse)
  const long   = axes[longI].clone().transformDirection(transformToUse)
  const width  = new THREE.Vector3().crossVectors(long, up).normalize()
  
  return {
    center,
    long,
    up,
    width,
    hx: dims[longI]  / 2,
    hy: dims[upI]    / 2,
    hz: dims[widthI] / 2,
  }
}

export interface HvacCtx {
  geoms:      Set<THREE.BufferGeometry>
  mats:       THREE.Material[]
  add(geom: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh
  metal(color: THREE.Color | number, metalness: number, roughness: number): THREE.MeshStandardMaterial
  disposeAll(): void
}

export function makeHvacCtx(tag: string): HvacCtx {
  const geoms = new Set<THREE.BufferGeometry>()
  const mats:  THREE.Material[] = []

  const metal = (
    color:     THREE.Color | number,
    metalness: number,
    roughness: number,
  ): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      color, metalness, roughness, envMapIntensity: 1, toneMapped: false,
    })
    watchClipping(m)
    mats.push(m)
    return m
  }

  const add = (
    geom:   THREE.BufferGeometry,
    mat:    THREE.Material,
    parent: THREE.Object3D,
  ): THREE.Mesh => {
    geoms.add(geom)
    const mesh = new THREE.Mesh(geom, mat)
    mesh.raycast       = noRaycast
    mesh.renderOrder   = 3
    mesh.userData[tag] = true
    mesh.castShadow    = false
    mesh.receiveShadow = false
    parent.add(mesh)
    return mesh
  }

  const disposeAll = () => {
    geoms.forEach(g => g.dispose())
    mats.forEach(m => { unwatchClipping(m); m.dispose() })
  }

  return { geoms, mats, add, metal, disposeAll }
}

export interface CoilParams {
  parent: THREE.Object3D
  hx:     number
  hy:     number
  hz:     number
  coilX:  number
}

export interface CoilResult {
  coilMat: THREE.MeshStandardMaterial
  tubeR:   number
  yBot:    number
  yTop:    number
  tubeLen: number
  xs: [number, number]
}

export function buildCoil(ctx: HvacCtx, p: CoilParams): CoilResult {
  const { parent, hx, hy, hz, coilX } = p
  const span    = Math.min(hy, hz)
  const coilMat = ctx.metal(COIL_IDLE, 0.62, 0.34)
  const finMat  = ctx.metal(0xf3f6f8, 0.28, 0.46)
  const rowsY   = 4
  const yBot    = -hy * 0.2
  const yTop    =  hy * 0.52
  const dy      = (yTop - yBot) / (rowsY - 1)
  const tubeR   = Math.min(dy * 0.3, span * 0.055)
  const dx      = dy * 0.85
  const tubeLen = Math.min(hz * 1.65, hx * 0.62)
  const xs: [number, number] = [coilX - dx * 0.5, coilX + dx * 0.5]
  
  const tube = new THREE.CylinderGeometry(tubeR, tubeR, tubeLen, 16)
  tube.rotateX(Math.PI / 2)
  for (const x of xs) {
    for (let i = 0; i < rowsY; i++) {
      ctx.add(tube, coilMat, parent).position.set(x, yBot + i * dy, 0)
    }
  }
  
  const bow = new THREE.TorusGeometry(dy / 2, tubeR * 0.96, 8, 14, Math.PI)
  bow.rotateZ(Math.PI / 2)
  bow.rotateY(Math.PI / 2)
  for (const x of xs) {
    for (let i = 0; i < rowsY - 1; i++) {
      const positive = i % 2 === 0
      const bend = ctx.add(bow, coilMat, parent)
      bend.position.set(x, yBot + (i + 0.5) * dy, positive ? tubeLen / 2 : -tubeLen / 2)
      if (!positive) bend.rotation.y = Math.PI
    }
  }
  
  const finH   = (yTop - yBot) + tubeR * 3
  const finD   = dx + tubeR * 8
  const finT   = Math.max(tubeLen * 0.008, tubeR * 0.22)
  const fin    = new THREE.BoxGeometry(finD, finH, finT)
  const finN   = 26
  const finSpan = tubeLen * 0.84
  for (let i = 0; i < finN; i++) {
    ctx.add(fin, finMat, parent).position.set(
      coilX,
      (yTop + yBot) / 2,
      -finSpan / 2 + (i + 0.5) * (finSpan / finN),
    )
  }
  
  const tray = ctx.add(
    new THREE.BoxGeometry(finD * 1.15, hy * 0.03, tubeLen * 0.72),
    ctx.metal(0x3a424b, 0.48, 0.5),
    parent,
  )
  tray.position.set(coilX, yBot - tubeR * 2.4, tubeLen * 0.06)
  
  return { coilMat, tubeR, yBot, yTop, tubeLen, xs }
}

export interface ValveParams {
  parent:   THREE.Object3D
  hy:       number
  hz:       number
  span:     number
  tubeR:    number
  coilMat:  THREE.MeshStandardMaterial
  xs:       [number, number]
  yBot:     number
  tubeLen:  number
}

export interface ValveResult {
  valveX: number
  valveZ: number
  actY:   number
}

export function buildValve(ctx: HvacCtx, p: ValveParams): ValveResult {
  const { parent, hy, hz, span, tubeR, coilMat, xs, yBot, tubeLen } = p
  const valveMat = ctx.metal(0x3a424c, 0.58, 0.38)
  const actMat   = ctx.metal(0x5c6772, 0.08, 0.55)
  const valveX   = xs[0]
  const valveZ   = -tubeLen / 2
  const valveY   = yBot - hy * 0.5
  const bodyH    = hy * 0.15
  
  ctx.add(new THREE.CylinderGeometry(span * 0.05, span * 0.066, bodyH, 14), valveMat, parent)
    .position.set(valveX, valveY, valveZ)
  
  const stemH = hy * 0.045
  ctx.add(new THREE.CylinderGeometry(span * 0.016, span * 0.016, stemH, 8), valveMat, parent)
    .position.set(valveX, valveY - bodyH / 2 - stemH / 2, valveZ)
  
  const actH = hy * 0.08
  const actY = valveY - bodyH / 2 - stemH - actH / 2
  ctx.add(new THREE.BoxGeometry(span * 0.18, actH, span * 0.14), actMat, parent)
    .position.set(valveX, actY, valveZ)
  
  const valveTop = valveY + bodyH / 2
  const feedLen  = Math.max(tubeR * 2, yBot - valveTop)
  ctx.add(new THREE.CylinderGeometry(tubeR * 0.85, tubeR * 0.85, feedLen, 10), coilMat, parent)
    .position.set(valveX, valveTop + feedLen / 2, valveZ)
  
  const stubLen = Math.min(hz * 0.16, Math.max(tubeR * 2, hz - Math.abs(valveZ) - tubeR * 2))
  const stubGeo = new THREE.CylinderGeometry(tubeR * 0.85, tubeR * 0.85, stubLen, 10)
  stubGeo.rotateX(Math.PI / 2)
  ctx.add(stubGeo, coilMat, parent).position.set(valveX, valveY, valveZ - stubLen / 2)
  
  return { valveX, valveZ, actY }
}

export interface FanParams {
  group:      THREE.Object3D
  hy:         number
  hz:         number
  fanX:       number
  pivotRotY?: number
}

export interface FanResult {
  rotor:    THREE.Group
  bladeMat: THREE.MeshStandardMaterial
  fanR:     number
}

export function buildCentrifugalFan(ctx: HvacCtx, p: FanParams): FanResult {
  const { group, hy, hz, fanX, pivotRotY = Math.PI / 2 } = p
  const housingMat = ctx.metal(0x2a313a, 0.5, 0.4)
  housingMat.side  = THREE.DoubleSide
  const bladeMat   = ctx.metal(FAN_OFF, 0.4, 0.38)
  bladeMat.side    = THREE.DoubleSide
  const fanR       = Math.min(hy * 0.8, hz * 0.4)
  const bladeDepth = Math.min(hz * 0.4, fanR * 0.95)

  const fanPivot = new THREE.Group()
  fanPivot.position.set(fanX, 0, 0)
  fanPivot.rotation.y = pivotRotY
  group.add(fanPivot)

  const scroll = new THREE.CylinderGeometry(fanR * 1.05, fanR * 1.05, bladeDepth * 1.02, 32, 1, true)
  scroll.rotateX(Math.PI / 2)
  ctx.add(scroll, housingMat, fanPivot)

  const motorLen = bladeDepth * 0.72
  const motor    = new THREE.CylinderGeometry(fanR * 0.2, fanR * 0.25, motorLen, 16)
  motor.rotateX(Math.PI / 2)
  ctx.add(motor, housingMat, fanPivot)
    .position.set(0, 0, bladeDepth * 0.5 + motorLen * 0.42)

  const flange = new THREE.CylinderGeometry(fanR * 0.3, fanR * 0.3, bladeDepth * 0.08, 16)
  flange.rotateX(Math.PI / 2)
  ctx.add(flange, housingMat, fanPivot).position.set(0, 0, bladeDepth * 0.5)

  const rotor = new THREE.Group()
  fanPivot.add(rotor)

  const bladeShape = new THREE.Shape()
  const r0 = fanR * 0.3, r1 = fanR * 0.9, bt = fanR * 0.042
  bladeShape.moveTo(r0, -bt * 0.2)
  bladeShape.quadraticCurveTo((r0 + r1) * 0.5, bt * 1.15, r1, bt * 2.3)
  bladeShape.lineTo(r1 - fanR * 0.035, bt * 2.3 - bt)
  bladeShape.quadraticCurveTo((r0 + r1) * 0.48, -bt * 0.2, r0, -bt * 1.35)
  bladeShape.closePath()
  const bladeGeo = new THREE.ExtrudeGeometry(
    bladeShape,
    { depth: bladeDepth * 0.7, bevelEnabled: false, curveSegments: 8 },
  )
  bladeGeo.translate(0, 0, -bladeDepth * 0.35)
  for (let i = 0; i < 12; i++) {
    ctx.add(bladeGeo, bladeMat, rotor).rotation.z = (i / 12) * Math.PI * 2
  }

  const rim = new THREE.TorusGeometry(fanR * 0.92, fanR * 0.032, 8, 28)
  ctx.add(rim, housingMat, rotor).position.z =  bladeDepth * 0.34
  ctx.add(rim, housingMat, rotor).position.z = -bladeDepth * 0.34

  const hub = new THREE.CylinderGeometry(fanR * 0.16, fanR * 0.16, bladeDepth * 0.55, 16)
  hub.rotateX(Math.PI / 2)
  ctx.add(hub, housingMat, rotor)

  return { rotor, bladeMat, fanR }
}

export function addPictureFrame(
  ctx:    HvacCtx,
  parent: THREE.Object3D,
  x:      number,
  h:      number,
  w:      number,
  bar:    number,
  depth:  number,
  mat:    THREE.Material,
) {
  ctx.add(new THREE.BoxGeometry(depth, bar, w), mat, parent).position.set(x,  h / 2 - bar / 2, 0)
  ctx.add(new THREE.BoxGeometry(depth, bar, w), mat, parent).position.set(x, -h / 2 + bar / 2, 0)
  const sideH = h - bar * 2
  ctx.add(new THREE.BoxGeometry(depth, sideH, bar), mat, parent).position.set(x, 0,  w / 2 - bar / 2)
  ctx.add(new THREE.BoxGeometry(depth, sideH, bar), mat, parent).position.set(x, 0, -w / 2 + bar / 2)
}

export function buildDamper(
  ctx:     HvacCtx,
  parent:  THREE.Object3D,
  hy:      number,
  hz:      number,
  centerX: number,
): THREE.Mesh[] {
  const frameMat = ctx.metal(0x3a424b, 0.6,  0.4)
  const bladeMat = ctx.metal(0xb7c0c7, 0.45, 0.4)
  const frameH = hy * 0.95
  const frameW = hz * 1.05
  const bar    = Math.min(hy, hz) * 0.07
  const depth  = bar * 0.85
  addPictureFrame(ctx, parent, centerX, frameH, frameW, bar, depth, frameMat)

  // Thin slats with a wide gap, so the damper does not read as a solid panel.
  const count  = 5
  const innerH = frameH - bar * 2
  const stride = innerH / count
  const chord  = stride * 0.28
  const bladeW = frameW - bar * 2.4
  const blades: THREE.Mesh[] = []
  const geo = new THREE.BoxGeometry(Math.max(depth * 0.18, chord * 0.22), chord, bladeW)
  for (let i = 0; i < count; i++) {
    const y = -innerH / 2 + (i + 0.5) * stride
    const b = ctx.add(geo, bladeMat, parent)
    b.position.set(centerX, y, 0)
    blades.push(b)
  }

  const actMat  = ctx.metal(0x5c6770, 0.45, 0.4)
  const dialMat = ctx.metal(0xf5c542, 0.35, 0.45)
  const act  = Math.min(hy, hz) * 0.14
  const actX = centerX - depth * 0.9
  const actY = -frameH * 0.28
  const actZ = -frameW * 0.32
  ctx.add(new THREE.BoxGeometry(depth * 1.4, act, act * 0.72), actMat, parent)
    .position.set(actX, actY, actZ)
  const dial = new THREE.CylinderGeometry(act * 0.34, act * 0.34, depth * 0.35, 16)
  dial.rotateZ(Math.PI / 2)
  ctx.add(dial, dialMat, parent).position.set(actX - depth * 0.7, actY, actZ)
  return blades
}

export function buildPanelFilter(
  ctx:     HvacCtx,
  parent:  THREE.Object3D,
  hy:      number,
  hz:      number,
  centerX: number,
): THREE.MeshStandardMaterial {
  const frameMat = ctx.metal(0x4a5568, 0.5,  0.45)
  const mediaMat = ctx.metal(FILTER_CLEAN, 0.12, 0.72)
  const crossMat = ctx.metal(0x3d4650, 0.45, 0.5)
  const frameH = hy * 0.9
  const frameW = hz * 1.05
  const bar    = Math.min(hy, hz) * 0.07
  const depth  = bar * 0.9
  addPictureFrame(ctx, parent, centerX, frameH, frameW, bar, depth, frameMat)

  const innerH = frameH - bar * 2
  const innerW = frameW - bar * 2
  ctx.add(new THREE.BoxGeometry(depth * 0.35, innerH * 0.98, innerW * 0.98), mediaMat, parent)
    .position.set(centerX, 0, 0)

  const span = Math.hypot(innerH, innerW) * 0.9
  const thick = Math.min(innerH, innerW) * 0.045
  const arm = new THREE.BoxGeometry(depth * 0.55, span, thick)
  const tilt = Math.atan2(innerW, innerH)
  const d1 = ctx.add(arm, crossMat, parent)
  d1.position.set(centerX + depth * 0.2, 0, 0)
  d1.rotation.x = tilt
  const d2 = ctx.add(arm, crossMat, parent)
  d2.position.set(centerX + depth * 0.2, 0, 0)
  d2.rotation.x = -tilt
  return mediaMat
}

export function buildBagFilter(
  ctx:     HvacCtx,
  parent:  THREE.Object3D,
  hy:      number,
  hz:      number,
  hx:      number,
  centerX: number,
): THREE.MeshStandardMaterial {
  const frameMat = ctx.metal(0x4a5568, 0.5,  0.45)
  const mediaMat = ctx.metal(FILTER_CLEAN, 0.18, 0.68)
  const frameH = hy * 0.9
  const frameW = hz * 1.05
  const bar    = Math.min(hy, hz) * 0.07
  const depth  = bar * 0.9
  addPictureFrame(ctx, parent, centerX, frameH, frameW, bar, depth, frameMat)

  // Shallow vertical pleats, one panel. Deep pockets were reading as steps on the coil.
  const pleats = 7
  const innerH = frameH - bar * 2.4
  const innerW = frameW - bar * 2.2
  const stride = innerW / pleats
  const pleatD = Math.min(hx * 0.04, hy * 0.09)
  const geo = new THREE.BoxGeometry(pleatD, innerH, stride * 0.55)
  for (let i = 0; i < pleats; i++) {
    const z = -innerW / 2 + (i + 0.5) * stride
    const x = centerX + (i % 2 === 0 ? pleatD * 0.35 : -pleatD * 0.15)
    ctx.add(geo, mediaMat, parent).position.set(x, 0, z)
  }
  return mediaMat
}

export function buildSensorProbe(
  ctx:    HvacCtx,
  parent: THREE.Object3D,
  x:      number,
  y:      number,
  z:      number,
  hy:     number,
  tint:   number,
) {
  const headMat = ctx.metal(tint, 0.25, 0.4)
  const stemMat = ctx.metal(0xe5e7eb, 0.55, 0.35)
  const s = Math.max(hy * 0.11, 0.03)
  ctx.add(new THREE.BoxGeometry(s, s * 0.5, s * 0.72), headMat, parent).position.set(x, y, z)
  const probeLen = hy * 0.14
  ctx.add(new THREE.CylinderGeometry(s * 0.06, s * 0.06, probeLen, 8), stemMat, parent)
    .position.set(x, y - probeLen / 2 - s * 0.25, z)
}

/** The square frame a supply fan sits in, so the wheel reads from above. */
export function buildFanOpening(
  ctx:    HvacCtx,
  parent: THREE.Object3D,
  fanX:   number,
  fanR:   number,
) {
  const frameMat = ctx.metal(0x2a313a, 0.5, 0.45)
  const opening = fanR * 2.15
  const rail = fanR * 0.14
  const railD = fanR * 0.28
  ctx.add(new THREE.BoxGeometry(railD, rail, opening), frameMat, parent).position.set(fanX,  opening / 2 - rail / 2, 0)
  ctx.add(new THREE.BoxGeometry(railD, rail, opening), frameMat, parent).position.set(fanX, -opening / 2 + rail / 2, 0)
  ctx.add(new THREE.BoxGeometry(railD, opening - rail * 2, rail), frameMat, parent).position.set(fanX, 0,  opening / 2 - rail / 2)
  ctx.add(new THREE.BoxGeometry(railD, opening - rail * 2, rail), frameMat, parent).position.set(fanX, 0, -opening / 2 + rail / 2)
}

/**
 * A heat-pipe coil: vertical copper pipes in two rows through horizontal fins,
 * with a header box top and bottom. Reads differently from the cooling coil,
 * whose tubes run across the duct.
 */
export function buildHeatPipe(
  ctx:     HvacCtx,
  parent:  THREE.Object3D,
  hy:      number,
  hz:      number,
  centerX: number,
) {
  const frameMat  = ctx.metal(0x4a5568, 0.5, 0.45)
  const pipeMat   = ctx.metal(0xb87333, 0.7, 0.32)
  const finMat    = ctx.metal(0xe2e8ee, 0.3, 0.45)
  const headerMat = ctx.metal(0x8a5a2b, 0.6, 0.4)
  const frameH = hy * 0.9
  const frameW = hz * 1.05
  const bar    = Math.min(hy, hz) * 0.07
  const depth  = bar * 2.4
  addPictureFrame(ctx, parent, centerX, frameH, frameW, bar, bar * 0.9, frameMat)

  const innerH = frameH - bar * 2
  const innerW = frameW - bar * 2
  const pipes  = 9
  const pipeR  = Math.min(innerW / pipes * 0.16, depth * 0.14)
  const pipeH  = innerH * 0.94
  const pipe   = new THREE.CylinderGeometry(pipeR, pipeR, pipeH, 10)
  for (const dx of [-depth * 0.22, depth * 0.22]) {
    for (let i = 0; i < pipes; i++) {
      const z = -innerW / 2 + (i + 0.5) * (innerW / pipes) + (dx > 0 ? innerW / pipes * 0.25 : 0)
      ctx.add(pipe, pipeMat, parent).position.set(centerX + dx, 0, z)
    }
  }

  const fins = 14
  const fin  = new THREE.BoxGeometry(depth, Math.max(pipeR * 0.25, innerH * 0.006), innerW * 0.97)
  for (let i = 0; i < fins; i++) {
    ctx.add(fin, finMat, parent).position.set(centerX, -pipeH / 2 + (i + 0.5) * (pipeH / fins), 0)
  }

  const header = new THREE.BoxGeometry(depth * 0.9, bar * 0.8, innerW * 0.98)
  ctx.add(header, headerMat, parent).position.set(centerX,  pipeH / 2, 0)
  ctx.add(header, headerMat, parent).position.set(centerX, -pipeH / 2, 0)
}

/** A UV-C canister standing in the airstream: lamp body, dark cap and a gauge on top. Returns the body material. */
export function buildUvCanister(
  ctx:     HvacCtx,
  parent:  THREE.Object3D,
  hy:      number,
  hz:      number,
  centerX: number,
): THREE.MeshStandardMaterial {
  const bodyMat  = ctx.metal(NO_DATA, 0.3, 0.35)
  const capMat   = ctx.metal(0x1f2933, 0.5, 0.4)
  const gaugeMat = ctx.metal(0xe5e7eb, 0.4, 0.4)
  const r     = Math.min(hz * 0.22, hy * 0.28)
  const bodyH = hy * 1.3
  const bodyY = -hy * 0.15
  ctx.add(new THREE.CylinderGeometry(r, r, bodyH, 24), bodyMat, parent).position.set(centerX, bodyY, 0)
  const capH = bodyH * 0.12
  const capY = bodyY + bodyH / 2 + capH / 2
  ctx.add(new THREE.CylinderGeometry(r * 1.15, r * 1.15, capH, 24), capMat, parent).position.set(centerX, capY, 0)
  const neckH = r * 0.3
  ctx.add(new THREE.CylinderGeometry(r * 0.12, r * 0.12, neckH, 10), capMat, parent)
    .position.set(centerX, capY + capH / 2 + neckH / 2, 0)
  const dial = new THREE.CylinderGeometry(r * 0.28, r * 0.28, r * 0.14, 20)
  dial.rotateX(Math.PI / 2)
  ctx.add(dial, gaugeMat, parent).position.set(centerX, capY + capH / 2 + neckH + r * 0.28, 0)
  return bodyMat
}
