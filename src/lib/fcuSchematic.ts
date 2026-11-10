import * as THREE from 'three'
import {
  HvacPoint, HvacSchematicOptions,
  COIL_CLOSED, COIL_OPEN, COIL_IDLE, FAN_ON, FAN_OFF, NO_DATA, FILTER_CLEAN, FILTER_DIRTY,
  clean, numberOf, findPoint, shown, stateOf, dirtyOf, keyOf,
  resolveFrame, makeHvacCtx,
  buildCoil, buildValve, buildCentrifugalFan, buildPanelFilter, buildSensorProbe,
} from '@/lib/hvacGeometry'
import { pick, isCommand, isSetpoint, isFault } from '@/lib/ekoPointRules'

export type FcuPoint = HvacPoint

export type FcuReading = {
  zoneTemp: string
  valvePos: string
  valveCmd: string
  /** The Hospital's COOLING_VALVE label: its cooling valve point (COOLINGVALVE), never a command. "—" off the Hospital. */
  valve:    string
  fanSpeed: string
  fanRun:   string
  /** Not every unit reports these: "—" when FIN sends none */
  zoneHum:  string
  filter:   string
  /** null when there is no filter point: unknown is not clean */
  filterDirty: boolean | null
  valveOpen: number | null
  /** From the fan's run STATUS; null when FIN sends none (a run command is not proof it runs) */
  fanOn:     boolean | null
  fanRate:   number
}

export type FcuAnchor = {
  key:      'zoneTemp' | 'valvePos' | 'valveCmd' | 'valve' | 'fanSpeed' | 'fanRun' | 'zoneHum' | 'filter'
  /** The FIN point the label is for */
  title:    string
  position: THREE.Vector3
  side:     'above' | 'below'
  /** Shown only while FIN sends the point: a unit without a filter or humidity point looks as it did */
  optional?: boolean
}

export type FcuSchematic = {
  group:   THREE.Group
  anchors: FcuAnchor[]
  apply:   (points: FcuPoint[]) => FcuReading
  tick:    (dt: number) => void
  dispose: () => void
}

/** The Hospital's cooling valve point: named "cooling valve" (COOLINGVALVE), not a position-suffixed one (read as the position), command, set-point or fault */
const hospitalValve = (k: string) =>
  k.includes('coolingvalve') && !k.includes('pos') && !isCommand(k) && !isSetpoint(k) && !isFault(k)

/** 0–1 from Low, Medium, High or a percent. Auto and an unknown word stay unset. */
function fanStep(raw: string | null): number | null {
  if (!raw) return null
  const word = raw.trim().toLowerCase()
  if (word === 'low') return 1 / 3
  if (word === 'medium' || word === 'med') return 2 / 3
  if (word === 'high') return 1
  if (word === 'off' || word === 'stop' || word === 'stopped') return 0
  if (word === 'auto') return null
  const n = numberOf(raw)
  if (n == null) return null
  const pct = n > 1 ? n : n * 100
  return Math.min(1, Math.max(0, pct / 100))
}

export function readFcuPoints(points: FcuPoint[], options: HvacSchematicOptions = {}): FcuReading {
  const hospital = options.hospitalHvac === true
  const zone  = clean(findPoint(points, k => k.includes('zonetemp') && !k.includes('set') && !k.endsWith('sp'))?.currentValue)
  const pos   = clean(findPoint(points, k => k.includes('coolingvalvepos') || (k.includes('valve') && k.includes('pos') && !k.includes('cmd')))?.currentValue)
  const cmd   = clean(findPoint(points, k => k.includes('coolingvalvecmd') || (k.includes('valve') && (k.includes('cmd') || k.includes('command'))))?.currentValue)
  // Hospital: the cooling valve's own point, else a valve position point (never the command)
  const plain = hospital ? pick(points, [hospitalValve]) : null
  const speedPt = findPoint(points, k => k.includes('fanspeed'))
  const speed = clean(speedPt?.currentValue)
  const isMode = keyOf(speedPt?.navName || '').includes('mode')
  const isCmd = (k: string) => k.includes('cmd') || k.includes('command')
  const run   = clean(findPoint(points, k => (k.includes('fanrun') || k.endsWith('fanstatus') || k.endsWith('fansts')) && !isCmd(k))?.currentValue)
  const hum   = clean(findPoint(points, k => k.includes('zonehum') && !k.includes('set') && !k.endsWith('sp'))?.currentValue)
  const filterRaw = clean(findPoint(points, k => k.endsWith('filter') || k.endsWith('filtersts') || k.endsWith('filterstatus'))?.currentValue)
  const filterDirty = dirtyOf(filterRaw)

  const openRaw = hospital ? pos ?? plain : pos
  const posN = numberOf(openRaw)
  let valveOpen: number | null = null
  if (posN != null) {
    const fraction = posN <= 1 && !openRaw!.includes('%')
    valveOpen = Math.min(1, Math.max(0, fraction ? posN : posN / 100))
  }

  const on   = stateOf(run)
  const step = fanStep(speed)
  let fanRate = 0
  if (on && step !== 0) fanRate = step == null ? 1.6 : 0.5 + 2.6 * step

  return {
    zoneTemp: shown(zone,  ' °C'),
    // Hospital: a position label for the same point as COOLING_VALVE would only repeat it
    valvePos: shown(hospital && plain == null ? null : pos, ' %'),
    valveCmd: shown(cmd,   ' %'),
    valve:    shown(hospital ? plain ?? pos : null, ' %'),
    fanSpeed: shown(speed, isMode ? '' : ' %'),
    fanRun:   shown(run,   ''),
    zoneHum:  shown(hum,   ' %RH'),
    filter:   filterDirty == null ? '—' : filterDirty ? 'Dirty' : 'Clean',
    filterDirty,
    valveOpen,
    fanOn: on,
    fanRate,
  }
}

