import * as THREE from 'three'
import {
  HvacPoint, HvacAnchor,
  COIL_CLOSED, COIL_OPEN, COIL_IDLE, FAN_ON, FAN_OFF, FILTER_CLEAN, FILTER_DIRTY, NO_DATA,
  numberOf, fractionOf, shown, stateOf, dirtyOf, setDamper,
  resolveFrame, makeHvacCtx,
  buildCoil, buildValve, buildCentrifugalFan, buildFanOpening,
  buildDamper, buildPanelFilter, buildBagFilter, buildSensorProbe,
} from '@/lib/hvacGeometry'
import type { HvacCtx } from '@/lib/hvacGeometry'
import { createFahuSchematic } from '@/lib/fahuSchematic'
import { pick, sensor, statusOf, speedOf, part, filterOf, damper } from '@/lib/ekoPointRules'
import type { PointRules } from '@/lib/ekoPointRules'

/**
 * The Eko Hospital's FAHU: two stacked horizontal decks and ONE heat recovery wheel at the joint between them.
 *   lower deck, fresh air to supply:  FA probes, FA damper, pre filter, bag filter, [wheel], cooling coil, supply fan, SA probes
 *   upper deck, return air to exhaust: EA damper, exhaust fan, HRW probes, [wheel], return filter, RA probes
 * It is a different design from Marsa's FAHU (fahuSchematic.ts: a short upper deck and two wheels), which is not touched:
 * DashboardOverlay picks this one only for the Eko Hospital project (fahuSchematicFor).
 *
 * The geometry is fitted to the selected element's oriented box (the same resolveFrame the AHU and FCU use), so it needs
 * one solid or several, and does not depend on any FIN reading.
 *
 * FIN POINTS: read the way readFcuPoints reads them (ekoPointRules.ts): each reading has rules on the point's folded name, so FA_DAMPER,
 * fa-damper and FaDamper are one name; a set-point (...SP), a command or a trip is never taken for the measured value. The rules say what
 * a point IS, not a fixed spelling, so they are checked against the Hospital's real point list rather than assumed: a point that matches
 * nothing leaves its part grey and its label "—". Nothing is ever filled in.
 */

export type EkoFahuPoint = HvacPoint

export type EkoFahuKey =
  | 'faDamper' | 'eaDamper' | 'sfStatus' | 'efStatus' | 'sfSpeed' | 'efSpeed'
  | 'hrwStatus' | 'hrwTemp' | 'hrwHum' | 'preFilter' | 'bagFilter' | 'raFilter' | 'coolingCoil'
  | 'faTemp' | 'raTemp' | 'saTemp' | 'faHum' | 'raHum' | 'saHum'

/** What each reading looks for in the asset's points: flexible on spelling, never a set-point, command or trip */
export type EkoFahuPointRules = PointRules<EkoFahuKey>

const SF = part(['sf'], ['safan', 'supplyfan'])
const EF = part(['ef'], ['eafan', 'exhaustfan'])
const HRW = part(['hrw'], ['heatrecovery', 'wheel'])
export const EKO_FAHU_POINT_RULES: EkoFahuPointRules = {
  faDamper: damper(['fa', 'oa'], ['freshair', 'outsideair', 'outdoorair']),
  eaDamper: damper(['ea'], ['exhaust']),
  sfStatus: [statusOf(SF)],
  efStatus: [statusOf(EF)],
  sfSpeed: [speedOf(SF)],
  efSpeed: [speedOf(EF)],
  hrwStatus: [statusOf(HRW)],
  hrwTemp: [k => HRW(k) && sensor('temp')(k)],
  hrwHum: [k => HRW(k) && sensor('hum')(k)],
  preFilter: [filterOf('prefilter')],
  bagFilter: [filterOf('bagfilter'), k => k.includes('bag') && k.includes('filter') && !k.includes('set')],
  raFilter: [filterOf('rafilter', 'returnfilter')],
  coolingCoil: [sensor('coolingcoil'), sensor('coolingvalvepos'), k => k.includes('coolingvalve') && k.includes('pos') && !k.includes('cmd')],
  faTemp: [sensor('fatemp'), sensor('oatemp')],
  raTemp: [sensor('ratemp')],
  saTemp: [sensor('satemp')],
  faHum: [sensor('fahum'), sensor('oahum')],
  raHum: [sensor('rahum')],
  saHum: [sensor('sahum')],
}

