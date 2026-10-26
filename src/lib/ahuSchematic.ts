import * as THREE from 'three'
import {
  HvacPoint,
  COIL_CLOSED, COIL_OPEN, COIL_IDLE, FAN_ON, FAN_OFF, FILTER_CLEAN, FILTER_DIRTY,
  clean, numberOf, findPoint, shown, isRunning,
  resolveFrame, makeHvacCtx,
  buildCoil, buildValve, buildCentrifugalFan, buildFanOpening,
  buildDamper, buildPanelFilter, buildBagFilter, buildSensorProbe,
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
  /** The FIN point the label would be for */
  title:    string
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
  buildFanOpening(ctx, group, fanX, fanR)

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
    { key: 'faDamperPos',     title: 'FA_DAMPER_POS',     position: new THREE.Vector3(damperX,    -hy * 0.9, 0), side: 'below' },
    { key: 'preFilter',       title: 'PRE_FILTER',        position: new THREE.Vector3(preFilterX,   hy * 0.9, 0), side: 'above' },
    { key: 'bagFilter',       title: 'BAG_FILTER',        position: new THREE.Vector3(bagFilterX,    hy * 0.9, 0), side: 'above' },
    { key: 'coolingValveCmd', title: 'COOLING_VALVE_CMD', position: new THREE.Vector3(coilX,       -hy * 0.9, 0), side: 'below' },
    { key: 'sfFanStatus',     title: 'SF_FAN_STS',        position: new THREE.Vector3(fanX,        -hy * 0.9, 0), side: 'below' },
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
