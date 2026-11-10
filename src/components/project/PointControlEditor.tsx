import type { PointControlClass, PointControlRole, PointControlSettings } from '@/types'
import { POINT_CLASSES, POINT_ROLES, rolesFor, storedPointControl } from '@/lib/pointControl'

const ROLE_ORDER: PointControlRole[] = ['setpoint', 'status', 'output', 'choice']

export function PointControlEditor({
  value,
  onChange,
}: {
  value: PointControlSettings | undefined
  onChange: (next: PointControlSettings | undefined) => void
}) {
  const enabled = value?.enabled !== false
  const commit = (draft: PointControlSettings) => onChange(storedPointControl(draft))
  const toggleRole = (cls: PointControlClass, role: PointControlRole) => {
    const current = rolesFor(value, cls)
    const next = current.includes(role) ? current.filter(item => item !== role) : [...current, role]
    commit({
      ...value,
      equipment: { ...value?.equipment, [cls]: ROLE_ORDER.filter(item => next.includes(item)) },
    })
  }
  const setText = (key: 'setpoints' | 'statusPoints' | 'outputPoints' | 'choicePoints', text: string) => {
    commit({ ...value, [key]: text })
  }
  return (
    <>
      <h3 className="ds-section-title" style={{ marginTop: 24 }}>Point control</h3>
      <div className="ds-field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={() => commit({ ...value, enabled: enabled ? false : undefined })}
            style={{ width: 'auto' }}
          />
          Allow the dashboard to change FIN points
        </label>
        <p className="ds-hint">
          A point can be changed only when FIN marks it writable. Setpoints are on for every equipment type:
          a writable number FIN tags as a setpoint, or whose name ends in Sp, Setpoint, Setpt, or Stpt.
          Fire, smoke, and life-safety points stay read-only. A write is a manual override until Return to auto.
        </p>
      </div>
      <div style={{ opacity: enabled ? 1 : 0.45 }}>
        {POINT_CLASSES.map(cls => (
          <div key={cls.id} style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ width: 52, fontSize: 13, fontWeight: 600 }}>{cls.label}</span>
            {POINT_ROLES.map(role => (
              <label key={role.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={rolesFor(value, cls.id).includes(role.id)}
                  disabled={!enabled}
                  onChange={() => toggleRole(cls.id, role.id)}
                  style={{ width: 'auto' }}
                />
                {role.label}
              </label>
            ))}
          </div>
        ))}
        <p className="ds-hint" style={{ marginTop: 8 }}>
          FCU and VAV leave valve, damper, and speed off. Turn a role on for that equipment when this project should write it.
          Add a name when the point is not one of the standard names. Separate names with commas. The word is matched inside the point name.
        </p>
        <details style={{ margin: '8px 0 12px', fontSize: 13 }}>
          <summary style={{ cursor: 'pointer' }}>Standard names already allowed</summary>
          <p className="ds-hint">Setpoints need no list. On/off: Start/Stop, FanCmd, SA Fan Cmd, RA Fan Cmd, SF_VFD_Cmd, EF_VFD_Cmd, Enable_Cmd, Status, Effective_Occupancy.</p>
          <p className="ds-hint">Valve, damper, speed: CoolingCoil, Cooling_Valve_Cmd, OA Damper, MA Damper, EA Damper, SF VFD, RF VFD, and the fan speed commands.</p>
          <p className="ds-hint">Mode: Fan_Speed_Mode, FanSpeed. The point must list its choices in FIN.</p>
        </details>
        <div className="ds-field-row">
          <div className="ds-field">
            <label>Extra setpoint names</label>
            <input
              type="text"
              value={value?.setpoints || ''}
              disabled={!enabled}
              placeholder="Unocc Heat, Comfort"
              onChange={e => setText('setpoints', e.target.value)}
            />
          </div>
          <div className="ds-field">
            <label>Extra on/off names</label>
            <input
              type="text"
              value={value?.statusPoints || ''}
              disabled={!enabled}
              placeholder="Occupancy"
              onChange={e => setText('statusPoints', e.target.value)}
            />
          </div>
        </div>
        <div className="ds-field-row">
          <div className="ds-field">
            <label>Extra valve, damper, speed names</label>
            <input
              type="text"
              value={value?.outputPoints || ''}
              disabled={!enabled}
              placeholder="Cooling Valve, Damper Pos"
              onChange={e => setText('outputPoints', e.target.value)}
            />
          </div>
          <div className="ds-field">
            <label>Extra mode names</label>
            <input
              type="text"
              value={value?.choicePoints || ''}
              disabled={!enabled}
              placeholder="Fan Speed Mode"
              onChange={e => setText('choicePoints', e.target.value)}
            />
          </div>
        </div>
      </div>
    </>
  )
}
