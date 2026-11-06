import type { PointControlClass, PointControlRole, PointControlSettings } from '@/types'

export const POINT_CLASSES: { id: PointControlClass; label: string }[] = [
  { id: 'fcu', label: 'FCU' },
  { id: 'vav', label: 'VAV' },
  { id: 'ahu', label: 'AHU' },
  { id: 'fahu', label: 'FAHU' },
  { id: 'mahu', label: 'MAHU' },
]

export const POINT_ROLES: { id: PointControlRole; label: string }[] = [
  { id: 'setpoint', label: 'Setpoint' },
  { id: 'status', label: 'On / off' },
  { id: 'output', label: 'Valve, damper, speed' },
  { id: 'choice', label: 'Mode' },
]

const ROLE_ORDER: PointControlRole[] = ['setpoint', 'status', 'output', 'choice']

export const DEFAULT_ROLES: Record<PointControlClass, PointControlRole[]> = {
  fcu: ['setpoint', 'status', 'choice'],
  vav: ['setpoint', 'status', 'choice'],
  ahu: ['setpoint', 'status', 'output', 'choice'],
  fahu: ['setpoint', 'status', 'output', 'choice'],
  mahu: ['setpoint', 'status', 'output', 'choice'],
}

export function rolesFor(value: PointControlSettings | undefined, cls: PointControlClass): PointControlRole[] {
  const custom = value?.equipment?.[cls]
  if (!Array.isArray(custom)) return DEFAULT_ROLES[cls]
  return ROLE_ORDER.filter(role => custom.includes(role))
}

function sameRoles(a: readonly PointControlRole[], b: readonly PointControlRole[]) {
  return a.length === b.length && a.every((role, i) => role === b[i])
}

/** Undefined when the project is still on the standard policy, so a save does not stamp a copy of it. */
export function storedPointControl(draft: PointControlSettings | undefined): PointControlSettings | undefined {
  if (!draft) return undefined
  const out: PointControlSettings = {}
  if (draft.enabled === false) out.enabled = false
  const equipment: NonNullable<PointControlSettings['equipment']> = {}
  for (const { id } of POINT_CLASSES) {
    const roles = rolesFor(draft, id)
    if (!sameRoles(roles, DEFAULT_ROLES[id])) equipment[id] = roles
  }
  if (Object.keys(equipment).length) out.equipment = equipment
  const text = (key: 'setpoints' | 'statusPoints' | 'outputPoints' | 'choicePoints') => {
    const value = (draft[key] || '').trim()
    if (value) out[key] = value
  }
  text('setpoints')
  text('statusPoints')
  text('outputPoints')
  text('choicePoints')
  return Object.keys(out).length ? out : undefined
}
