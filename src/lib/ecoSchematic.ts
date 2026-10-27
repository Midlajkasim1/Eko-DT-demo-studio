import * as THREE from 'three'
import {
  HvacPoint,
  FAN_ON, FAN_OFF, FAN_FAULT, FILTER_CLEAN, FILTER_DIRTY, NO_DATA, UV_ON, UV_ALARM,
  clean, findPoint, shown, stateOf, faultOf, fractionOf, dirtyOf, bayCentres,
  resolveFrame, makeHvacCtx,
  buildCentrifugalFan, buildFanOpening,
  buildPanelFilter, buildUvCanister,
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
  /** KEF_TRIP_STS set: a fan fault, which is not the same as stopped (kefOn) */
  kefTripped:     boolean | null
  allFilterAlarm: string
  commonAlarm:    string
  kefRate:        number
}

/** The FIN filter points; each physical filter frame in the schematic shows one of them. */
export type EcoFilterPoint = 'PRE_FILTER' | 'BAG_FILTER' | 'BOX_FILTER'

export type EcoOptions = {
  /** One entry per physical filter, in airflow order. */
  filters?: EcoFilterPoint[]
}

/** The three X-braced filter frames on the FIN graphic, in airflow order. */
export const ECO_FILTERS: EcoFilterPoint[] = ['PRE_FILTER', 'BAG_FILTER', 'BOX_FILTER']

export type EcoAnchor = {
  key:      'preFilter' | 'bagFilter' | 'boxFilter' | 'uv1' | 'uv2' | 'kefStatus'
  /** The FIN point the label is for */
  title:    string
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
  const said = (raw: string | null, on: string, off: string, read = stateOf) => {
    const s = read(raw)
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
    uv1Alarm:       faultOf(uv1Raw),
    uv1:            said(uv1Raw, 'Alarm', 'Normal', faultOf),
    uv2Alarm:       faultOf(uv2Raw),
    uv2:            said(uv2Raw, 'Alarm', 'Normal', faultOf),
    kefOn,
    kefStatus:      kefOn == null ? '—' : kefOn ? 'On' : 'Off',
    vfdRun:         said(runRaw, 'On', 'Off'),
    vfdSpeed:       shown(speedRaw, ' %'),
    kefHoa:         shown(val('kefhoa'), ''),
    kefTrip:        said(val('keftripsts'), 'Trip', 'Normal', faultOf),
    kefTripped:     faultOf(val('keftripsts')),
    allFilterAlarm: said(val('allfilteralarm'), 'Alarm', 'Normal', faultOf),
    commonAlarm:    said(val('commanalarm', 'commonalarm'), 'Alarm', 'Normal', faultOf),
    kefRate:        kefOn ? (speed == null ? 1.9 : 0.5 + 2.6 * speed) : 0,
  }
}

export function createEcoSchematic(
  localBox:    THREE.Box3,
  modelMatrix: THREE.Matrix4,
  casing?:     THREE.Object3D,
  options:     EcoOptions = {},
): EcoSchematic | null {
  const { filters = ECO_FILTERS } = options
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

  // The FIN graphic's order: filters, then the two UV stages, then the exhaust fan.
  const bays: [string, number][] = [
    ...filters.map((_, i) => [`filter${i}`, 1] as [string, number]),
    ['uv1', 1], ['uv2', 1], ['fan', 1.6],
  ]
  const { xs } = bayCentres(hx, bays)

  // X-braced panel frames, as drawn on the FIN page.
  const filterMats = filters.map((_, i) => buildPanelFilter(ctx, group, hy, hz, xs[`filter${i}`]))
  const uv1Mat = buildUvCanister(ctx, group, hy, hz, xs.uv1)
  const uv2Mat = buildUvCanister(ctx, group, hy, hz, xs.uv2)

  const fanHy = hy * 0.72
  const fanHz = Math.min(hz * 0.9, hy * 1.1)
  const { rotor, bladeMat, fanR } = buildCentrifugalFan(ctx, { group, hy: fanHy, hz: fanHz, fanX: xs.fan })
  buildFanOpening(ctx, group, xs.fan, fanR)

  const ANCHOR_KEY = { PRE_FILTER: 'preFilter', BAG_FILTER: 'bagFilter', BOX_FILTER: 'boxFilter' } as const
  const anchors: EcoAnchor[] = [
    ...filters.map((f, i) => ({ key: ANCHOR_KEY[f], title: f as string, position: new THREE.Vector3(xs[`filter${i}`], hy * 0.9, 0), side: 'above' as const })),
    { key: 'uv1',       title: '1ST_STAGE_UV_ALARM', position: new THREE.Vector3(xs.uv1, -hy * 0.9, 0), side: 'below' },
    { key: 'uv2',       title: '2ND_STAGE_UV_ALARM', position: new THREE.Vector3(xs.uv2, -hy * 0.9, 0), side: 'below' },
    { key: 'kefStatus', title: 'KEF_ON_STS',         position: new THREE.Vector3(xs.fan, -hy * 0.9, 0), side: 'below' },
  ]

  const filterColour = (d: boolean | null) => d == null ? NO_DATA : d ? FILTER_DIRTY : FILTER_CLEAN
  // The canister glows violet when healthy, red in alarm, and stays unlit grey with no reading.
  const lamp = (mat: THREE.MeshStandardMaterial, alarm: boolean | null) => {
    mat.color.copy(alarm == null ? NO_DATA : alarm ? UV_ALARM : UV_ON)
    mat.emissive.copy(alarm == null ? new THREE.Color(0) : alarm ? UV_ALARM : UV_ON)
    mat.emissiveIntensity = alarm == null ? 0 : 0.6
  }

  let rate = 0
  const apply = (points: EcoPoint[]): EcoReading => {
    const r = readEcoPoints(points || [])
    const dirty = { PRE_FILTER: r.preFilterDirty, BAG_FILTER: r.bagFilterDirty, BOX_FILTER: r.boxFilterDirty }
    filters.forEach((f, i) => filterMats[i].color.copy(filterColour(dirty[f])))
    lamp(uv1Mat, r.uv1Alarm)
    lamp(uv2Mat, r.uv2Alarm)
    // A trip shows whatever the run status says; the blades still turn only on KEF_ON_STS / VFD_RUN_STS
    bladeMat.color.copy(r.kefTripped ? FAN_FAULT : r.kefOn == null ? NO_DATA : r.kefOn ? FAN_ON : FAN_OFF)
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
