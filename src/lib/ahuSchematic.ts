import * as THREE from 'three'
import {
  HvacPoint, HvacCtx,
  COIL_CLOSED, COIL_OPEN, COIL_IDLE, FAN_ON, FAN_OFF,
  clean, numberOf, findPoint, shown, isRunning,
  resolveFrame, makeHvacCtx,
  buildCoil, buildValve, buildCentrifugalFan,
} from '@/lib/hvacGeometry'

export type AhuPoint = HvacPoint

export type AhuReading = {
  faDamperOpen:    number | null
  faDamperPos:     string
  preFilterDirty:  boolean
  preFilter:       string
  coolingValvePos: number | null
  coolingValveCmd: string
  sfFanOn:         boolean
  sfFanStatus:     string
  sfFanRate:       number
  bagFilterDirty:  boolean
  bagFilter:       string
  raTemp:     string
  raHum:      string
  raCo2:      string
  saTemp:     string
  saHum:      string
  saPressure: string
}

export type AhuAnchor = {
  key:      'faDamperPos' | 'preFilter' | 'coolingValveCmd' | 'sfFanStatus' | 'bagFilter'
  position: THREE.Vector3
  side:     'above' | 'below'
}

export type AhuSchematic = {
  group:   THREE.Group
  anchors: AhuAnchor[]
  apply:   (points: AhuPoint[]) => AhuReading
  tick:    (dt: number) => void
  dispose: () => void
}

export function readAhuPoints(points: AhuPoint[]): AhuReading {
  const val = (test: (k: string) => boolean) =>
    clean(findPoint(points, test)?.currentValue)

  const faDamperRaw = val(k => k.includes('fadamper') && k.includes('pos'))
  const preFilterRaw = val(k => k.includes('prefilter'))
  const cvPosRaw = val(k =>
    k.includes('coolingvalvepos') ||
    (k.includes('coolingvalve') && k.includes('pos') && !k.includes('cmd')))
  const cvCmdRaw = val(k =>
    k.includes('coolingvalvecmd') ||
    (k.includes('coolingvalve') && k.includes('cmd')))
  const sfFanRaw = val(k =>
    k.includes('sfairflow') || k.includes('safan') ||
    (k.includes('fanrun') && !k.includes('ra')))
  const bagRaw = val(k => k.includes('bagfilter') || (k.includes('bag') && k.includes('filter')))
  const raTempRaw  = val(k => k.includes('ratemp'))
  const raHumRaw   = val(k => k.includes('rahum'))
  const raCo2Raw   = val(k => k.includes('raco2') || k.includes('co2'))
  const saTempRaw  = val(k => k.includes('satemp'))
  const saHumRaw   = val(k => k.includes('sahum'))
  const saPressRaw = val(k => k.includes('sapressure') || k.includes('sadp'))

  const faDamperN = numberOf(faDamperRaw)
  let faDamperOpen: number | null = null
  if (faDamperN != null) {
    const frac = faDamperN <= 1 && !faDamperRaw!.includes('%')
    faDamperOpen = Math.min(1, Math.max(0, frac ? faDamperN : faDamperN / 100))
  }

  const cvPosN = numberOf(cvPosRaw)
  let coolingValvePos: number | null = null
  if (cvPosN != null) {
    const frac = cvPosN <= 1 && !cvPosRaw!.includes('%')
    coolingValvePos = Math.min(1, Math.max(0, frac ? cvPosN : cvPosN / 100))
  }

  const sfFanOn   = isRunning(sfFanRaw)
  const sfFanRate = sfFanOn ? 1.9 : 0

  const preFilterDirty = preFilterRaw != null && /dirty|alarm|fault|high/i.test(preFilterRaw)
  const bagFilterDirty = bagRaw       != null && /dirty|alarm|fault|high/i.test(bagRaw)

  return {
    faDamperOpen,
    faDamperPos:     shown(faDamperRaw, ' %'),
    preFilterDirty,
    preFilter:       preFilterDirty ? 'Dirty' : 'Clean',
    coolingValvePos,
    coolingValveCmd: shown(cvCmdRaw, ' %'),
    sfFanOn,
    sfFanStatus:     sfFanOn ? 'On' : 'Off',
    sfFanRate,
    bagFilterDirty,
    bagFilter:       bagFilterDirty ? 'Dirty' : 'Clean',
    raTemp:          shown(raTempRaw,  ' °C'),
    raHum:           shown(raHumRaw,   ' %RH'),
    raCo2:           shown(raCo2Raw,   ' ppm'),
    saTemp:          shown(saTempRaw,  ' °C'),
    saHum:           shown(saHumRaw,   ' %RH'),
    saPressure:      shown(saPressRaw, ' Pa'),
  }
}

const FILTER_CLEAN = new THREE.Color(0xc8d6df)
const FILTER_DIRTY = new THREE.Color(0x9c6b2e)

