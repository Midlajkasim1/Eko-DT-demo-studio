import { clean, keyOf } from '@/lib/hvacGeometry'
import type { HvacPoint } from '@/lib/hvacGeometry'

/**
 * How the Eko Hospital schematics (AHU, FAHU, VAV) find their FIN points, the way readFcuPoints does: a rule is a test on the point's
 * FOLDED name (lower case, letters and digits only, so FA_DAMPER, fa-damper and FaDamper are all "fadamper"). Rules are tried in
 * order and the first point with a value wins. They match what a point is (a damper position, a supply fan status) rather than a
 * fixed spelling, and they never read a set-point, a command or a trip as the measured value. The points a schematic reads are the
 * selected asset's own: DashboardOverlay.pointsFor hands over one equipment record, matched by its name or GlobalId.
 */

export type PointRule = (key: string) => boolean

/** A set-point: ...SP, ...SPT, setpoint, setpt, "set" in a name that is not "reset" or "offset" (readFcuPoints' own test, widened a little) */
export const isSetpoint: PointRule = k =>
  k.endsWith('sp') || k.endsWith('spt') || k.includes('setpoint') || k.includes('setpt') ||
  (k.includes('set') && !k.includes('reset') && !k.includes('offset'))

/** A command to the equipment, not what it is doing */
export const isCommand: PointRule = k => k.includes('cmd') || k.includes('command')

/** A trip, alarm or fault flag: a fault is not the same as the value it sits beside */
export const isFault: PointRule = k => /trip|alarm|fault|fail/.test(k)

const SPEEDISH = /speed|spd|freq|hz/
const STATUSISH = /status|sts|run|fbk|feedback/

/** A measurement or position that names all of `needs`, and is not a set-point, command or fault */
export const sensor = (...needs: string[]): PointRule => k =>
  needs.every(n => k.includes(n)) && !isSetpoint(k) && !isCommand(k) && !isFault(k)

/** A name that is exactly one of these: for names too short to match by part (a bare "status") */
export const exact = (...names: string[]): PointRule => k => names.includes(k)

/** Something that belongs to a unit part, by a name start (sf, ef) or a name part (supplyfan) */
export const part = (starts: string[], inside: string[]): PointRule => k =>
  starts.some(s => k.startsWith(s)) || inside.some(s => k.includes(s))

/** The run status of a part (never its speed, command or trip) */
export const statusOf = (who: PointRule): PointRule => k =>
  who(k) && STATUSISH.test(k) && !SPEEDISH.test(k) && !isCommand(k) && !isFault(k) && !isSetpoint(k)

/** The speed or frequency of a part (never its command or set-point) */
export const speedOf = (who: PointRule): PointRule => k =>
  who(k) && SPEEDISH.test(k) && !isCommand(k) && !isFault(k) && !isSetpoint(k)

/** A filter status. A filter alarm point is a status here (dirtyOf reads "Alarm" as dirty), but never a set-point or command. */
export const filterOf = (...names: string[]): PointRule => k =>
  names.some(n => k.includes(n)) && !isSetpoint(k) && !isCommand(k)

/** A rule that needs every one of these to hold */
export const all = (...rules: PointRule[]): PointRule => k => rules.every(r => r(k))

/** The value of the first rule that finds a point carrying one, or null: a missing point is "no reading", never a guess */
export function pick(points: HvacPoint[] | null | undefined, rules: readonly PointRule[]): string | null {
  for (const rule of rules) {
    for (const p of points || []) {
      if (!rule(keyOf(p.navName || ''))) continue
      const value = clean(p.currentValue)
      if (value != null) return value
    }
  }
  return null
}

export type PointRules<K extends string> = Record<K, readonly PointRule[]>
