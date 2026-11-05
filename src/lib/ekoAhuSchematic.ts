import * as THREE from 'three'
import {
  HvacPoint, HvacAnchor,
  COIL_CLOSED, COIL_OPEN, COIL_IDLE, FAN_ON, FAN_OFF, FILTER_CLEAN, FILTER_DIRTY, NO_DATA,
  numberOf, fractionOf, shown, stateOf, dirtyOf, setDamper,
  resolveFrame, makeHvacCtx,
  buildCoil, buildValve, buildCentrifugalFan, buildFanOpening,
  buildDamper, buildPanelFilter, buildBagFilter, buildSensorProbe,
} from '@/lib/hvacGeometry'
import { createAhuSchematic } from '@/lib/ahuSchematic'
import { pick, sensor, statusOf, part, filterOf, damper } from '@/lib/ekoPointRules'
import type { PointRules } from '@/lib/ekoPointRules'

/**
 * The Eko Hospital's AHU (reference: AHU_02's FIN graphic): two stacked horizontal decks joined by a vertical mixing junction.
 *   lower supply deck, outside air to supply:  OA probes, OA damper, MA probe, [junction], pre filter, bag filter, cooling coil, SA fan, SA probes
 *   upper return deck, return air to exhaust:  RA probes, RA fan, [junction], EA damper
 *   junction: the MA damper between the decks, where part of the return air drops into the supply deck
 * The upper deck is UPPER_LENGTH of the lower deck's length, flush with its outside-air end.
 * This is a different design from the AHU the Marsa project draws (ahuSchematic.ts: one straight casing), which is not touched:
 * DashboardOverlay picks this one only for the Eko Hospital project (projectAhuSchematic).
 *
 * The geometry is fitted to the selected element's oriented box (the same resolveFrame the other schematics use) and does not
 * depend on any FIN reading.
 *
 * FIN POINTS: read the way readFcuPoints reads them (ekoPointRules.ts): each reading has rules on the point's folded name, so FA_DAMPER,
 * fa-damper and FaDamper are one name; a set-point (...SP), a command or a trip is never taken for the measured value. The rules say what
 * a point IS, not a fixed spelling, so they are checked against the Hospital's real point list rather than assumed: a point that matches
 * nothing leaves its part grey and its label "—". Nothing is ever filled in.
 */

export type EkoAhuPoint = HvacPoint

export type EkoAhuKey =
  | 'oaDamper' | 'maDamper' | 'eaDamper' | 'raFanStatus' | 'saFanStatus'
  | 'preFilter' | 'bagFilter' | 'coolingCoil'
  | 'oaTemp' | 'oaHum' | 'maTemp' | 'raTemp' | 'raHum' | 'raCo2' | 'saTemp' | 'saHum' | 'saPressure'

/** What each reading looks for in the asset's points: flexible on spelling, never a set-point, command or trip */
export type EkoAhuPointRules = PointRules<EkoAhuKey>

const RA_FAN = part([], ['rafan', 'returnfan'])
const SA_FAN = part([], ['safan', 'supplyfan'])
export const EKO_AHU_POINT_RULES: EkoAhuPointRules = {
  oaDamper: damper(['oa'], ['outsideair', 'outdoorair', 'freshair']),
  maDamper: damper(['ma'], ['mixedair', 'mixingair']),
  eaDamper: damper(['ea'], ['exhaust']),
  raFanStatus: [statusOf(RA_FAN)],
  saFanStatus: [statusOf(SA_FAN)],
  preFilter: [filterOf('prefilter')],
  bagFilter: [filterOf('bagfilter'), k => k.includes('bag') && k.includes('filter') && !k.includes('set')],
  coolingCoil: [sensor('coolingcoil'), sensor('coolingvalvepos'), k => k.includes('coolingvalve') && k.includes('pos') && !k.includes('cmd')],
  oaTemp: [sensor('oatemp')],
  oaHum: [sensor('oahum')],
  maTemp: [sensor('matemp')],
  raTemp: [sensor('ratemp')],
  raHum: [sensor('rahum')],
  raCo2: [sensor('raco2'), k => sensor('co2')(k) && k.includes('ra')],
  saTemp: [sensor('satemp')],
  saHum: [sensor('sahum')],
  saPressure: [sensor('sapressure'), sensor('sadp')],
}

export type EkoAhuReading = Record<EkoAhuKey, string> & {
  oaDamperOpen: number | null
  maDamperOpen: number | null
  eaDamperOpen: number | null
  /** null when the point is missing: unknown is not clean */
  preFilterDirty: boolean | null
  bagFilterDirty: boolean | null
  coolingValvePos: number | null
  raFanOn: boolean | null
  saFanOn: boolean | null
}