export function createFcuSchematic(
  localBox:    THREE.Box3,
  modelMatrix: THREE.Matrix4,
  casing?:     THREE.Object3D,
  options:     HvacSchematicOptions = {},
): FcuSchematic | null {
  // Off (every project but the Hospital): no filter, no humidity probe, no labels for them
  const hospital = options.hospitalHvac === true
  const frame = resolveFrame(localBox, modelMatrix, casing)
  if (!frame) return null
  const { center, long, up, width, hx, hy, hz } = frame

  const group = new THREE.Group()
  group.position.copy(center)
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(long, up, width))
  group.userData.ekoFcu = true

  const ctx  = makeHvacCtx('ekoFcu')
  const span = Math.min(hy, hz)

  const coilX  = -hx * 0.12
  const coilR  = buildCoil(ctx, { parent: group, hx, hy, hz, coilX })
  const { coilMat, tubeR, yBot, tubeLen, xs } = coilR

  const valveR = buildValve(ctx, { parent: group, hy, hz, span, tubeR, coilMat, xs, yBot, tubeLen })
  const { valveX, valveZ, actY } = valveR

  const probeMat = ctx.metal(0xe7edf2, 0.82, 0.18)
  const probeX   = -hx * 0.78
  const headH    =  hy * 0.07
  ctx.add(new THREE.BoxGeometry(span * 0.16, headH, span * 0.11), probeMat, group)
    .position.set(probeX, hy - headH * 0.7, 0)
  const stemLen = hy * 0.95
  ctx.add(new THREE.CylinderGeometry(tubeR * 0.5, tubeR * 0.42, stemLen, 12), probeMat, group)
    .position.set(probeX, hy - headH * 0.7 - stemLen / 2, 0)
  ctx.add(new THREE.SphereGeometry(tubeR * 0.95, 14, 10), probeMat, group)
    .position.set(probeX, hy - headH * 0.7 - stemLen, 0)

  // Between the zone probe and the coil, and a second probe beside the first. Both are drawn only while FIN sends their point.
  const filterX = -hx * 0.5
  const humX = probeX
  const humZ = hz * 0.42
  let filterPart: THREE.Group | null = null
  let filterMat: THREE.MeshStandardMaterial | null = null
  let humPart: THREE.Group | null = null
  if (hospital) {
    filterPart = new THREE.Group()
    filterPart.name = 'ekoFcuFilter'
    group.add(filterPart)
    filterMat = buildPanelFilter(ctx, filterPart, hy, hz, filterX)
    humPart = new THREE.Group()
    humPart.name = 'ekoFcuZoneHum'
    group.add(humPart)
    buildSensorProbe(ctx, humPart, humX, hy * 0.8, humZ, hy, 0xbfdbfe)
  }

  const fanX    = hx * 0.48
  const fanR    = buildCentrifugalFan(ctx, { group, hy, hz, fanX })
  const { rotor, bladeMat, fanR: fanRadius } = fanR

  const anchors: FcuAnchor[] = [
    { key: 'zoneTemp', title: 'ZONE_TEMP',          position: new THREE.Vector3(probeX, hy * 0.92,          0),     side: 'above' },
    // Hospital: the valve below the coil is labelled COOLING_VALVE (its FIN point), not the command; the position label shows only for a distinct point
    { key: 'valvePos', title: 'COOLING_VALVE_POS',  position: new THREE.Vector3(coilX,  hy * 0.92,          0),     side: 'above', optional: hospital },
    hospital
      ? { key: 'valve',    title: 'COOLING_VALVE',     position: new THREE.Vector3(valveX, actY - hy * 0.2, valveZ),   side: 'below' }
      : { key: 'valveCmd', title: 'COOLING_VALVE_CMD',  position: new THREE.Vector3(valveX, actY - hy * 0.2, valveZ),   side: 'below' },
    { key: 'fanSpeed', title: 'FAN_SPEED',          position: new THREE.Vector3(fanX,   fanRadius * 1.2 + hy * 0.08, 0), side: 'above' },
    { key: 'fanRun',   title: 'FAN_RUN_STS',        position: new THREE.Vector3(fanX,  -fanRadius * 1.15,   0),     side: 'below' },
    ...(hospital ? [
      { key: 'filter',  title: 'FILTER',        position: new THREE.Vector3(filterX, hy * 0.92, 0),    side: 'above', optional: true },
      { key: 'zoneHum', title: 'ZONE_HUMIDITY', position: new THREE.Vector3(humX,    hy * 0.8,  humZ), side: 'below', optional: true },
    ] as FcuAnchor[] : []),
  ]

  let rate = 0
  const apply = (points: FcuPoint[]) => {
    const reading = readFcuPoints(points || [], { hospitalHvac: hospital })
    if (reading.valveOpen == null) coilMat.color.copy(COIL_IDLE)
    else coilMat.color.copy(COIL_CLOSED).lerp(COIL_OPEN, reading.valveOpen)
    bladeMat.color.copy(reading.fanOn == null ? NO_DATA : reading.fanOn ? FAN_ON : FAN_OFF)
    if (filterPart && filterMat) {
      filterPart.visible = reading.filterDirty != null
      filterMat.color.copy(reading.filterDirty ? FILTER_DIRTY : FILTER_CLEAN)
    }
    if (humPart) humPart.visible = reading.zoneHum !== '—'
    rate = reading.fanRate
    return reading
  }
  apply([])

  return {
    group,
    anchors,
    apply,
    tick:    dt  => { if (rate) rotor.rotation.z += rate * dt },
    dispose: ()  => { group.removeFromParent(); ctx.disposeAll() },
  }
}
