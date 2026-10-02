import * as THREE from 'three'
import { unwatchClipping, watchClipping } from '@/lib/sliceTool'

export type FcuPoint = { navName?: string; currentValue?: string | null }

export type FcuReading = {
  zoneTemp: string
  valvePos: string
  valveCmd: string
  fanSpeed: string
  fanRun: string
  /** 0 closed, 1 open. Null when the valve position is not reporting. */
  valveOpen: number | null
  fanOn: boolean
  /** Radians per second. Zero when the fan is off or not reporting. */
  fanRate: number
}

export type FcuAnchor = {
  key: 'zoneTemp' | 'valvePos' | 'valveCmd' | 'fanSpeed' | 'fanRun'
  position: THREE.Vector3
  side: 'above' | 'below'
}

export type FcuSchematic = {
  group: THREE.Group
  anchors: FcuAnchor[]
  apply: (points: FcuPoint[]) => FcuReading
  tick: (dt: number) => void
  dispose: () => void
}

const CLOSED = new THREE.Color(0x7f8c9a)
const OPEN = new THREE.Color(0xb56a3c)
const IDLE = new THREE.Color(0x8d939b)
const FAN_ON = new THREE.Color(0xc0392b)
const FAN_OFF = new THREE.Color(0x4b5563)

const noRaycast = () => {}

function keyOf(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function clean(value: string | null | undefined): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s || s === '—' || s === '--' || s === 'N/A' || /^null$/i.test(s)) return null
  return s
}

function numberOf(raw: string | null): number | null {
  if (!raw) return null
  const m = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = parseFloat(m[0])
  return Number.isFinite(n) ? n : null
}

function find(points: FcuPoint[], test: (key: string) => boolean): FcuPoint | null {
  for (const p of points) {
    if (test(keyOf(p.navName || ''))) return p
  }
  return null
}

function shown(raw: string | null, unit: string): string {
  if (!raw) return '—'
  const upper = raw.trim().toUpperCase()
  if (upper === 'T' || upper === 'TRUE' || upper === 'ON' || upper === 'RUN' || upper === 'RUNNING') return 'On'
  if (upper === 'F' || upper === 'FALSE' || upper === 'OFF' || upper === 'STOP' || upper === 'STOPPED') return 'Off'
  const n = numberOf(raw)
  if (n != null && unit && !raw.includes(unit) && !/[a-zA-Z°]/.test(raw)) {
    const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
    return text + unit
  }
  return raw
}

function fanOn(raw: string | null): boolean {
  if (!raw) return false
  const upper = raw.trim().toUpperCase()
  if (['ON', 'RUN', 'RUNNING', 'TRUE', 'T', 'START', 'YES'].includes(upper)) return true
  if (['OFF', 'STOP', 'STOPPED', 'FALSE', 'F', 'NO'].includes(upper)) return false
  const n = numberOf(raw)
  return n != null && n > 0
}

/** Live FCU points, matched by name. A missing point stays blank. */
export function readFcuPoints(points: FcuPoint[]): FcuReading {
  const zone = clean(find(points, k => k.includes('zonetemp') && !k.includes('set') && !k.endsWith('sp'))?.currentValue)
  const pos = clean(find(points, k => k.includes('coolingvalvepos') || (k.includes('valve') && k.includes('pos') && !k.includes('cmd')))?.currentValue)
  const cmd = clean(find(points, k => k.includes('coolingvalvecmd') || (k.includes('valve') && (k.includes('cmd') || k.includes('command'))))?.currentValue)
  const speed = clean(find(points, k => k.includes('fanspeed'))?.currentValue)
  const run = clean(find(points, k => k.includes('fanrun') || k === 'fanstatus')?.currentValue)
  const posN = numberOf(pos)
  let valveOpen: number | null = null
  if (posN != null) {
    const fraction = posN <= 1 && !pos!.includes('%')
    valveOpen = Math.min(1, Math.max(0, fraction ? posN : posN / 100))
  }
  const on = fanOn(run)
  const speedN = numberOf(speed)
  let fanRate = 0
  if (on) {
    fanRate = speedN == null ? 1.6 : 0.5 + 2.6 * (Math.min(100, Math.max(0, speedN > 1 ? speedN : speedN * 100)) / 100)
  }
  return {
    zoneTemp: shown(zone, ' °C'),
    valvePos: shown(pos, ' %'),
    valveCmd: shown(cmd, ' %'),
    fanSpeed: shown(speed, ' %'),
    fanRun: shown(run, ''),
    valveOpen,
    fanOn: on,
    fanRate,
  }
}

