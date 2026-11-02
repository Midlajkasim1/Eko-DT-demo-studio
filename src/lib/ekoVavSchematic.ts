import * as THREE from 'three'
import {
  HvacPoint, HvacAnchor,
  FAN_ON, FAN_OFF, NO_DATA,
  clean, fractionOf, findPoint, shown, stateOf, setDamper,
  resolveFrame, makeHvacCtx,
  buildCentrifugalFan, buildFanOpening, buildDamper, buildSensorProbe,
} from '@/lib/hvacGeometry'

/**
 * The Eko Hospital's VAV (reference: VAV_06's FIN graphic): a fan-powered terminal unit.
 *   air in, left:   a round inlet collar, then the louvered damper with its actuator
 *   inside:         the fan, with its motor
 *   air out, right: a round outlet duct that bends down into a flanged diffuser
 *   probes:         zone humidity above the casing, zone temperature on the outlet
 * Nothing like it is drawn for any other project: no VAV schematic exists elsewhere, and DashboardOverlay mounts this one only for
 * the Eko Hospital project (projectVavSchematic). Everything stays inside the selected element's oriented box (the same
 * resolveFrame the other schematics use) and does not depend on any FIN reading.
 *
 * FIN POINTS: only ZoneTemp is mapped, because FIN's own chart legend in the reference prints it (ZoneTemp, and ZoneTempSp for the
 * set-point). The graphic's other labels (DAMPERPOS, ZONEHUMIDITY, STATUS) are not confirmed FIN names and stay unmapped until the
 * real VAV point list is supplied: those parts keep the no-data grey and show no label. Never add a name here unverified.
 */

export type EkoVavPoint = HvacPoint

export type EkoVavKey = 'damperPos' | 'zoneHum' | 'zoneTemp' | 'fanStatus'

/** Folded FIN point names (lower case, letters and digits only) verified for each key. Empty = not confirmed. */
export type EkoVavPointMap = Record<EkoVavKey, readonly string[]>

export const EKO_VAV_POINT_MAP: EkoVavPointMap = {
  damperPos: [],
  zoneHum: [],
  zoneTemp: ['zonetemp'],
  fanStatus: [],
}

export type EkoVavReading = Record<EkoVavKey, string> & {
  /** 0 closed .. 1 open; null when FIN sends none */
  damperOpen: number | null
  fanOn: boolean | null
}

export type EkoVavSchematic = {
  group: THREE.Group
  anchors: HvacAnchor[]
  apply: (points: EkoVavPoint[]) => EkoVavReading
  tick: (dt: number) => void
  dispose: () => void
}

export function readEkoVavPoints(points: EkoVavPoint[], map: EkoVavPointMap = EKO_VAV_POINT_MAP): EkoVavReading {
  const raw = (key: EkoVavKey): string | null => {
    const names = map[key]
    if (!names.length) return null
    return clean(findPoint(points, k => names.includes(k))?.currentValue)
  }
  const damper = raw('damperPos'), status = raw('fanStatus')
  return {
    damperOpen: damper == null ? null : fractionOf(damper),
    fanOn: stateOf(status),
    damperPos: shown(damper, ' %'),
    zoneHum: shown(raw('zoneHum'), ' %RH'),
    zoneTemp: shown(raw('zoneTemp'), ' °C'),
    fanStatus: shown(status, ''),
  }
}

