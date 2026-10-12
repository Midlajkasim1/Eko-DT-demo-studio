import * as THREE from 'three'
import {
  HvacPoint,
  COIL_CLOSED, COIL_OPEN, COIL_IDLE, FAN_ON, FAN_OFF, FILTER_CLEAN, FILTER_DIRTY, NO_DATA,
  clean, findPoint, shown, stateOf, fractionOf,
  resolveFrame, makeHvacCtx,
  buildCoil, buildValve, buildCentrifugalFan, buildFanOpening,
  buildDamper, buildPanelFilter, buildBagFilter, buildSensorProbe, buildHeatPipe,
} from '@/lib/hvacGeometry'

export type MauPoint = HvacPoint

export type MauReading = {
  /** 0 closed .. 1 open; null when FA_DAMPER_STS is missing */
  faDamperOpen:    number | null
  faDamper:        string
  preFilterDirty:  boolean | null
  preFilter:       string
  bagFilterDirty:  boolean | null
  bagFilter:       string
  tempBeforeHp:    string
  humBeforeHp:     string
  tempAfterHp:     string
  humAfterHp:      string
  coolingValvePos: number | null
  coolingValve:    string
  coolingValveCmd: string
  chwSupTemp:      string
  chwRetTemp:      string
  sfOn:            boolean | null
  sfStatus:        string
  sfSpeed:         string
  sfTrip:          string
  sfRate:          number
  saTemp:          string
  saTempSp:        string
  saHum:           string
  saPressure:      string
  saPressureSp:    string
}

export type MauAnchor = {
  key:      'faDamper' | 'preFilter' | 'bagFilter' | 'coolingValveCmd' | 'tempAfterHp' | 'sfStatus' | 'saTemp'
  position: THREE.Vector3
  side:     'above' | 'below'
}

export type MauSchematic = {
  group:   THREE.Group
  anchors: MauAnchor[]
  apply:   (points: MauPoint[]) => MauReading
  tick:    (dt: number) => void
  dispose: () => void
}

/** Sections that not every make-up air unit has. Both are on MAHU-ANC09-BF-01 (its FIN page lists BAG_FILTER and the *_HEATPIPE points). */
export type MauOptions = {
  bagFilter?: boolean
  heatPipe?:  boolean
}

/**
 * FIN point names from the MAHU-ANC09-BF-01 equipment page, folded by keyOf
 * ("SA_TEMP" -> "satemp"). Matched on the end of the name so a prefixed
 * navName still hits, while "SA_TEMP_SP" does not answer for "SA_TEMP".
 */