export type EkoFahuReading = Record<EkoFahuKey, string> & {
  faDamperOpen: number | null
  eaDamperOpen: number | null
  /** null when the point is missing: unknown is not clean */
  preFilterDirty: boolean | null
  bagFilterDirty: boolean | null
  raFilterDirty: boolean | null
  coolingValvePos: number | null
  sfFanOn: boolean | null
  efFanOn: boolean | null
  hrwOn: boolean | null
}

export type EkoFahuSchematic = {
  group: THREE.Group
  anchors: HvacAnchor[]
  apply: (points: EkoFahuPoint[]) => EkoFahuReading
  tick: (dt: number) => void
  dispose: () => void
}

function openOf(raw: string | null): number | null {
  if (raw == null) return null
  if (numberOf(raw) != null) return fractionOf(raw)
  const s = stateOf(raw)
  return s == null ? null : s ? 1 : 0
}

export function readEkoFahuPoints(points: EkoFahuPoint[], rules: EkoFahuPointRules = EKO_FAHU_POINT_RULES): EkoFahuReading {
  const raw = (key: EkoFahuKey): string | null => pick(points, rules[key])
  const faDamper = raw('faDamper'), eaDamper = raw('eaDamper')
  const preFilter = raw('preFilter'), bagFilter = raw('bagFilter'), raFilter = raw('raFilter')
  const coil = raw('coolingCoil')
  const sfStatus = raw('sfStatus'), efStatus = raw('efStatus'), hrwStatus = raw('hrwStatus')
  const filterText = (d: boolean | null) => d == null ? '—' : d ? 'Dirty' : 'Clean'
  const preDirty = dirtyOf(preFilter), bagDirty = dirtyOf(bagFilter), raDirty = dirtyOf(raFilter)
  return {
    faDamperOpen: openOf(faDamper),
    eaDamperOpen: openOf(eaDamper),
    preFilterDirty: preDirty,
    bagFilterDirty: bagDirty,
    raFilterDirty: raDirty,
    coolingValvePos: coil == null ? null : fractionOf(coil),
    sfFanOn: stateOf(sfStatus),
    efFanOn: stateOf(efStatus),
    hrwOn: stateOf(hrwStatus),
    faDamper: shown(faDamper, ' %'),
    eaDamper: shown(eaDamper, ' %'),
    sfStatus: shown(sfStatus, ''),
    efStatus: shown(efStatus, ''),
    // The speed's unit is whatever FIN sends: none is added
    sfSpeed: shown(raw('sfSpeed'), ''),
    efSpeed: shown(raw('efSpeed'), ''),
    hrwStatus: shown(hrwStatus, ''),
    hrwTemp: shown(raw('hrwTemp'), ' °C'),
    hrwHum: shown(raw('hrwHum'), ' %RH'),
    preFilter: filterText(preDirty),
    bagFilter: filterText(bagDirty),
    raFilter: filterText(raDirty),
    coolingCoil: shown(coil, ' %'),
    faTemp: shown(raw('faTemp'), ' °C'),
    raTemp: shown(raw('raTemp'), ' °C'),
    saTemp: shown(raw('saTemp'), ' °C'),
    faHum: shown(raw('faHum'), ' %RH'),
    raHum: shown(raw('raHum'), ' %RH'),
    saHum: shown(raw('saHum'), ' %RH'),
  }
}

/** The one wheel: the disc stands across the duct, its axle runs along it, so the air passes through it. */
function buildHeatWheel(ctx: HvacCtx, parent: THREE.Object3D, radius: number): THREE.Group {
  const pivot = new THREE.Group()
  pivot.rotation.y = Math.PI / 2
  parent.add(pivot)

  const rotor = new THREE.Group()
  rotor.userData.ekoFahuRotor = 'hrw'
  pivot.add(rotor)

  const faceMat = ctx.metal(0x2a3138, 0.35, 0.55)
  const rimMat = ctx.metal(0xd5dbe0, 0.72, 0.28)
  const spokeMat = ctx.metal(0xb7c0c8, 0.55, 0.4)
  faceMat.side = THREE.DoubleSide

  ctx.add(new THREE.CircleGeometry(radius * 0.96, 48), faceMat, rotor)
  const back = new THREE.CircleGeometry(radius * 0.96, 48)
  back.rotateY(Math.PI)
  ctx.add(back, faceMat, rotor)

  const depth = Math.max(radius * 0.16, 0.04)
  ctx.add(new THREE.TorusGeometry(radius, depth * 0.45, 8, 40), rimMat, rotor)

  const spoke = new THREE.BoxGeometry(depth * 0.7, radius * 0.9, depth * 0.45)
  spoke.translate(0, radius * 0.45, 0)
  for (let i = 0; i < 12; i++) ctx.add(spoke, spokeMat, rotor).rotation.z = (i / 12) * Math.PI * 2

  const hub = new THREE.CylinderGeometry(radius * 0.08, radius * 0.08, depth, 16)
  hub.rotateX(Math.PI / 2)
  ctx.add(hub, rimMat, rotor)
  return rotor
}