export function createEkoVavSchematic(
  localBox:    THREE.Box3,
  modelMatrix: THREE.Matrix4,
  casing?:     THREE.Object3D,
): EkoVavSchematic | null {
  const frame = resolveFrame(localBox, modelMatrix, casing)
  if (!frame) return null
  const { center, long, up, width, hx, hy, hz } = frame

  // Inlet toward the model's local -X, outlet toward +X, so the unit reads the same whichever way it was modelled
  const localX = new THREE.Vector3(1, 0, 0).transformDirection(modelMatrix)
  if (long.dot(localX) < 0) {
    long.negate()
    width.negate()
  }

  const group = new THREE.Group()
  group.position.copy(center)
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(long, up, width))
  group.userData.ekoHospitalVav = true

  const ctx = makeHvacCtx('ekoHospitalVav')

  // The air runs along y0, in the upper part of the box so the outlet has room to bend down inside it
  const y0 = hy * 0.30
  const r = Math.max(0.02, Math.min(hy * 0.42, hz * 0.8))
  const axis = new THREE.Group()
  axis.position.y = y0
  group.add(axis)

  const metal = ctx.metal(0x8a939c, 0.6, 0.4)
  const dark = ctx.metal(0x2a313a, 0.5, 0.45)
  const alongX = (g: THREE.BufferGeometry) => { g.rotateZ(Math.PI / 2); return g }

  // Inlet: a round collar and its rim
  const inletX = -hx * 0.86
  const inlet = new THREE.Group()
  inlet.userData.ekoVavInlet = true
  axis.add(inlet)
  const collar = ctx.add(alongX(new THREE.CylinderGeometry(r * 0.95, r * 0.95, hx * 0.16, 28, 1, true)), metal, inlet)
  collar.position.x = inletX
  ;(collar.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
  const rim = new THREE.TorusGeometry(r * 0.95, r * 0.07, 8, 28)
  rim.rotateY(Math.PI / 2)
  ctx.add(rim, dark, inlet).position.x = inletX + hx * 0.08

  // Damper assembly: the louvers and their actuator
  const damperBlades = buildDamper(ctx, axis, r * 2, r * 1.8, -hx * 0.40)

  // Fan with its motor
  const fanX = hx * 0.16
  const fan = buildCentrifugalFan(ctx, { group: axis, hy: r * 1.25, hz: Math.min(hz * 0.95, r * 2.6), fanX })
  buildFanOpening(ctx, axis, fanX, fan.fanR)
  fan.rotor.userData.ekoVavFan = true

  // Outlet: a round duct from the casing, a quarter bend, a riser, and a flanged diffuser
  const rt = Math.max(0.01, Math.min(r * 0.55, hx * 0.06))
  const bendR = Math.max(rt * 1.6, Math.min(r * 1.1, hx * 0.25, (y0 + hy * 0.75) * 0.5))
  const riserX = hx * 0.88
  const bendX = riserX - bendR
  const outlet = new THREE.Group()
  outlet.userData.ekoVavOutlet = true
  group.add(outlet)
  const casingEnd = hx * 0.5
  const runLen = Math.max(0.001, bendX - casingEnd)
  const run = ctx.add(alongX(new THREE.CylinderGeometry(rt, rt, runLen, 18)), metal, outlet)
  run.position.set(casingEnd + runLen / 2, y0, 0)
  const bend = ctx.add(new THREE.TorusGeometry(bendR, rt, 12, 20, Math.PI / 2), metal, outlet)
  bend.position.set(bendX, y0 - bendR, 0)
  const yBendEnd = y0 - bendR
  const yFlange = -hy * 0.84
  const riserLen = Math.max(0.001, yBendEnd - yFlange)
  ctx.add(new THREE.CylinderGeometry(rt, rt, riserLen, 18), metal, outlet).position.set(riserX, yBendEnd - riserLen / 2, 0)
  const flangeR = Math.max(rt * 1.2, Math.min(r * 0.95, hx * 0.11, hz * 0.9))
  ctx.add(new THREE.CylinderGeometry(flangeR, flangeR, hy * 0.02, 28), dark, outlet).position.set(riserX, yFlange, 0)
  const coneH = hy * 0.13
  ctx.add(new THREE.CylinderGeometry(flangeR, rt, coneH, 28, 1, true), metal, outlet).position.set(riserX, yFlange - coneH / 2, 0)

  // Probes: humidity above the casing, temperature on the outlet duct
  const HUM = 0xbfdbfe, TEMP = 0xf8fafc
  const zH = hz * 0.3
  const humX = hx * 0.42
  const tempX = hx * 0.80
  const probeY = y0 + r * 1.05
  buildSensorProbe(ctx, group, humX, probeY, zH, r * 2, HUM)
  buildSensorProbe(ctx, group, tempX, y0 + rt * 1.3, 0, r * 2, TEMP)
  group.userData.ekoVavLayout = { probes: 2, inletX: inletX, fanX, riserX, y0 }

  // Labels: the graphic's names, not FIN point names. Every one is optional: shown only while a verified point sends a value.
  const top = hy * 0.98
  const at = (key: EkoVavKey, title: string, x: number, y: number, z: number, side: HvacAnchor['side']): HvacAnchor =>
    ({ key, title, position: new THREE.Vector3(x, y, z), side, optional: true })
  const anchors: HvacAnchor[] = [
    at('damperPos', 'DAMPERPOS',    -hx * 0.40, top,     0,  'above'),
    at('zoneHum',   'ZONEHUMIDITY',  humX,      top,     zH, 'above'),
    at('zoneTemp',  'ZONETEMP',      tempX,     top,     0,  'above'),
    at('fanStatus', 'STATUS',        fanX,      y0 - r,  0,  'below'),
  ]

  let fanRate = 0
  const apply = (points: EkoVavPoint[]): EkoVavReading => {
    const r2 = readEkoVavPoints(points || [])
    setDamper(damperBlades, r2.damperOpen)
    fan.bladeMat.color.copy(r2.fanOn == null ? NO_DATA : r2.fanOn ? FAN_ON : FAN_OFF)
    fanRate = r2.fanOn ? 1.9 : 0
    return r2
  }
  apply([])

  return {
    group,
    anchors,
    apply,
    tick: dt => { if (fanRate) fan.rotor.rotation.z += fanRate * dt },
    dispose: () => { group.removeFromParent(); ctx.disposeAll() },
  }
}

/** The VAV schematic of a project: the Eko Hospital's where its graphics are on, none anywhere else (as before). */
export function projectVavSchematic(
  hospitalHvac: boolean,
  localBox:     THREE.Box3,
  modelMatrix:  THREE.Matrix4,
  casing?:      THREE.Object3D,
): EkoVavSchematic | null {
  return hospitalHvac ? createEkoVavSchematic(localBox, modelMatrix, casing) : null
}
