import * as THREE from 'three'
import {
  HvacPoint, HvacCtx,
  COIL_CLOSED, COIL_OPEN, COIL_IDLE, FAN_ON, FAN_OFF,
  clean, numberOf, findPoint, isRunning,
  makeHvacCtx,
  buildCoil, buildValve, buildCentrifugalFan,
} from '@/lib/hvacGeometry'

/**
 * FAHU-ANC09-BF-01 is four swept solids in the MEP model
 * (guid 17wh38Lq5AGPYCI8KEuqza), not the Spaces file.
 * Lower casing 5504 x 2036 x 750 mm, upper casing 1800 x 2036 x 750 mm
 * sitting on the -X end, plus a 50 mm slab and a 50 mm plate between
 * the decks. The schematic uses the two casings and leaves the slab out.
 * Supply air runs the full lower deck. The exhaust fan, both wheels, the
 * return filter, and the return sensors stay inside the short upper deck.
 * Fourteen unlabeled probes follow the graphic: fresh air, both wheels,
 * off-coil, return air, and supply air. Pale blue is humidity, white is
 * temperature.
 */

export type FahuPoint = HvacPoint

export type FahuReading = {
  eaDamperOpen: number | null
  saDamperOpen: number | null
  preFilterDirty: boolean
  bagFilterDirty: boolean
  raFilterDirty: boolean
  coolingValvePos: number | null
  efFanOn: boolean
  sfFanOn: boolean
  hrwOn: boolean
  sensibleOn: boolean
}

export type FahuSchematic = {
  group: THREE.Group
  apply: (points: FahuPoint[]) => FahuReading
  tick: (dt: number) => void
  dispose: () => void
}

const FILTER_CLEAN = new THREE.Color(0xc8d6df)
const FILTER_DIRTY = new THREE.Color(0x9c6b2e)
const SLAB_M = 0.18

type Deck = { min: THREE.Vector3; max: THREE.Vector3 }

type FahuFrame = {
  center: THREE.Vector3
  long: THREE.Vector3
  up: THREE.Vector3
  width: THREE.Vector3
  lower: Deck
  upper: Deck
}

function geomSize(mesh: THREE.Mesh): THREE.Vector3 | null {
  const attr = mesh.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!attr || attr.count < 2) return null
  const box = new THREE.Box3().setFromBufferAttribute(attr)
  return box.getSize(new THREE.Vector3()).multiply(mesh.scale)
}

function isSlab(size: THREE.Vector3): boolean {
  const dims = [size.x, size.y, size.z].sort((a, b) => a - b)
  return dims[0] < SLAB_M
}