/** Vertices of the casing, in the same space as the highlight group. */
function casingCloud(root: THREE.Object3D): THREE.Vector3[] {
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

/** Eigenvectors of a symmetric 3×3, as columns of V. */
function eigenAxes(m00: number, m01: number, m02: number, m11: number, m12: number, m22: number) {
  const A = [[m00, m01, m02], [m01, m11, m12], [m02, m12, m22]]
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let iter = 0; iter < 16; iter++) {
    let p = 0, q = 1, max = Math.abs(A[0][1])
    if (Math.abs(A[0][2]) > max) { max = Math.abs(A[0][2]); p = 0; q = 2 }
    if (Math.abs(A[1][2]) > max) { max = Math.abs(A[1][2]); p = 1; q = 2 }
    if (max < 1e-12) break
    const app = A[p][p], aqq = A[q][q], apq = A[p][q]
    const tau = (aqq - app) / (2 * apq || 1e-12)
    const tt = Math.sign(tau || 1) / (Math.abs(tau) + Math.hypot(1, tau))
    const c = 1 / Math.hypot(1, tt)
    const s = tt * c
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

/**
 * The casing is often turned in plan. Its axis-aligned box stays straight, so
 * parts fitted to that box sit across the real unit. Follow the mesh instead.
 */
function frameFromCasing(root: THREE.Object3D, localUp: THREE.Vector3) {
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
  let upI = 0
  let best = -1
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
  const upSpan = spanOf(up)
  const widthSpan = spanOf(width)
  if (longSpan.half < 0.05 || upSpan.half < 0.05 || widthSpan.half < 0.05) return null
  const center = mid.clone()
    .addScaledVector(long, longSpan.mid)
    .addScaledVector(up, upSpan.mid)
    .addScaledVector(width, widthSpan.mid)
  return { center, long, up, width, hx: longSpan.half, hy: upSpan.half, hz: widthSpan.half }
}

/**
 * Coil, valve, fan and probe fitted to one FCU's own box.
 * Length follows the casing. Up is the casing axis closest to world up.
 * The selection's depth pass is the solid casing, so the caller hides that pass
 * and these parts depth-test only against each other.
 */
export function createFcuSchematic(localBox: THREE.Box3, modelMatrix: THREE.Matrix4, casing?: THREE.Object3D): FcuSchematic | null {
  if (!localBox || localBox.isEmpty()) return null
  const size = localBox.getSize(new THREE.Vector3())
  const dims = [size.x, size.y, size.z]
  if (dims.some(d => d < 0.05)) return null

  const localUp = new THREE.Vector3(0, 1, 0).transformDirection(new THREE.Matrix4().copy(modelMatrix).invert())
  const fitted = casing ? frameFromCasing(casing, localUp) : null
  let center: THREE.Vector3
  let long: THREE.Vector3
  let up: THREE.Vector3
  let width: THREE.Vector3
  let hx: number
  let hy: number
  let hz: number
  if (fitted) {
    ({ center, long, up, width, hx, hy, hz } = fitted)
  } else {
    center = localBox.getCenter(new THREE.Vector3())
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
    let upI = 1
    let best = -1
    axes.forEach((axis, i) => {
      const a = Math.abs(axis.dot(localUp))
      if (a > best) { best = a; upI = i }
    })
    if (axes[upI].dot(localUp) < 0) axes[upI].negate()
    let longI = 0
    let longS = -1
    for (let i = 0; i < 3; i++) {
      if (i === upI) continue
      if (dims[i] > longS) { longS = dims[i]; longI = i }
    }
    const widthI = 3 - upI - longI
    long = axes[longI]
    up = axes[upI]
    width = new THREE.Vector3().crossVectors(long, up).normalize()
    hx = dims[longI] / 2
    hy = dims[upI] / 2
    hz = dims[widthI] / 2
  }

  const group = new THREE.Group()
  group.position.copy(center)
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(long, up, width))
  group.userData.ekoFcu = true

  const geoms = new Set<THREE.BufferGeometry>()
  const mats: THREE.Material[] = []
  const metal = (color: THREE.Color | number, metalness: number, roughness: number) => {
    const m = new THREE.MeshStandardMaterial({
      color, metalness, roughness, envMapIntensity: 1, toneMapped: false,
    })
    watchClipping(m)
    mats.push(m)
    return m
  }
  const add = (geom: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = group) => {
    geoms.add(geom)
    const mesh = new THREE.Mesh(geom, material)
    mesh.raycast = noRaycast
    mesh.renderOrder = 3
    mesh.userData.ekoFcu = true
    mesh.castShadow = false
    mesh.receiveShadow = false
    parent.add(mesh)
    return mesh
  }

  const span = Math.min(hy, hz)
  const coilMat = metal(IDLE, 0.62, 0.34)
  const finMat = metal(0xf3f6f8, 0.28, 0.46)
  const rowsY = 4
  const yBot = -hy * 0.2
  const yTop = hy * 0.52
  const dy = (yTop - yBot) / (rowsY - 1)
  const tubeR = Math.min(dy * 0.3, span * 0.055)
  const coilX = -hx * 0.12
  const dx = dy * 0.85
  const tubeLen = Math.min(hz * 1.65, hx * 0.62)
  const xs = [coilX - dx * 0.5, coilX + dx * 0.5]
  const tube = new THREE.CylinderGeometry(tubeR, tubeR, tubeLen, 16)
  tube.rotateX(Math.PI / 2)
  for (const x of xs) {
    for (let i = 0; i < rowsY; i++) {
      const mesh = add(tube, coilMat)
      mesh.position.set(x, yBot + i * dy, 0)
    }
  }
  // Half ring in the YZ plane: ends meet the two tube centerlines, crown points out past the fin pack.
  const bow = new THREE.TorusGeometry(dy / 2, tubeR * 0.96, 8, 14, Math.PI)
  bow.rotateZ(Math.PI / 2)
  bow.rotateY(Math.PI / 2)
  for (const x of xs) {
    for (let i = 0; i < rowsY - 1; i++) {
      const positive = i % 2 === 0
      const bend = add(bow, coilMat)
      bend.position.set(x, yBot + (i + 0.5) * dy, positive ? tubeLen / 2 : -tubeLen / 2)
      if (!positive) bend.rotation.y = Math.PI
    }
  }
  const finH = (yTop - yBot) + tubeR * 3
  const finD = dx + tubeR * 8
  const finT = Math.max(tubeLen * 0.008, tubeR * 0.22)
  const fin = new THREE.BoxGeometry(finD, finH, finT)
  const finN = 26
  const finSpan = tubeLen * 0.84
  for (let i = 0; i < finN; i++) {
    const plate = add(fin, finMat)
    plate.position.set(coilX, (yTop + yBot) / 2, -finSpan / 2 + (i + 0.5) * (finSpan / finN))
  }
  const tray = add(new THREE.BoxGeometry(finD * 1.15, hy * 0.03, tubeLen * 0.72), metal(0x3a424b, 0.48, 0.5))
  tray.position.set(coilX, yBot - tubeR * 2.4, tubeLen * 0.06)

  const valveMat = metal(0x3a424c, 0.58, 0.38)
  const actMat = metal(0x5c6772, 0.08, 0.55)
  const valveX = xs[0]
  const valveZ = -tubeLen / 2
  const valveY = yBot - hy * 0.5
  const bodyH = hy * 0.15
  const valve = add(new THREE.CylinderGeometry(span * 0.05, span * 0.066, bodyH, 14), valveMat)
  valve.position.set(valveX, valveY, valveZ)
  const stemH = hy * 0.045
  const stem = add(new THREE.CylinderGeometry(span * 0.016, span * 0.016, stemH, 8), valveMat)
  stem.position.set(valveX, valveY - bodyH / 2 - stemH / 2, valveZ)
  const actH = hy * 0.08
  const actY = valveY - bodyH / 2 - stemH - actH / 2
  const act = add(new THREE.BoxGeometry(span * 0.18, actH, span * 0.14), actMat)
  act.position.set(valveX, actY, valveZ)
  const valveTop = valveY + bodyH / 2
  const feedLen = Math.max(tubeR * 2, yBot - valveTop)
  const feed = new THREE.CylinderGeometry(tubeR * 0.85, tubeR * 0.85, feedLen, 10)
  const feedMesh = add(feed, coilMat)
  feedMesh.position.set(valveX, valveTop + feedLen / 2, valveZ)
  const stubLen = Math.min(hz * 0.16, Math.max(tubeR * 2, hz - Math.abs(valveZ) - tubeR * 2))
  const stub = new THREE.CylinderGeometry(tubeR * 0.85, tubeR * 0.85, stubLen, 10)
  stub.rotateX(Math.PI / 2)
  const stubMesh = add(stub, coilMat)
  stubMesh.position.set(valveX, valveY, valveZ - stubLen / 2)

  const housingMat = metal(0x2a313a, 0.5, 0.4)
  housingMat.side = THREE.DoubleSide
  const bladeMat = metal(FAN_OFF, 0.4, 0.38)
  bladeMat.side = THREE.DoubleSide
  const fanR = Math.min(hy * 0.8, hz * 0.4)
  const fanX = hx * 0.48
  const bladeDepth = Math.min(hz * 0.4, fanR * 0.95)
  const scroll = new THREE.CylinderGeometry(fanR * 1.05, fanR * 1.05, bladeDepth * 1.02, 32, 1, true)
  scroll.rotateX(Math.PI / 2)
  // fanPivot rotates the entire blower 90° so the disc faces along X (parallel to the narrow end)
  const fanPivot = new THREE.Group()
  fanPivot.position.set(fanX, 0, 0)
  fanPivot.rotation.y = Math.PI / 2
  group.add(fanPivot)
  const scrollMesh = add(scroll, housingMat, fanPivot)
  scrollMesh.position.set(0, 0, 0)
  const motorLen = bladeDepth * 0.72
  const motor = new THREE.CylinderGeometry(fanR * 0.2, fanR * 0.25, motorLen, 16)
  motor.rotateX(Math.PI / 2)
  const motorMesh = add(motor, housingMat, fanPivot)
  motorMesh.position.set(0, 0, bladeDepth * 0.5 + motorLen * 0.42)
  const flange = new THREE.CylinderGeometry(fanR * 0.3, fanR * 0.3, bladeDepth * 0.08, 16)
  flange.rotateX(Math.PI / 2)
  const flangeMesh = add(flange, housingMat, fanPivot)
  flangeMesh.position.set(0, 0, bladeDepth * 0.5)

  const rotor = new THREE.Group()
  rotor.position.set(0, 0, 0)
  const bladeShape = new THREE.Shape()
  const r0 = fanR * 0.3
  const r1 = fanR * 0.9
  const bt = fanR * 0.042
  bladeShape.moveTo(r0, -bt * 0.2)
  bladeShape.quadraticCurveTo((r0 + r1) * 0.5, bt * 1.15, r1, bt * 2.3)
  bladeShape.lineTo(r1 - fanR * 0.035, bt * 2.3 - bt)
  bladeShape.quadraticCurveTo((r0 + r1) * 0.48, -bt * 0.2, r0, -bt * 1.35)
  bladeShape.closePath()
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: bladeDepth * 0.7, bevelEnabled: false, curveSegments: 8 })
  bladeGeo.translate(0, 0, -bladeDepth * 0.35)
  const blades = 12
  for (let i = 0; i < blades; i++) {
    const mesh = add(bladeGeo, bladeMat, rotor)
    mesh.rotation.z = (i / blades) * Math.PI * 2
  }
  const rim = new THREE.TorusGeometry(fanR * 0.92, fanR * 0.032, 8, 28)
  const rimA = add(rim, housingMat, rotor)
  rimA.position.z = bladeDepth * 0.34
  const rimB = add(rim, housingMat, rotor)
  rimB.position.z = -bladeDepth * 0.34
  const hub = new THREE.CylinderGeometry(fanR * 0.16, fanR * 0.16, bladeDepth * 0.55, 16)
  hub.rotateX(Math.PI / 2)
  add(hub, housingMat, rotor)
  fanPivot.add(rotor)

  const probeMat = metal(0xe7edf2, 0.82, 0.18)
  const probeX = -hx * 0.78
  const headH = hy * 0.07
  const probeHead = add(new THREE.BoxGeometry(span * 0.16, headH, span * 0.11), probeMat)
  probeHead.position.set(probeX, hy - headH * 0.7, 0)
  const stemLen = hy * 0.95
  const probeStem = add(new THREE.CylinderGeometry(tubeR * 0.5, tubeR * 0.42, stemLen, 12), probeMat)
  probeStem.position.set(probeX, hy - headH * 0.7 - stemLen / 2, 0)
  const probeTip = add(new THREE.SphereGeometry(tubeR * 0.95, 14, 10), probeMat)
  probeTip.position.set(probeX, hy - headH * 0.7 - stemLen, 0)

  const anchors: FcuAnchor[] = [
    { key: 'zoneTemp', position: new THREE.Vector3(probeX, hy * 0.92, 0), side: 'above' },
    { key: 'valvePos', position: new THREE.Vector3(coilX, hy * 0.92, 0), side: 'above' },
    { key: 'valveCmd', position: new THREE.Vector3(valveX, actY - hy * 0.2, valveZ), side: 'below' },
    { key: 'fanSpeed', position: new THREE.Vector3(fanX, fanR * 1.2 + hy * 0.08, 0), side: 'above' },
    { key: 'fanRun', position: new THREE.Vector3(fanX, -fanR * 1.15, 0), side: 'below' },
  ]

  let rate = 0
  const apply = (points: FcuPoint[]) => {
    const reading = readFcuPoints(points || [])
    if (reading.valveOpen == null) coilMat.color.copy(IDLE)
    else coilMat.color.copy(CLOSED).lerp(OPEN, reading.valveOpen)
    bladeMat.color.copy(reading.fanOn ? FAN_ON : FAN_OFF)
    rate = reading.fanRate
    return reading
  }
  apply([])

  return {
    group,
    anchors,
    apply,
    tick: (dt) => { if (rate) rotor.rotation.z += rate * dt },
    dispose: () => {
      group.removeFromParent()
      geoms.forEach(g => g.dispose())
      mats.forEach(m => { unwatchClipping(m); m.dispose() })
    },
  }
}