export type EkoAhuSchematic = {
  group: THREE.Group
  anchors: HvacAnchor[]
  apply: (points: EkoAhuPoint[]) => EkoAhuReading
  tick: (dt: number) => void
  dispose: () => void
}

/** The upper deck's length as a share of the lower deck's */
export const UPPER_LENGTH = 0.6

function openOf(raw: string | null): number | null {
  if (raw == null) return null
  if (numberOf(raw) != null) return fractionOf(raw)
  const s = stateOf(raw)
  return s == null ? null : s ? 1 : 0
}

export function readEkoAhuPoints(points: EkoAhuPoint[], rules: EkoAhuPointRules = EKO_AHU_POINT_RULES): EkoAhuReading {
  const raw = (key: EkoAhuKey): string | null => pick(points, rules[key])
  const oa = raw('oaDamper'), ma = raw('maDamper'), ea = raw('eaDamper')
  const pre = raw('preFilter'), bag = raw('bagFilter'), coil = raw('coolingCoil')
  const raFan = raw('raFanStatus'), saFan = raw('saFanStatus')
  const filterText = (d: boolean | null) => d == null ? '—' : d ? 'Dirty' : 'Clean'
  const preDirty = dirtyOf(pre), bagDirty = dirtyOf(bag)
  return {
    oaDamperOpen: openOf(oa),
    maDamperOpen: openOf(ma),
    eaDamperOpen: openOf(ea),
    preFilterDirty: preDirty,
    bagFilterDirty: bagDirty,
    coolingValvePos: coil == null ? null : fractionOf(coil),
    raFanOn: stateOf(raFan),
    saFanOn: stateOf(saFan),
    oaDamper: shown(oa, ' %'),
    maDamper: shown(ma, ' %'),
    eaDamper: shown(ea, ' %'),
    raFanStatus: shown(raFan, ''),
    saFanStatus: shown(saFan, ''),
    preFilter: filterText(preDirty),
    bagFilter: filterText(bagDirty),
    coolingCoil: shown(coil, ' %'),
    oaTemp: shown(raw('oaTemp'), ' °C'),
    oaHum: shown(raw('oaHum'), ' %RH'),
    maTemp: shown(raw('maTemp'), ' °C'),
    raTemp: shown(raw('raTemp'), ' °C'),
    raHum: shown(raw('raHum'), ' %RH'),
    raCo2: shown(raw('raCo2'), ' ppm'),
    saTemp: shown(raw('saTemp'), ' °C'),
    saHum: shown(raw('saHum'), ' %RH'),
    saPressure: shown(raw('saPressure'), ' Pa'),
  }
}