function resolveFahuFrame(casing: THREE.Object3D): FahuFrame | null {
  const meshes: THREE.Mesh[] = []
  casing.updateMatrixWorld(true)
  casing.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && mesh.userData?.ekoGhostDepth) meshes.push(mesh)
  })
  if (!meshes.length) return null

  let bodyQuat: THREE.Quaternion | null = null
  let bestVol = 0
  for (const mesh of meshes) {
    const size = geomSize(mesh)
    if (!size || isSlab(size)) continue
    const vol = size.x * size.y * size.z
    if (vol <= bestVol) continue
    bestVol = vol
    bodyQuat = mesh.quaternion.clone()
  }
  if (!bodyQuat) return null

  const qInv = bodyQuat.clone().invert()
  const toLocal = new THREE.Matrix4().copy(casing.matrixWorld).invert()
  const v = new THREE.Vector3()
  const boxes: THREE.Box3[] = []
  for (const mesh of meshes) {
    const size = geomSize(mesh)
    if (!size || isSlab(size)) continue
    const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    const box = new THREE.Box3()
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i)
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(toLocal)
        .applyQuaternion(qInv)
      box.expandByPoint(v)
    }
    if (!box.isEmpty()) boxes.push(box)
  }
  if (!boxes.length) return null

  const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(qInv)
  const frameAxes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ]
  let upI = 0
  let best = -1
  frameAxes.forEach((axis, i) => {
    const a = Math.abs(axis.dot(localUp))
    if (a > best) { best = a; upI = i }
  })
  const upFrame = frameAxes[upI].clone()
  if (upFrame.dot(localUp) < 0) upFrame.negate()

  const along = (p: THREE.Vector3, axis: number) =>
    axis === 0 ? p.x : axis === 1 ? p.y : p.z
  const sizeOf = (box: THREE.Box3) => box.getSize(new THREE.Vector3())
  let lower = boxes[0]
  let lowerMax = Math.max(sizeOf(lower).x, sizeOf(lower).y, sizeOf(lower).z)
  for (const box of boxes) {
    const s = sizeOf(box)
    const m = Math.max(s.x, s.y, s.z)
    if (m > lowerMax) { lower = box; lowerMax = m }
  }
  const lowerCenter = lower.getCenter(new THREE.Vector3())
  let upper: THREE.Box3 | null = null
  let upperLift = 0
  for (const box of boxes) {
    if (box === lower) continue
    const rise = along(box.getCenter(new THREE.Vector3()), upI) - along(lowerCenter, upI)
    if (!upper || rise > upperLift) { upper = box; upperLift = rise }
  }
  if (!upper || upperLift < 0.2) return null

  const lowerSize = sizeOf(lower)
  const span = [lowerSize.x, lowerSize.y, lowerSize.z]
  let longI = upI === 0 ? 1 : 0
  for (let i = 0; i < 3; i++) {
    if (i !== upI && span[i] > span[longI]) longI = i
  }
  const longFrame = frameAxes[longI].clone()
  const upperCenter = upper.getCenter(new THREE.Vector3())
  if (upperCenter.clone().sub(lowerCenter).dot(longFrame) > 0) longFrame.negate()

  const long = longFrame.clone().applyQuaternion(bodyQuat)
  const up = upFrame.clone().applyQuaternion(bodyQuat)
  const width = new THREE.Vector3().crossVectors(long, up).normalize()
  const center = lowerCenter.clone().applyQuaternion(bodyQuat)

  const basisInv = new THREE.Matrix4().makeBasis(long, up, width).invert()
  const project = (p: THREE.Vector3) =>
    p.clone().applyQuaternion(bodyQuat).sub(center).applyMatrix4(basisInv)

  const deckOf = (box: THREE.Box3): Deck => {
    const deck = new THREE.Box3()
    const min = box.min
    const max = box.max
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) deck.expandByPoint(project(new THREE.Vector3(x, y, z)))
      }
    }
    return { min: deck.min.clone(), max: deck.max.clone() }
  }

  return { center, long, up, width, lower: deckOf(lower), upper: deckOf(upper) }
}

function damperOpen(raw: string | null): number | null {
  if (raw == null) return null
  const upper = raw.trim().toUpperCase()
  if (['F', 'FALSE', 'OFF', 'CLOSED', 'STOP', 'STOPPED'].includes(upper)) return 0
  if (isRunning(raw) && numberOf(raw) == null) return 1
  const n = numberOf(raw)
  if (n == null) return null
  const frac = n <= 1 && !raw.includes('%')
  return Math.min(1, Math.max(0, frac ? n : n / 100))
}