function addPictureFrame(
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

function buildDamper(
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

function buildPanelFilter(
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

function buildBagFilter(
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

function buildSensorProbe(
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

export function createAhuSchematic(
  localBox:    THREE.Box3,
  modelMatrix: THREE.Matrix4,
  casing?:     THREE.Object3D,
): AhuSchematic | null {
  const frame = resolveFrame(localBox, modelMatrix, casing)
  if (!frame) return null
  let { center, long, up, width, hx, hy, hz } = frame

  // Point airflow along the model's local X so the damper-to-fan order stays stable.
  const localX = new THREE.Vector3(1, 0, 0).transformDirection(modelMatrix)
  if (long.dot(localX) < 0) {
    long.negate()
    width.negate()
  }

  const group = new THREE.Group()
  group.position.copy(center)
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(long, up, width))
  group.userData.ekoAhu = true

  const ctx = makeHvacCtx('ekoAhu')

  // One bay each, in graphic order. The fan used to share the coil's bay, so it vanished into the fins.
  const damperX    = -hx * 0.68
  const preFilterX = -hx * 0.38
  const bagFilterX = -hx * 0.08
  const coilX      =  hx * 0.22
  const fanX       =  hx * 0.58

  const damperBlades = buildDamper(ctx, group, hy, hz, damperX)
  const preFilterMat = buildPanelFilter(ctx, group, hy, hz, preFilterX)
  const bagFilterMat = buildBagFilter(ctx, group, hy, hz, hx, bagFilterX)

  const coilHy = hy * 0.7
  const coilHz = hz * 0.62
  const coilR = buildCoil(ctx, { parent: group, hx, hy: coilHy, hz: coilHz, coilX })
  const { coilMat, tubeR, yBot, tubeLen, xs } = coilR
  buildValve(ctx, {
    parent: group, hy: coilHy, hz: coilHz, span: Math.min(coilHy, coilHz),
    tubeR, coilMat, xs, yBot, tubeLen,
  })

  // Same yaw as the FCU: the wheel faces along the duct. A square frame keeps it readable from above.
  const fanHy = hy * 0.72
  const fanHz = Math.min(hz * 0.9, hy * 1.1)
  const fanBuilt = buildCentrifugalFan(ctx, { group, hy: fanHy, hz: fanHz, fanX })
  const { rotor, bladeMat, fanR } = fanBuilt
  const frameMat = ctx.metal(0x2a313a, 0.5, 0.45)
  const opening = fanR * 2.15
  const rail = fanR * 0.14
  const railD = fanR * 0.28
  ctx.add(new THREE.BoxGeometry(railD, rail, opening), frameMat, group).position.set(fanX,  opening / 2 - rail / 2, 0)
  ctx.add(new THREE.BoxGeometry(railD, rail, opening), frameMat, group).position.set(fanX, -opening / 2 + rail / 2, 0)
  ctx.add(new THREE.BoxGeometry(railD, opening - rail * 2, rail), frameMat, group).position.set(fanX, 0,  opening / 2 - rail / 2)
  ctx.add(new THREE.BoxGeometry(railD, opening - rail * 2, rail), frameMat, group).position.set(fanX, 0, -opening / 2 + rail / 2)

  // Return probes across the inlet, supply probes across the outlet.
  // Same six as the graphic: RA hum / CO2 / temp, SA hum / pressure / temp.
  const sensorY = hy * 0.8
  const raX = -hx * 0.86
  const saX =  hx * 0.92
  buildSensorProbe(ctx, group, raX, sensorY, -hz * 0.46, hy, 0xbfdbfe) // RA humidity
  buildSensorProbe(ctx, group, raX, sensorY,  0,         hy, 0xbbf7d0) // RA CO2
  buildSensorProbe(ctx, group, raX, sensorY,  hz * 0.46, hy, 0xf8fafc) // RA temp
  buildSensorProbe(ctx, group, saX, sensorY,  hz * 0.46, hy, 0xbfdbfe) // SA humidity
  buildSensorProbe(ctx, group, saX, sensorY, -hz * 0.46, hy, 0xfde68a) // SA pressure
  buildSensorProbe(ctx, group, saX, sensorY,  0,         hy, 0xf8fafc) // SA temp

  const anchors: AhuAnchor[] = [
    { key: 'faDamperPos',     position: new THREE.Vector3(damperX,    -hy * 0.9, 0), side: 'below' },
    { key: 'preFilter',       position: new THREE.Vector3(preFilterX,   hy * 0.9, 0), side: 'above' },
    { key: 'bagFilter',       position: new THREE.Vector3(bagFilterX,    hy * 0.9, 0), side: 'above' },
    { key: 'coolingValveCmd', position: new THREE.Vector3(coilX,       -hy * 0.9, 0), side: 'below' },
    { key: 'sfFanStatus',     position: new THREE.Vector3(fanX,        -hy * 0.9, 0), side: 'below' },
  ]

  let rate = 0
  const apply = (points: AhuPoint[]): AhuReading => {
    const r = readAhuPoints(points || [])

    const open = r.faDamperOpen == null ? 0.62 : r.faDamperOpen
    damperBlades.forEach(b => { b.rotation.z = open * Math.PI * 0.45 })

    preFilterMat.color.copy(r.preFilterDirty ? FILTER_DIRTY : FILTER_CLEAN)
    bagFilterMat.color.copy(r.bagFilterDirty ? FILTER_DIRTY : FILTER_CLEAN)

    if (r.coolingValvePos == null) coilMat.color.copy(COIL_IDLE)
    else coilMat.color.copy(COIL_CLOSED).lerp(COIL_OPEN, r.coolingValvePos)

    bladeMat.color.copy(r.sfFanOn ? FAN_ON : FAN_OFF)
    rate = r.sfFanRate

    return r
  }
  apply([])

  return {
    group,
    anchors,
    apply,
    tick:    dt => { if (rate) rotor.rotation.z += rate * dt },
    dispose: ()  => { group.removeFromParent(); ctx.disposeAll() },
  }
}
