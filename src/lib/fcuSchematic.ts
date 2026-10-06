import * as THREE from 'three'
import {
  HvacPoint,
  COIL_CLOSED, COIL_OPEN, COIL_IDLE, FAN_ON, FAN_OFF,
  clean, numberOf, findPoint, shown, isRunning,
  resolveFrame, makeHvacCtx,
  buildCoil, buildValve, buildCentrifugalFan,
} from '@/lib/hvacGeometry'

export type FcuPoint = HvacPoint

export type FcuReading = {
  zoneTemp: string
  valvePos: string
  valveCmd: string
  fanSpeed: string
  fanRun:   string
  valveOpen: number | null
  fanOn:     boolean
  fanRate:   number
}

export type FcuAnchor = {
  key:      'zoneTemp' | 'valvePos' | 'valveCmd' | 'fanSpeed' | 'fanRun'
  position: THREE.Vector3
  side:     'above' | 'below'
}

export type FcuSchematic = {
  group:   THREE.Group
  anchors: FcuAnchor[]
  apply:   (points: FcuPoint[]) => FcuReading
  tick:    (dt: number) => void
  dispose: () => void
}

export function readFcuPoints(points: FcuPoint[]): FcuReading {
  const zone  = clean(findPoint(points, k => k.includes('zonetemp') && !k.includes('set') && !k.endsWith('sp'))?.currentValue)
  const pos   = clean(findPoint(points, k => k.includes('coolingvalvepos') || (k.includes('valve') && k.includes('pos') && !k.includes('cmd')))?.currentValue)
  const cmd   = clean(findPoint(points, k => k.includes('coolingvalvecmd') || (k.includes('valve') && (k.includes('cmd') || k.includes('command'))))?.currentValue)
  const speed = clean(findPoint(points, k => k.includes('fanspeed'))?.currentValue)
  const run   = clean(findPoint(points, k => k.includes('fanrun') || k === 'fanstatus')?.currentValue)

  const posN = numberOf(pos)
  let valveOpen: number | null = null
  if (posN != null) {
    const fraction = posN <= 1 && !pos!.includes('%')
    valveOpen = Math.min(1, Math.max(0, fraction ? posN : posN / 100))
  }

  const on     = isRunning(run)
  const speedN = numberOf(speed)
  let fanRate  = 0
  if (on) {
    fanRate = speedN == null
      ? 1.6
      : 0.5 + 2.6 * (Math.min(100, Math.max(0, speedN > 1 ? speedN : speedN * 100)) / 100)
  }

  return {
    zoneTemp: shown(zone,  ' °C'),
    valvePos: shown(pos,   ' %'),
    valveCmd: shown(cmd,   ' %'),
    fanSpeed: shown(speed, ' %'),
    fanRun:   shown(run,   ''),
    valveOpen,
    fanOn: on,
    fanRate,
  }
}

export function createFcuSchematic(
  localBox:    THREE.Box3,
  modelMatrix: THREE.Matrix4,
  casing?:     THREE.Object3D,
): FcuSchematic | null {
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

  const fanX    = hx * 0.48
  const fanR    = buildCentrifugalFan(ctx, { group, hy, hz, fanX })
  const { rotor, bladeMat, fanR: fanRadius } = fanR

  const anchors: FcuAnchor[] = [
    { key: 'zoneTemp', position: new THREE.Vector3(probeX, hy * 0.92,          0),     side: 'above' },
    { key: 'valvePos', position: new THREE.Vector3(coilX,  hy * 0.92,          0),     side: 'above' },
    { key: 'valveCmd', position: new THREE.Vector3(valveX, actY - hy * 0.2, valveZ),   side: 'below' },
    { key: 'fanSpeed', position: new THREE.Vector3(fanX,   fanRadius * 1.2 + hy * 0.08, 0), side: 'above' },
    { key: 'fanRun',   position: new THREE.Vector3(fanX,  -fanRadius * 1.15,   0),     side: 'below' },
  ]

  let rate = 0
  const apply = (points: FcuPoint[]) => {
    const reading = readFcuPoints(points || [])
    if (reading.valveOpen == null) coilMat.color.copy(COIL_IDLE)
    else coilMat.color.copy(COIL_CLOSED).lerp(COIL_OPEN, reading.valveOpen)
    bladeMat.color.copy(reading.fanOn ? FAN_ON : FAN_OFF)
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