export function readFahuPoints(points: FahuPoint[]): FahuReading {
  const val = (test: (k: string) => boolean) =>
    clean(findPoint(points, test)?.currentValue)

  const eaRaw = val(k => k.includes('eadamper'))
  const saRaw = val(k => k.includes('sadamper') || (k.includes('fadamper') && !k.includes('ea')))
  const preRaw = val(k => k.includes('prefilter'))
  const bagRaw = val(k => k.includes('bagfilter') || (k.includes('bag') && k.includes('filter')))
  const raRaw = val(k => k.includes('rafilter'))
  const cvRaw = val(k =>
    k.includes('coolingvalvepos') ||
    (k.includes('coolingvalve') && k.includes('pos') && !k.includes('cmd')))
  const efRaw = val(k => k.includes('efairflow') || k.endsWith('efvfdrunsts'))
  const sfRaw = val(k => k.includes('sfairflow') || k.endsWith('sfvfdrunsts'))
  const hrwRaw = val(k => k.endsWith('hrwcmd'))
  const hrwPos = val(k => k.includes('hrw') && k.includes('spd') && k.includes('pos'))
  const sensRaw = val(k => k.endsWith('sensiblecmd'))
  const sensPos = val(k => k.includes('sensible') && k.includes('spd') && k.includes('pos'))

  const cvN = numberOf(cvRaw)
  let coolingValvePos: number | null = null
  if (cvN != null) {
    const frac = cvN <= 1 && !cvRaw!.includes('%')
    coolingValvePos = Math.min(1, Math.max(0, frac ? cvN : cvN / 100))
  }

  const speedOn = (raw: string | null) => {
    const n = numberOf(raw)
    return n != null && n > 1
  }

  return {
    eaDamperOpen: damperOpen(eaRaw),
    saDamperOpen: damperOpen(saRaw),
    preFilterDirty: preRaw != null && /dirty|alarm|fault|high/i.test(preRaw),
    bagFilterDirty: bagRaw != null && /dirty|alarm|fault|high/i.test(bagRaw),
    raFilterDirty: raRaw != null && /dirty|alarm|fault|high/i.test(raRaw),
    coolingValvePos,
    efFanOn: isRunning(efRaw),
    sfFanOn: isRunning(sfRaw),
    hrwOn: isRunning(hrwRaw) || speedOn(hrwPos),
    sensibleOn: isRunning(sensRaw) || speedOn(sensPos),
  }
}

function addPictureFrame(
  ctx: HvacCtx,
  parent: THREE.Object3D,
  x: number,
  y: number,
  h: number,
  w: number,
  bar: number,
  depth: number,
  mat: THREE.Material,
) {
  ctx.add(new THREE.BoxGeometry(depth, bar, w), mat, parent).position.set(x, y + h / 2 - bar / 2, 0)
  ctx.add(new THREE.BoxGeometry(depth, bar, w), mat, parent).position.set(x, y - h / 2 + bar / 2, 0)
  const sideH = h - bar * 2
  ctx.add(new THREE.BoxGeometry(depth, sideH, bar), mat, parent).position.set(x, y,  w / 2 - bar / 2)
  ctx.add(new THREE.BoxGeometry(depth, sideH, bar), mat, parent).position.set(x, y, -w / 2 + bar / 2)
}

function buildDamper(
  ctx: HvacCtx,
  parent: THREE.Object3D,
  deckH: number,
  deckW: number,
  x: number,
  y: number,
): THREE.Mesh[] {
  const frameMat = ctx.metal(0x3a424b, 0.6, 0.4)
  const bladeMat = ctx.metal(0xb7c0c7, 0.45, 0.4)
  const frameH = deckH * 0.78
  const frameW = Math.min(deckW * 0.62, deckH * 2.4)
  const bar = Math.min(deckH, deckW) * 0.045
  const depth = bar * 0.85
  addPictureFrame(ctx, parent, x, y, frameH, frameW, bar, depth, frameMat)

  const count = 5
  const innerH = frameH - bar * 2
  const stride = innerH / count
  const chord = stride * 0.28
  const bladeW = frameW - bar * 2.4
  const blades: THREE.Mesh[] = []
  const geo = new THREE.BoxGeometry(Math.max(depth * 0.18, chord * 0.22), chord, bladeW)
  for (let i = 0; i < count; i++) {
    const by = y - innerH / 2 + (i + 0.5) * stride
    const b = ctx.add(geo, bladeMat, parent)
    b.position.set(x, by, 0)
    b.userData.fahuBlade = true
    blades.push(b)
  }

  const actMat = ctx.metal(0x5c6770, 0.45, 0.4)
  const dialMat = ctx.metal(0xf5c542, 0.35, 0.45)
  const act = Math.min(deckH, deckW) * 0.1
  const actX = x - depth * 0.9
  const actY = y - frameH * 0.22
  const actZ = -frameW * 0.38
  ctx.add(new THREE.BoxGeometry(depth * 1.4, act, act * 0.72), actMat, parent)
    .position.set(actX, actY, actZ)
  const dial = new THREE.CylinderGeometry(act * 0.34, act * 0.34, depth * 0.35, 16)
  dial.rotateZ(Math.PI / 2)
  ctx.add(dial, dialMat, parent).position.set(actX - depth * 0.7, actY, actZ)
  return blades
}