export function readMauPoints(points: MauPoint[]): MauReading {
  const val = (...names: string[]) => {
    for (const n of names) {
      const v = clean(findPoint(points, k => k.endsWith(n))?.currentValue)
      if (v != null) return v
    }
    return null
  }
  // "Dirty"/"Clean" text, or a pressure switch's T/F (T = high DP = dirty).
  // ponytail: T-means-dirty is unconfirmed until FIN shows a dirty filter; flip here if not.
  const dirtyOf = (raw: string | null): boolean | null => {
    if (!raw) return null
    if (/dirty|alarm|fault|high/i.test(raw)) return true
    if (/clean|normal|ok|low/i.test(raw)) return false
    return stateOf(raw)
  }
  const filterText = (d: boolean | null) => d == null ? '—' : d ? 'Dirty' : 'Clean'

  // FA_DAMPER_STS is open/closed (T/F or 1/0), never a percentage. Only a position point is.
  const damperPos = fractionOf(val('fadamperpos'))
  const damperState = stateOf(val('fadampersts'))
  const faDamperOpen = damperPos ?? (damperState == null ? null : damperState ? 1 : 0)

  const preRaw = val('prefilter')
  const bagRaw = val('bagfilter')
  const cvPosRaw = val('coolingvalvepos')
  const runRaw = val('sfvfdrunsts', 'sfairflowsts')
  const speedRaw = val('sfvfdspdpos', 'sfvfdspdcmd')

  const sfOn = stateOf(runRaw)
  const speed = fractionOf(speedRaw)
  const sfRate = sfOn ? (speed == null ? 1.9 : 0.5 + 2.6 * speed) : 0
  const tripRaw = val('sftripalarm')
  const trip = stateOf(tripRaw)

  return {
    faDamperOpen,
    faDamper:        damperState == null ? '—' : damperState ? 'Open' : 'Closed',
    preFilterDirty:  dirtyOf(preRaw),
    preFilter:       filterText(dirtyOf(preRaw)),
    bagFilterDirty:  dirtyOf(bagRaw),
    bagFilter:       filterText(dirtyOf(bagRaw)),
    tempBeforeHp:    shown(val('tempbeforeheatpipe'), ' °C'),
    humBeforeHp:     shown(val('humbeforeheatpipe'),  ' %RH'),
    tempAfterHp:     shown(val('tempafterheatpipe'),  ' °C'),
    humAfterHp:      shown(val('humafterheatpipe'),   ' %RH'),
    coolingValvePos: fractionOf(cvPosRaw),
    coolingValve:    shown(cvPosRaw, ' %'),
    coolingValveCmd: shown(val('coolingvalvecmd'), ' %'),
    chwSupTemp:      shown(val('chwsuptemp'), ' °C'),
    chwRetTemp:      shown(val('chwrettemp'), ' °C'),
    sfOn,
    sfStatus:        sfOn == null ? '—' : sfOn ? 'On' : 'Off',
    sfSpeed:         shown(speedRaw, ' %'),
    sfTrip:          trip == null ? '—' : trip ? 'Trip' : 'Normal',
    sfRate,
    saTemp:          shown(val('satemp'),       ' °C'),
    saTempSp:        shown(val('satempsp'),     ' °C'),
    saHum:           shown(val('sahum'),        ' %RH'),
    saPressure:      shown(val('sapressure'),   ' Pa'),
    saPressureSp:    shown(val('sapressuresp'), ' Pa'),
  }
}

