import * as THREE from 'three'
import {
  HvacPoint,
  FAN_ON, FAN_OFF, FILTER_CLEAN, FILTER_DIRTY, NO_DATA, UV_ON, UV_ALARM,
  clean, findPoint, shown, stateOf, fractionOf, dirtyOf, bayCentres,
  resolveFrame, makeHvacCtx,
  buildCentrifugalFan, buildFanOpening,
  buildPanelFilter, buildBagFilter, buildBoxFilter, buildUvLamps,
} from '@/lib/hvacGeometry'

export type EcoPoint = HvacPoint

export type EcoReading = {
  preFilterDirty: boolean | null
  preFilter:      string
  bagFilterDirty: boolean | null
  bagFilter:      string
  boxFilterDirty: boolean | null
  boxFilter:      string
  uv1Alarm:       boolean | null
  uv1:            string
  uv2Alarm:       boolean | null
  uv2:            string
  kefOn:          boolean | null
  kefStatus:      string
  vfdRun:         string
  vfdSpeed:       string
  kefHoa:         string
  kefTrip:        string
  allFilterAlarm: string
  commonAlarm:    string
  kefRate:        number
}

export type EcoAnchor = {
  key:      'preFilter' | 'bagFilter' | 'boxFilter' | 'uv1' | 'uv2' | 'kefStatus'
  position: THREE.Vector3
  side:     'above' | 'below'
}

export type EcoSchematic = {
  group:   THREE.Group
  anchors: EcoAnchor[]
  apply:   (points: EcoPoint[]) => EcoReading
  tick:    (dt: number) => void
  dispose: () => void
}

/**
 * Kitchen-exhaust ecology unit (FIN: "ILIANA ECO-ANC09-BF-01"). Point names
 * from its FIN equipment page, folded by keyOf and matched on the end of the
 * name, as readMauPoints does. COMMAN_ALARM is FIN's spelling.
 */
export function readEcoPoints(points: EcoPoint[]): EcoReading {
  const val = (...names: string[]) => {
    for (const n of names) {
      const v = clean(findPoint(points, k => k.endsWith(n))?.currentValue)
      if (v != null) return v
    }
    return null
  }
  // A status in words; text FIN sends that is not a plain on/off is shown as sent.
  const said = (raw: string | null, on: string, off: string) => {
    const s = stateOf(raw)
    return s == null ? shown(raw, '') : s ? on : off
  }
  const filter = (raw: string | null) => {
    const d = dirtyOf(raw)
    return { dirty: d, text: d == null ? shown(raw, '') : d ? 'Dirty' : 'Clean' }
  }

  const pre = filter(val('prefilter'))
  const bag = filter(val('bagfilter'))
  const box = filter(val('boxfilter'))
  const uv1Raw = val('1ststageuvalarm')
  const uv2Raw = val('2ndstageuvalarm')
  const runRaw = val('vfdrunsts')
  const speedRaw = val('vfdspeedpos')

  const kefOn = stateOf(val('kefonsts', 'vfdrunsts'))
  const speed = fractionOf(speedRaw)

  return {
    preFilterDirty: pre.dirty,
    preFilter:      pre.text,
    bagFilterDirty: bag.dirty,
    bagFilter:      bag.text,
    boxFilterDirty: box.dirty,
    boxFilter:      box.text,
    uv1Alarm:       stateOf(uv1Raw),
    uv1:            said(uv1Raw, 'Alarm', 'Normal'),
    uv2Alarm:       stateOf(uv2Raw),
    uv2:            said(uv2Raw, 'Alarm', 'Normal'),
    kefOn,
    kefStatus:      kefOn == null ? '—' : kefOn ? 'On' : 'Off',
    vfdRun:         said(runRaw, 'On', 'Off'),
    vfdSpeed:       shown(speedRaw, ' %'),
    kefHoa:         shown(val('kefhoa'), ''),
    kefTrip:        said(val('keftripsts'), 'Trip', 'Normal'),
    allFilterAlarm: said(val('allfilteralarm'), 'Alarm', 'Normal'),
    commonAlarm:    said(val('commanalarm', 'commonalarm'), 'Alarm', 'Normal'),
    kefRate:        kefOn ? (speed == null ? 1.9 : 0.5 + 2.6 * speed) : 0,
  }
}