function buildPanelFilter(
  ctx: HvacCtx,
  parent: THREE.Object3D,
  deckH: number,
  deckW: number,
  x: number,
  y: number,
): THREE.MeshStandardMaterial {
  const frameMat = ctx.metal(0x4a5568, 0.5, 0.45)
  const mediaMat = ctx.metal(FILTER_CLEAN, 0.12, 0.72)
  const crossMat = ctx.metal(0x3d4650, 0.45, 0.5)
  const frameH = deckH * 0.78
  const frameW = Math.min(deckW * 0.62, deckH * 2.4)
  const bar = Math.min(deckH, deckW) * 0.045
  const depth = bar * 0.9
  addPictureFrame(ctx, parent, x, y, frameH, frameW, bar, depth, frameMat)

  const innerH = frameH - bar * 2
  const innerW = frameW - bar * 2
  ctx.add(new THREE.BoxGeometry(depth * 0.35, innerH * 0.98, innerW * 0.98), mediaMat, parent)
    .position.set(x, y, 0)

  const span = Math.hypot(innerH, innerW) * 0.9
  const thick = Math.min(innerH, innerW) * 0.045
  const arm = new THREE.BoxGeometry(depth * 0.55, span, thick)
  const tilt = Math.atan2(innerW, innerH)
  const d1 = ctx.add(arm, crossMat, parent)
  d1.position.set(x + depth * 0.2, y, 0)
  d1.rotation.x = tilt
  const d2 = ctx.add(arm, crossMat, parent)
  d2.position.set(x + depth * 0.2, y, 0)
  d2.rotation.x = -tilt
  return mediaMat
}

function buildBagFilter(
  ctx: HvacCtx,
  parent: THREE.Object3D,
  deckH: number,
  deckW: number,
  x: number,
  y: number,
): THREE.MeshStandardMaterial {
  const frameMat = ctx.metal(0x4a5568, 0.5, 0.45)
  const mediaMat = ctx.metal(FILTER_CLEAN, 0.18, 0.68)
  const frameH = deckH * 0.78
  const frameW = Math.min(deckW * 0.62, deckH * 2.4)
  const bar = Math.min(deckH, deckW) * 0.045
  const depth = bar * 0.9
  addPictureFrame(ctx, parent, x, y, frameH, frameW, bar, depth, frameMat)

  const pleats = 7
  const innerH = frameH - bar * 2.4
  const innerW = frameW - bar * 2.2
  const stride = innerW / pleats
  const pleatD = Math.min(deckH * 0.06, 0.05)
  const geo = new THREE.BoxGeometry(pleatD, innerH, stride * 0.55)
  for (let i = 0; i < pleats; i++) {
    const z = -innerW / 2 + (i + 0.5) * stride
    const px = x + (i % 2 === 0 ? pleatD * 0.35 : -pleatD * 0.15)
    ctx.add(geo, mediaMat, parent).position.set(px, y, z)
  }
  return mediaMat
}