export function createEkoFahuSchematic(
  localBox:    THREE.Box3,
  modelMatrix: THREE.Matrix4,
  casing?:     THREE.Object3D,
): EkoFahuSchematic | null {
  const frame = resolveFrame(localBox, modelMatrix, casing)
  if (!frame) return null
  const { center, long, up, width, hx, hy, hz } = frame

  // Supply fan toward the model's local +X, so the fresh-air end is stable whichever way the unit was modelled
  const localX = new THREE.Vector3(1, 0, 0).transformDirection(modelMatrix)
  if (long.dot(localX) < 0) {
    long.negate()
    width.negate()
  }

  const group = new THREE.Group()
  group.position.copy(center)
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(long, up, width))
  group.userData.ekoHospitalFahu = true

  const ctx = makeHvacCtx('ekoHospitalFahu')

  // Two decks, one above the other, with a partition between them
  const deckY = hy * 0.5
  const dh = hy * 0.45
  const upper = new THREE.Group()
  upper.position.y = deckY
  const lower = new THREE.Group()
  lower.position.y = -deckY
  group.add(upper, lower)
  ctx.add(new THREE.BoxGeometry(hx * 1.92, hy * 0.04, hz * 1.96), ctx.metal(0x3a424b, 0.5, 0.5), group)

  // Lower deck, in airflow order
  const faProbeX = -hx * 0.93
  const faDamperX = -hx * 0.78
  const preX = -hx * 0.52
  const bagX = -hx * 0.28
  const coilX = hx * 0.30
  const sfX = hx * 0.62
  const saProbeX = hx * 0.90
  // Upper deck, in airflow order (return air runs the other way)
  const eaX = -hx * 0.78
  const efX = -hx * 0.48
  const hrwProbeX = -hx * 0.20
  const raFilterX = hx * 0.62
  const raProbeX = hx * 0.90

  const faBlades = buildDamper(ctx, lower, dh, hz, faDamperX)
  const preMat = buildPanelFilter(ctx, lower, dh, hz, preX)
  const bagMat = buildBagFilter(ctx, lower, dh, hz, hx, bagX)
  const eaBlades = buildDamper(ctx, upper, dh, hz, eaX)
  const raMat = buildPanelFilter(ctx, upper, dh, hz, raFilterX)

  const coilHy = dh * 0.7
  const coilHz = hz * 0.62
  const coilR = buildCoil(ctx, { parent: lower, hx, hy: coilHy, hz: coilHz, coilX })
  buildValve(ctx, {
    parent: lower, hy: coilHy, hz: coilHz, span: Math.min(coilHy, coilHz),
    tubeR: coilR.tubeR, coilMat: coilR.coilMat, xs: coilR.xs, yBot: coilR.yBot, tubeLen: coilR.tubeLen,
  })

  const fanHy = dh * 0.8
  const fanHz = Math.min(hz * 0.9, dh * 1.1)
  const sfFan = buildCentrifugalFan(ctx, { group: lower, hy: fanHy, hz: fanHz, fanX: sfX })
  buildFanOpening(ctx, lower, sfX, sfFan.fanR)
  const efFan = buildCentrifugalFan(ctx, { group: upper, hy: fanHy, hz: fanHz, fanX: efX })
  buildFanOpening(ctx, upper, efX, efFan.fanR)

  // One wheel, centred on the joint, tall enough to reach into both decks
  const wheelR = Math.max(0.05, Math.min(hy * 0.94, hz * 0.94))
  const wheelAt = new THREE.Group()
  group.add(wheelAt)
  const hrw = buildHeatWheel(ctx, wheelAt, wheelR)

  // Probes: pale blue is humidity, white is temperature
  const HUM = 0xbfdbfe
  const TEMP = 0xf8fafc
  const sensorY = dh * 0.55
  const zT = -hz * 0.46
  const zH = hz * 0.46
  const probes = (deck: THREE.Object3D, x: number) => {
    buildSensorProbe(ctx, deck, x, sensorY, zT, dh, TEMP)
    buildSensorProbe(ctx, deck, x, sensorY, zH, dh, HUM)
  }
  probes(lower, faProbeX)
  probes(lower, saProbeX)
  probes(upper, hrwProbeX)
  probes(upper, raProbeX)

  // Labels: the graphic's names, not FIN point names. The parts always show (a value, or "—"); speeds and probes show only while FIN sends one.
  const top = hy * 0.98
  const mid = hy * 0.04
  // The parts show "—" when FIN sends nothing (the no-data convention of the FCU); the speeds and the probes show only while FIN sends one
  const OPTIONAL = new Set<EkoFahuKey>(['sfSpeed', 'efSpeed', 'hrwTemp', 'hrwHum', 'faTemp', 'raTemp', 'saTemp', 'faHum', 'raHum', 'saHum'])
  const at = (key: EkoFahuKey, title: string, x: number, y: number, z: number, side: HvacAnchor['side']): HvacAnchor =>
    ({ key, title, position: new THREE.Vector3(x * hx, y, z), side, optional: OPTIONAL.has(key) })
  const anchors: HvacAnchor[] = [
    at('eaDamper',   'EA DAMPER',   -0.78,  top,  0,  'above'),
    at('efStatus',   'EF STATUS',   -0.48,  top,  0,  'above'),
    at('efSpeed',    'EF SPEED',    -0.48,  mid,  0,  'below'),
    at('hrwTemp',    'HRW TEMP',    -0.20,  top,  zT, 'above'),
    at('hrwHum',     'HRW HUMIDITY', -0.20, mid,  zH, 'below'),
    at('raFilter',   'RETURN FILTER', 0.62, top,  0,  'above'),
    at('raTemp',     'RA TEMP',      0.90,  top,  zT, 'above'),
    at('raHum',      'RA HUMIDITY',  0.90,  mid,  zH, 'below'),
    at('faTemp',     'FA TEMP',     -0.93, -mid,  zT, 'above'),
    at('faHum',      'FA HUMIDITY', -0.93, -top,  zH, 'below'),
    at('faDamper',   'FA DAMPER',   -0.78, -top,  0,  'below'),
    at('preFilter',  'PRE FILTER',  -0.52, -top,  0,  'below'),
    at('bagFilter',  'BAG FILTER',  -0.28, -mid,  0,  'above'),
    at('hrwStatus',  'HRW STATUS',   0,    -top,  0,  'below'),
    at('coolingCoil', 'COOLING COIL', 0.30, -top, 0,  'below'),
    at('sfStatus',   'SF STATUS',    0.62, -top,  0,  'below'),
    at('sfSpeed',    'SF SPEED',     0.62, -mid,  0,  'above'),
    at('saTemp',     'SA TEMP',      0.90, -mid,  zT, 'above'),
    at('saHum',      'SA HUMIDITY',  0.90, -top,  zH, 'below'),
  ]

  let efRate = 0
  let sfRate = 0
  let hrwRate = 0
  const apply = (points: EkoFahuPoint[]): EkoFahuReading => {
    const r = readEkoFahuPoints(points || [])
    setDamper(faBlades, r.faDamperOpen)
    setDamper(eaBlades, r.eaDamperOpen)
    const filterColour = (d: boolean | null) => d == null ? NO_DATA : d ? FILTER_DIRTY : FILTER_CLEAN
    preMat.color.copy(filterColour(r.preFilterDirty))
    bagMat.color.copy(filterColour(r.bagFilterDirty))
    raMat.color.copy(filterColour(r.raFilterDirty))
    if (r.coolingValvePos == null) coilR.coilMat.color.copy(COIL_IDLE)
    else coilR.coilMat.color.copy(COIL_CLOSED).lerp(COIL_OPEN, r.coolingValvePos)
    const fanColour = (on: boolean | null) => on == null ? NO_DATA : on ? FAN_ON : FAN_OFF
    sfFan.bladeMat.color.copy(fanColour(r.sfFanOn))
    efFan.bladeMat.color.copy(fanColour(r.efFanOn))
    sfRate = r.sfFanOn ? 1.9 : 0
    efRate = r.efFanOn ? 1.9 : 0
    hrwRate = r.hrwOn ? 1.15 : 0
    return r
  }
  apply([])

  return {
    group,
    anchors,
    apply,
    tick: dt => {
      if (sfRate) sfFan.rotor.rotation.z += sfRate * dt
      if (efRate) efFan.rotor.rotation.z += efRate * dt
      if (hrwRate) hrw.rotation.z += hrwRate * dt
    },
    dispose: () => { group.removeFromParent(); ctx.disposeAll() },
  }
}

/** The FAHU schematic of a project: the Eko Hospital's own design only where its graphics are on, Marsa's (unchanged) everywhere else. */
export function fahuSchematicFor(hospitalHvac: boolean) {
  return hospitalHvac ? createEkoFahuSchematic : createFahuSchematic
}