export function createEkoAhuSchematic(
  localBox:    THREE.Box3,
  modelMatrix: THREE.Matrix4,
  casing?:     THREE.Object3D,
): EkoAhuSchematic | null {
  const frame = resolveFrame(localBox, modelMatrix, casing)
  if (!frame) return null
  const { center, long, up, width, hx, hy, hz } = frame

  // Outside-air end toward the model's local -X, supply fan toward +X, so the layout is stable whichever way the unit was modelled
  const localX = new THREE.Vector3(1, 0, 0).transformDirection(modelMatrix)
  if (long.dot(localX) < 0) {
    long.negate()
    width.negate()
  }

  const group = new THREE.Group()
  group.position.copy(center)
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(long, up, width))
  group.userData.ekoHospitalAhu = true

  const ctx = makeHvacCtx('ekoHospitalAhu')

  // Two decks with a gap between them for the mixing junction
  const deckY = hy * 0.52
  const dh = hy * 0.44
  const gap = (deckY - dh) * 2
  const upper = new THREE.Group()
  upper.position.y = deckY
  const lower = new THREE.Group()
  lower.position.y = -deckY
  group.add(upper, lower)

  // Along the length, as a share of the half length hx. Lower deck: the full length. Upper deck: UPPER_LENGTH of it, flush at -hx.
  const upperEnd = -1 + 2 * UPPER_LENGTH
  const junctionX = -0.20
  const junctionHalf = 0.075
  const L = {
    oaProbe: -0.95, oaDamper: -0.78, maProbe: -0.48, preFilter: -0.02, bagFilter: 0.16, coil: 0.36, saFan: 0.62, saProbe: 0.86,
    eaDamper: -0.86, raFan: -0.02, raProbe: upperEnd - 0.04,
  }

  // Casing hint: the underside of the upper deck and the top of the lower deck, open at the junction
  const plateMat = ctx.metal(0x3a424b, 0.5, 0.5)
  const plate = (x0: number, x1: number, y: number) => {
    if (x1 - x0 < 1e-6) return
    ctx.add(new THREE.BoxGeometry((x1 - x0) * hx, hy * 0.025, hz * 1.96), plateMat, group).position.set((x0 + x1) / 2 * hx, y, 0)
  }
  plate(-1, junctionX - junctionHalf, gap / 2)
  plate(junctionX + junctionHalf, upperEnd, gap / 2)
  plate(-1, junctionX - junctionHalf, -gap / 2)
  plate(junctionX + junctionHalf, 1, -gap / 2)
  const wallGeo = new THREE.BoxGeometry(hx * 0.012, gap, hz * 1.96)
  for (const s of [-1, 1]) ctx.add(wallGeo, plateMat, group).position.set((junctionX + s * junctionHalf) * hx, 0, 0)

  // Dampers: OA at the lower inlet, EA at the upper outlet, MA across the junction (air passes it vertically)
  const oaBlades = buildDamper(ctx, lower, dh, hz, L.oaDamper * hx)
  const eaBlades = buildDamper(ctx, upper, dh, hz, L.eaDamper * hx)
  const junction = new THREE.Group()
  junction.position.set(junctionX * hx, 0, 0)
  junction.rotation.z = Math.PI / 2
  junction.userData.ekoAhuJunction = true
  group.add(junction)
  const maBlades = buildDamper(ctx, junction, hx * junctionHalf * 1.05, hz * 0.92, 0)

  const preMat = buildPanelFilter(ctx, lower, dh, hz, L.preFilter * hx)
  const bagMat = buildBagFilter(ctx, lower, dh, hz, hx, L.bagFilter * hx)

  const coilHy = dh * 0.7
  const coilHz = hz * 0.62
  const coilR = buildCoil(ctx, { parent: lower, hx, hy: coilHy, hz: coilHz, coilX: L.coil * hx })
  buildValve(ctx, {
    parent: lower, hy: coilHy, hz: coilHz, span: Math.min(coilHy, coilHz),
    tubeR: coilR.tubeR, coilMat: coilR.coilMat, xs: coilR.xs, yBot: coilR.yBot, tubeLen: coilR.tubeLen,
  })

  const fanHy = dh * 0.8
  const fanHz = Math.min(hz * 0.9, dh * 1.1)
  const saFan = buildCentrifugalFan(ctx, { group: lower, hy: fanHy, hz: fanHz, fanX: L.saFan * hx })
  buildFanOpening(ctx, lower, L.saFan * hx, saFan.fanR)
  saFan.rotor.userData.ekoAhuFan = 'sa'
  const raFan = buildCentrifugalFan(ctx, { group: upper, hy: fanHy, hz: fanHz, fanX: L.raFan * hx })
  buildFanOpening(ctx, upper, L.raFan * hx, raFan.fanR)
  raFan.rotor.userData.ekoAhuFan = 'ra'

  // Nine probes: pale blue humidity, white temperature, green CO2, yellow pressure
  const HUM = 0xbfdbfe, TEMP = 0xf8fafc, CO2 = 0xbbf7d0, PRESS = 0xfde68a
  const sensorY = dh * 0.55
  const zT = -hz * 0.46
  const zH = hz * 0.46
  let probeCount = 0
  const probe = (deck: THREE.Object3D, x: number, z: number, tint: number) => {
    buildSensorProbe(ctx, deck, x * hx, sensorY, z, dh, tint)
    probeCount++
  }
  probe(lower, L.oaProbe, zT, TEMP)
  probe(lower, L.oaProbe, zH, HUM)
  probe(lower, L.maProbe, 0, TEMP)
  probe(upper, L.raProbe, zH, HUM)
  probe(upper, L.raProbe, 0, CO2)
  probe(upper, L.raProbe, zT, TEMP)
  probe(lower, L.saProbe, zH, HUM)
  probe(lower, L.saProbe, zT, PRESS)
  probe(lower, L.saProbe, 0, TEMP)

  group.userData.ekoAhuLayout = {
    lowerLength: 2 * hx, upperLength: UPPER_LENGTH * 2 * hx, junctionX: junctionX * hx, probes: probeCount,
  }

  // Labels: the graphic's names, not FIN point names. The parts always show (a value, or "—"); the probes show only while FIN sends one.
  const top = hy * 0.98
  const mid = hy * 0.04
  // The parts show "—" when FIN sends nothing (the no-data convention of the FCU and the original AHU); only the probes are optional
  const PROBES = new Set<EkoAhuKey>(['oaTemp', 'oaHum', 'maTemp', 'raTemp', 'raHum', 'raCo2', 'saTemp', 'saHum', 'saPressure'])
  const at = (key: EkoAhuKey, title: string, x: number, y: number, z: number, side: HvacAnchor['side']): HvacAnchor =>
    ({ key, title, position: new THREE.Vector3(x * hx, y, z), side, optional: PROBES.has(key) })
  const anchors: HvacAnchor[] = [
    // upper deck
    at('eaDamper',    'EA DAMPER',    L.eaDamper,    top,  0,  'above'),
    at('raFanStatus', 'RA FAN STATUS', L.raFan,      top,  0,  'above'),
    at('raCo2',       'RA CO2',       L.raProbe - 0.10, mid, 0, 'below'),
    at('raHum',       'RA HUMIDITY',  L.raProbe,     top,  zH, 'above'),
    at('raTemp',      'RA TEMP',      L.raProbe,     mid,  zT, 'below'),
    // junction
    at('maDamper',    'MA DAMPER',    junctionX,     0,    0,  'above'),
    // lower deck
    at('oaDamper',    'OA DAMPER',    L.oaDamper,   -top,  0,  'below'),
    at('oaHum',       'OA HUMIDITY',  L.oaProbe,    -mid,  zH, 'above'),
    at('oaTemp',      'OA TEMP',      L.oaProbe,    -top,  zT, 'below'),
    at('maTemp',      'MA TEMP',      L.maProbe,    -top,  0,  'below'),
    at('preFilter',   'PREFILTER',    L.preFilter,  -top,  0,  'below'),
    at('bagFilter',   'BAGFILTER',    L.bagFilter,  -mid,  0,  'above'),
    at('coolingCoil', 'COOLINGCOIL',  L.coil,       -top,  0,  'below'),
    at('saFanStatus', 'SA FAN STATUS', L.saFan,     -top,  0,  'below'),
    at('saHum',       'SA HUMIDITY',  L.saProbe,    -mid,  zH, 'above'),
    at('saPressure',  'SA PRESSURE',  L.saProbe,    -top,  zT, 'below'),
    at('saTemp',      'SA TEMP',      L.saProbe,    -top,  0,  'below'),
  ]

  let saRate = 0
  let raRate = 0
  const apply = (points: EkoAhuPoint[]): EkoAhuReading => {
    const r = readEkoAhuPoints(points || [])
    setDamper(oaBlades, r.oaDamperOpen)
    setDamper(maBlades, r.maDamperOpen)
    setDamper(eaBlades, r.eaDamperOpen)
    const filterColour = (d: boolean | null) => d == null ? NO_DATA : d ? FILTER_DIRTY : FILTER_CLEAN
    preMat.color.copy(filterColour(r.preFilterDirty))
    bagMat.color.copy(filterColour(r.bagFilterDirty))
    if (r.coolingValvePos == null) coilR.coilMat.color.copy(COIL_IDLE)
    else coilR.coilMat.color.copy(COIL_CLOSED).lerp(COIL_OPEN, r.coolingValvePos)
    const fanColour = (on: boolean | null) => on == null ? NO_DATA : on ? FAN_ON : FAN_OFF
    saFan.bladeMat.color.copy(fanColour(r.saFanOn))
    raFan.bladeMat.color.copy(fanColour(r.raFanOn))
    saRate = r.saFanOn ? 1.9 : 0
    raRate = r.raFanOn ? 1.9 : 0
    return r
  }
  apply([])

  return {
    group,
    anchors,
    apply,
    tick: dt => {
      if (saRate) saFan.rotor.rotation.z += saRate * dt
      if (raRate) raFan.rotor.rotation.z += raRate * dt
    },
    dispose: () => { group.removeFromParent(); ctx.disposeAll() },
  }
}

/** The AHU schematic of a project: the Eko Hospital's own design where its graphics are on, the original AHU (as before) everywhere else. */
export function projectAhuSchematic(
  hospitalHvac: boolean,
  localBox:     THREE.Box3,
  modelMatrix:  THREE.Matrix4,
  casing?:      THREE.Object3D,
) {
  return hospitalHvac
    ? createEkoAhuSchematic(localBox, modelMatrix, casing)
    : createAhuSchematic(localBox, modelMatrix, casing, { hospitalHvac: false })
}