function buildHeatWheel(
  ctx: HvacCtx,
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  radius: number,
  name: string,
): THREE.Group {
  const pivot = new THREE.Group()
  pivot.position.set(x, y, z)
  // Same yaw as the fans. The disc stands across the width; the axle runs along the duct.
  pivot.rotation.y = Math.PI / 2
  parent.add(pivot)

  const rotor = new THREE.Group()
  rotor.userData.fahuRotor = name
  pivot.add(rotor)

  const faceMat = ctx.metal(0x2a3138, 0.35, 0.55)
  const rimMat = ctx.metal(0xd5dbe0, 0.72, 0.28)
  const spokeMat = ctx.metal(0xb7c0c8, 0.55, 0.4)
  faceMat.side = THREE.DoubleSide

  const disc = new THREE.CircleGeometry(radius * 0.96, 48)
  ctx.add(disc, faceMat, rotor)
  const back = new THREE.CircleGeometry(radius * 0.96, 48)
  back.rotateY(Math.PI)
  ctx.add(back, faceMat, rotor)

  const depth = Math.max(radius * 0.16, 0.04)
  const rim = new THREE.TorusGeometry(radius, depth * 0.45, 8, 40)
  ctx.add(rim, rimMat, rotor)

  const spoke = new THREE.BoxGeometry(depth * 0.7, radius * 0.9, depth * 0.45)
  spoke.translate(0, radius * 0.45, 0)
  for (let i = 0; i < 12; i++) {
    ctx.add(spoke, spokeMat, rotor).rotation.z = (i / 12) * Math.PI * 2
  }

  const hub = new THREE.CylinderGeometry(radius * 0.08, radius * 0.08, depth, 16)
  hub.rotateX(Math.PI / 2)
  ctx.add(hub, rimMat, rotor)
  return rotor
}

function buildProbe(
  ctx: HvacCtx,
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  deckH: number,
  tint: number,
) {
  const headMat = ctx.metal(tint, 0.25, 0.4)
  const stemMat = ctx.metal(0xe5e7eb, 0.55, 0.35)
  const s = Math.max(deckH * 0.07, 0.025)
  const head = ctx.add(new THREE.BoxGeometry(s, s * 0.5, s * 0.72), headMat, parent)
  head.position.set(x, y, z)
  head.userData.fahuProbe = true
  const probeLen = deckH * 0.1
  ctx.add(new THREE.CylinderGeometry(s * 0.06, s * 0.06, probeLen, 8), stemMat, parent)
    .position.set(x, y - probeLen / 2 - s * 0.25, z)
}

function addFanFrame(
  ctx: HvacCtx,
  parent: THREE.Object3D,
  fanX: number,
  fanY: number,
  fanR: number,
) {
  const frameMat = ctx.metal(0x2a313a, 0.5, 0.45)
  const opening = fanR * 2.15
  const rail = fanR * 0.14
  const railD = fanR * 0.28
  ctx.add(new THREE.BoxGeometry(railD, rail, opening), frameMat, parent)
    .position.set(fanX, fanY + opening / 2 - rail / 2, 0)
  ctx.add(new THREE.BoxGeometry(railD, rail, opening), frameMat, parent)
    .position.set(fanX, fanY - opening / 2 + rail / 2, 0)
  ctx.add(new THREE.BoxGeometry(railD, opening - rail * 2, rail), frameMat, parent)
    .position.set(fanX, fanY,  opening / 2 - rail / 2)
  ctx.add(new THREE.BoxGeometry(railD, opening - rail * 2, rail), frameMat, parent)
    .position.set(fanX, fanY, -opening / 2 + rail / 2)
}

function fanArgs(fanR: number) {
  return { hy: fanR / 0.8, hz: fanR / 0.4 }
}