export function createMauSchematic(
  localBox:    THREE.Box3,
  modelMatrix: THREE.Matrix4,
  casing?:     THREE.Object3D,
  options:     MauOptions = {},
): MauSchematic | null {
  const { bagFilter = true, heatPipe = true } = options
  const frame = resolveFrame(localBox, modelMatrix, casing)
  if (!frame) return null
  const { center, long, up, width, hx, hy, hz } = frame

  // Same convention as the AHU: fresh air enters at the model's local -X end.
  const localX = new THREE.Vector3(1, 0, 0).transformDirection(modelMatrix)
  if (long.dot(localX) < 0) {
    long.negate()
    width.negate()
  }

  const group = new THREE.Group()
  group.position.copy(center)
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(long, up, width))
  group.userData.ekoMau = true

  const ctx = makeHvacCtx('ekoMau')

  // One bay per section in airflow order, sized by weight; the fan bay is longer for its motor.
  // ponytail: heat pipe after the coil is assumed (FIN names only say a heat pipe exists); a wrap-around
  // pre-cool/reheat pair would need a second heatPipe bay before the coil. Confirm against the FIN graphic.
  type Bay = 'damper' | 'preFilter' | 'bagFilter' | 'coil' | 'heatPipe' | 'fan'
  const bays: [Bay, number][] = [
    ['damper', 1], ['preFilter', 1], ...(bagFilter ? [['bagFilter', 1] as [Bay, number]] : []),
    ['coil', 1.2], ...(heatPipe ? [['heatPipe', 1] as [Bay, number]] : []), ['fan', 1.6],
  ]
  const x0 = -hx * 0.88
  const unit = hx * 1.78 / bays.reduce((s, [, w]) => s + w, 0)
  const xs = {} as Record<Bay, number>
  let at = x0
  for (const [bay, w] of bays) {
    xs[bay] = at + unit * w / 2
    at += unit * w
  }

  const damperBlades = buildDamper(ctx, group, hy, hz, xs.damper)
  const preFilterMat = buildPanelFilter(ctx, group, hy, hz, xs.preFilter)
  const bagFilterMat = bagFilter ? buildBagFilter(ctx, group, hy, hz, hx, xs.bagFilter) : null

  const coilHy = hy * 0.7
  const coilHz = hz * 0.62
  const { coilMat, tubeR, yBot, tubeLen, xs: tubeXs } = buildCoil(ctx, { parent: group, hx, hy: coilHy, hz: coilHz, coilX: xs.coil })
  buildValve(ctx, {
    parent: group, hy: coilHy, hz: coilHz, span: Math.min(coilHy, coilHz),
    tubeR, coilMat, xs: tubeXs, yBot, tubeLen,
  })

  if (heatPipe) buildHeatPipe(ctx, group, hy, hz, xs.heatPipe)

  const fanHy = hy * 0.72
  const fanHz = Math.min(hz * 0.9, hy * 1.1)
  const { rotor, bladeMat, fanR } = buildCentrifugalFan(ctx, { group, hy: fanHy, hz: fanHz, fanX: xs.fan })
  buildFanOpening(ctx, group, xs.fan, fanR)

  // Temperature and humidity either side of the heat pipe, then the three supply probes at the outlet.
  const sensorY = hy * 0.8
  const TEMP = 0xf8fafc, HUM = 0xbfdbfe, PRESS = 0xfde68a
  if (heatPipe) {
    const before = (xs.coil + xs.heatPipe) / 2
    const after  = (xs.heatPipe + xs.fan) / 2 - unit * 0.3
    buildSensorProbe(ctx, group, before, sensorY,  hz * 0.3, hy, TEMP)
    buildSensorProbe(ctx, group, before, sensorY, -hz * 0.3, hy, HUM)
    buildSensorProbe(ctx, group, after,  sensorY,  hz * 0.3, hy, TEMP)
    buildSensorProbe(ctx, group, after,  sensorY, -hz * 0.3, hy, HUM)
  }
  const saX = hx * 0.94
  buildSensorProbe(ctx, group, saX, sensorY,  hz * 0.46, hy, HUM)
  buildSensorProbe(ctx, group, saX, sensorY, -hz * 0.46, hy, PRESS)
  buildSensorProbe(ctx, group, saX, sensorY,  0,         hy, TEMP)

  const anchors: MauAnchor[] = [
    { key: 'faDamper',        position: new THREE.Vector3(xs.damper,    -hy * 0.9, 0), side: 'below' },
    { key: 'preFilter',       position: new THREE.Vector3(xs.preFilter,  hy * 0.9, 0), side: 'above' },
    { key: 'coolingValveCmd', position: new THREE.Vector3(xs.coil,      -hy * 0.9, 0), side: 'below' },
    { key: 'sfStatus',        position: new THREE.Vector3(xs.fan,       -hy * 0.9, 0), side: 'below' },
    { key: 'saTemp',          position: new THREE.Vector3(saX,           hy * 0.9, 0), side: 'above' },
  ]
  if (bagFilter) anchors.push({ key: 'bagFilter',   position: new THREE.Vector3(xs.bagFilter, hy * 0.9, 0), side: 'above' })
  if (heatPipe)  anchors.push({ key: 'tempAfterHp', position: new THREE.Vector3(xs.heatPipe,  hy * 0.9, 0), side: 'above' })

  const filterColour = (d: boolean | null) => d == null ? NO_DATA : d ? FILTER_DIRTY : FILTER_CLEAN

  let rate = 0
  const apply = (points: MauPoint[]): MauReading => {
    const r = readMauPoints(points || [])

    // Unknown damper state: the AHU's half-open pose, so the blades still read as blades.
    const open = r.faDamperOpen == null ? 0.62 : r.faDamperOpen
    damperBlades.forEach(b => { b.rotation.z = open * Math.PI * 0.45 })

    preFilterMat.color.copy(filterColour(r.preFilterDirty))
    bagFilterMat?.color.copy(filterColour(r.bagFilterDirty))

    if (r.coolingValvePos == null) coilMat.color.copy(COIL_IDLE)
    else coilMat.color.copy(COIL_CLOSED).lerp(COIL_OPEN, r.coolingValvePos)

    bladeMat.color.copy(r.sfOn == null ? NO_DATA : r.sfOn ? FAN_ON : FAN_OFF)
    rate = r.sfRate

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