export function createEcoSchematic(
  localBox:    THREE.Box3,
  modelMatrix: THREE.Matrix4,
  casing?:     THREE.Object3D,
): EcoSchematic | null {
  const frame = resolveFrame(localBox, modelMatrix, casing)
  if (!frame) return null
  const { center, long, up, width, hx, hy, hz } = frame

  // Same convention as the AHU and MAHU: air enters at the model's local -X end.
  const localX = new THREE.Vector3(1, 0, 0).transformDirection(modelMatrix)
  if (long.dot(localX) < 0) {
    long.negate()
    width.negate()
  }

  const group = new THREE.Group()
  group.position.copy(center)
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(long, up, width))
  group.userData.ekoEco = true

  const ctx = makeHvacCtx('ekoEco')

  // ponytail: section order is assumed (filters coarse to fine, then the two UV stages, then the
  // exhaust fan); the FIN points only say these sections exist. Reorder here once the drawing is confirmed.
  type Bay = 'preFilter' | 'bagFilter' | 'boxFilter' | 'uv1' | 'uv2' | 'fan'
  const { xs } = bayCentres<Bay>(hx, [
    ['preFilter', 1], ['bagFilter', 1], ['boxFilter', 1.3], ['uv1', 1], ['uv2', 1], ['fan', 1.6],
  ])

  const preFilterMat = buildPanelFilter(ctx, group, hy, hz, xs.preFilter)
  const bagFilterMat = buildBagFilter(ctx, group, hy, hz, hx, xs.bagFilter)
  const boxFilterMat = buildBoxFilter(ctx, group, hy, hz, hx, xs.boxFilter)
  const uv1Mat = buildUvLamps(ctx, group, hy, hz, xs.uv1)
  const uv2Mat = buildUvLamps(ctx, group, hy, hz, xs.uv2)

  const fanHy = hy * 0.72
  const fanHz = Math.min(hz * 0.9, hy * 1.1)
  const { rotor, bladeMat, fanR } = buildCentrifugalFan(ctx, { group, hy: fanHy, hz: fanHz, fanX: xs.fan })
  buildFanOpening(ctx, group, xs.fan, fanR)

  const anchors: EcoAnchor[] = [
    { key: 'preFilter', position: new THREE.Vector3(xs.preFilter,  hy * 0.9, 0), side: 'above' },
    { key: 'bagFilter', position: new THREE.Vector3(xs.bagFilter,  hy * 0.9, 0), side: 'above' },
    { key: 'boxFilter', position: new THREE.Vector3(xs.boxFilter,  hy * 0.9, 0), side: 'above' },
    { key: 'uv1',       position: new THREE.Vector3(xs.uv1,       -hy * 0.9, 0), side: 'below' },
    { key: 'uv2',       position: new THREE.Vector3(xs.uv2,       -hy * 0.9, 0), side: 'below' },
    { key: 'kefStatus', position: new THREE.Vector3(xs.fan,       -hy * 0.9, 0), side: 'below' },
  ]

  const filterColour = (d: boolean | null) => d == null ? NO_DATA : d ? FILTER_DIRTY : FILTER_CLEAN
  // Lamps glow violet when healthy, red in alarm, and stay unlit grey with no reading.
  const lamp = (mat: THREE.MeshStandardMaterial, alarm: boolean | null) => {
    mat.color.copy(alarm == null ? NO_DATA : alarm ? UV_ALARM : UV_ON)
    mat.emissive.copy(alarm == null ? new THREE.Color(0) : alarm ? UV_ALARM : UV_ON)
    mat.emissiveIntensity = alarm == null ? 0 : 0.6
  }

  let rate = 0
  const apply = (points: EcoPoint[]): EcoReading => {
    const r = readEcoPoints(points || [])
    preFilterMat.color.copy(filterColour(r.preFilterDirty))
    bagFilterMat.color.copy(filterColour(r.bagFilterDirty))
    boxFilterMat.color.copy(filterColour(r.boxFilterDirty))
    lamp(uv1Mat, r.uv1Alarm)
    lamp(uv2Mat, r.uv2Alarm)
    bladeMat.color.copy(r.kefOn == null ? NO_DATA : r.kefOn ? FAN_ON : FAN_OFF)
    rate = r.kefRate
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