export function createFahuSchematic(
  _localBox: THREE.Box3,
  _modelMatrix: THREE.Matrix4,
  casing?: THREE.Object3D,
): FahuSchematic | null {
  if (!casing) return null
  const frame = resolveFahuFrame(casing)
  if (!frame) return null
  const { center, long, up, width, lower, upper } = frame

  const group = new THREE.Group()
  group.position.copy(center)
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(long, up, width))
  group.userData.ekoFahu = true

  const ctx = makeHvacCtx('ekoFahu')
  const deckH = lower.max.y - lower.min.y
  const deckW = lower.max.z - lower.min.z
  const uH = upper.max.y - upper.min.y
  const uW = upper.max.z - upper.min.z
  const uc = new THREE.Vector3(
    (upper.min.x + upper.max.x) / 2,
    (upper.min.y + upper.max.y) / 2,
    (upper.min.z + upper.max.z) / 2,
  )

  // The disc is centered on the joint and stands across the width, so one
  // wheel reaches both decks. Diameter is the cross-section, not the duct length.
  const jointY = (lower.max.y + upper.min.y) * 0.5
  const intoDeck = Math.min(jointY - lower.min.y, upper.max.y - jointY) - 0.05
  const halfW = Math.min(
    Math.min(uc.z - lower.min.z, lower.max.z - uc.z),
    Math.min(uc.z - upper.min.z, upper.max.z - uc.z),
  ) - 0.06
  const outerR = Math.max(0.12, Math.min(intoDeck, halfW))
  const wheelR = outerR / 1.072
  const spanX = Math.max(0.4, upper.max.x - upper.min.x)
  const eaX = upper.min.x + 0.10
  const efR = Math.min(uH * 0.18, 0.11)
  const efX = eaX + 0.20
  const hrwX = upper.min.x + spanX * 0.42
  const sensX = upper.min.x + spanX * 0.76

  const upperDeck = new THREE.Group()
  upperDeck.position.set(0, uc.y, uc.z)
  group.add(upperDeck)

  const eaBlades = buildDamper(ctx, upperDeck, uH, uW, eaX, 0)
  const efFan = buildCentrifugalFan(ctx, { group: upperDeck, ...fanArgs(efR), fanX: efX })
  efFan.rotor.userData.fahuRotor = 'ef'
  addFanFrame(ctx, upperDeck, efX, 0, efR)
  const hrw = buildHeatWheel(ctx, group, hrwX, jointY, uc.z, wheelR, 'hrw')
  const sensible = buildHeatWheel(ctx, group, sensX, jointY, uc.z, wheelR, 'sensible')
  // Return-air panel is the third filter on the graphic, on the upper deck past the sensible wheel.
  const raX = Math.min(upper.max.x - 0.11, Math.max(sensX + 0.24, upper.max.x - 0.18))
  const raMat = buildPanelFilter(ctx, upperDeck, uH, uW, raX, 0)

  const saX = Math.max(lower.min.x + 0.28, upper.min.x - 0.28)
  const preX = saX + 0.32
  const bagX = Math.min(hrwX - 0.28, preX + 0.36)
  const coilX = upper.max.x + Math.min(0.85, (lower.max.x - upper.max.x) * 0.28)
  const fanX = upper.max.x + (lower.max.x - upper.max.x) * 0.58
  const saProbeX = lower.max.x - 0.32
  const sfR = Math.min(deckH * 0.34, 0.26)

  const saBlades = buildDamper(ctx, group, deckH, deckW, saX, 0)
  const preMat = buildPanelFilter(ctx, group, deckH, deckW, preX, 0)
  const bagMat = buildBagFilter(ctx, group, deckH, deckW, bagX, 0)

  const coilHy = deckH * 0.42
  const coilHz = Math.min(deckW * 0.32, deckH * 0.9)
  const coilAnchor = new THREE.Group()
  coilAnchor.position.set(coilX, 0, 0)
  group.add(coilAnchor)
  const coilR = buildCoil(ctx, { parent: coilAnchor, hx: 1.6, hy: coilHy, hz: coilHz, coilX: 0 })
  buildValve(ctx, {
    parent: coilAnchor, hy: coilHy, hz: coilHz, span: Math.min(coilHy, coilHz),
    tubeR: coilR.tubeR, coilMat: coilR.coilMat, xs: coilR.xs, yBot: coilR.yBot, tubeLen: coilR.tubeLen,
  })

  const sfFan = buildCentrifugalFan(ctx, { group, ...fanArgs(sfR), fanX })
  sfFan.rotor.userData.fahuRotor = 'sf'
  addFanFrame(ctx, group, fanX, 0, sfR)

  // Graphic sensors, unlabeled. Humidity is pale blue (+z), temperature is white (-z).
  // Stations stay off the wheel discs (thin in x) and off the filter and coil faces.
  const HUM = 0xbfdbfe
  const TEMP = 0xf8fafc
  const pair = (parent: THREE.Object3D, x: number, y: number, z: number, h: number) => {
    buildProbe(ctx, parent, x, y,  z, h, HUM)
    buildProbe(ctx, parent, x, y, -z, h, TEMP)
  }
  const midZ = Math.min(deckW, uW) * 0.24
  const endZ = Math.min(deckW * 0.34, 0.70)
  const uY = uH * 0.32
  const lY = deckH * 0.28
  pair(upperDeck, hrwX - 0.22, uY, midZ, uH)   // HRW off, return air
  pair(upperDeck, sensX - 0.22, uY, midZ, uH)  // sensible off, return air
  const raProbeX = Math.min(upper.max.x - 0.10, Math.max(raX + 0.12, upper.max.x - 0.16))
  pair(upperDeck, raProbeX, uY, midZ, uH)      // return air, past the RA filter
  const faX = Math.max(lower.min.x + 0.16, saX - 0.22)
  pair(group, faX, lY, endZ, deckH)            // fresh air, ahead of the inlet damper
  pair(group, hrwX + 0.22, lY, midZ, deckH)    // HRW off, supply air
  pair(group, coilX - 0.28, lY, Math.min(deckW * 0.32, 0.66), deckH) // off the cooling coil
  pair(group, saProbeX, lY, endZ, deckH)       // supply air outlet

  let efRate = 0
  let sfRate = 0
  let hrwRate = 0
  let sensRate = 0

  const apply = (points: FahuPoint[]): FahuReading => {
    const r = readFahuPoints(points || [])
    const setBlades = (blades: THREE.Mesh[], open: number | null) => {
      const angle = (open == null ? 0.62 : open) * Math.PI * 0.45
      blades.forEach(b => { b.rotation.z = angle })
    }
    setBlades(eaBlades, r.eaDamperOpen)
    setBlades(saBlades, r.saDamperOpen)
    preMat.color.copy(r.preFilterDirty ? FILTER_DIRTY : FILTER_CLEAN)
    bagMat.color.copy(r.bagFilterDirty ? FILTER_DIRTY : FILTER_CLEAN)
    raMat.color.copy(r.raFilterDirty ? FILTER_DIRTY : FILTER_CLEAN)
    if (r.coolingValvePos == null) coilR.coilMat.color.copy(COIL_IDLE)
    else coilR.coilMat.color.copy(COIL_CLOSED).lerp(COIL_OPEN, r.coolingValvePos)
    efFan.bladeMat.color.copy(r.efFanOn ? FAN_ON : FAN_OFF)
    sfFan.bladeMat.color.copy(r.sfFanOn ? FAN_ON : FAN_OFF)
    efRate = r.efFanOn ? 1.9 : 0
    sfRate = r.sfFanOn ? 1.9 : 0
    hrwRate = r.hrwOn ? 1.15 : 0
    sensRate = r.sensibleOn ? 1.15 : 0
    return r
  }
  apply([])

  return {
    group,
    apply,
    tick: dt => {
      if (efRate) efFan.rotor.rotation.z += efRate * dt
      if (sfRate) sfFan.rotor.rotation.z += sfRate * dt
      if (hrwRate) hrw.rotation.z += hrwRate * dt
      if (sensRate) sensible.rotation.z += sensRate * dt
    },
    dispose: () => { group.removeFromParent(); ctx.disposeAll() },
  }
}
