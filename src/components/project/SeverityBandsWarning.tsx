/**
 * The backend grades an alarm only from the project's own severity bands (backend main._severity_bands_configured: at least one
 * numeric critical or warning threshold). Without them every alarm is "info" and no alarm notification is made; no default is assumed.
 */
export function severityBandsConfigured(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const bands = value as Record<string, unknown>
  return [bands.critical, bands.warning].some(n => typeof n === 'number' && Number.isFinite(n))
}

/**
 * Shown beside Severity Configuration while the bands being edited cannot grade an alarm.
 * `bandsFromBackend`: the backend grades this project with config.json's own bands (the project is its verified standard site, see
 * finSettings.isStandardProject) or that is not known yet (connected, schema still loading), so nothing the form holds decides it.
 */
export function SeverityBandsWarning({ value, bandsFromBackend = false }: { value: unknown, bandsFromBackend?: boolean }) {
  if (bandsFromBackend || severityBandsConfigured(value)) return null
  return (
    <p
      role="alert"
      data-testid="severity-bands-warning"
      style={{ margin: '0 0 12px', padding: '8px 10px', fontSize: '13px', color: 'var(--text-primary)', border: '1px solid var(--border)', borderLeft: '3px solid var(--amber, #d97706)', borderRadius: '6px' }}
    >
      Alarm notifications are off until this project has severity bands. Set a Critical and/or Warning priority below: without
      them every alarm is graded Info and none is notified. No default thresholds are assumed.
    </p>
  )
}
