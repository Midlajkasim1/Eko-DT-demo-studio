import { useEffect, useState } from 'react'
import {
  FinApiError,
  fetchFinProjects,
  projectIdFromSelection,
  projectLabel,
  savedProjectState,
  type FinProject,
} from '@/lib/finProjects'

interface FinProjectPickerProps {
  /** This Eko-DT project's saved FIN project identifier ('' = none) */
  value: string
  /** FIN session is signed in; the list can only be read through it */
  connected: boolean
  onChange: (projectId: string) => void
}

type Loaded =
  | { attempt: number; state: 'ready'; projects: FinProject[] }
  | { attempt: number; state: 'error'; message: string }

/** FIN Project: a dropdown of the projects FIN reports. It stores the identifier, shows the name,
 *  never picks a project for the user, and keeps manual entry for when the list cannot be loaded. */
export function FinProjectPicker({ value, connected, onChange }: FinProjectPickerProps) {
  // `attempt` counts loads (Retry adds one); an answer for an older attempt counts as still loading
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [manual, setManual] = useState(false)

  useEffect(() => {
    if (!connected) return
    let cancelled = false
    fetchFinProjects().then(
      projects => { if (!cancelled) setLoaded({ attempt, state: 'ready', projects }) },
      (e: unknown) => {
        if (cancelled) return
        const message = e instanceof FinApiError ? e.message : 'Unable to load FIN projects.'
        setLoaded({ attempt, state: 'error', message })
      }
    )
    return () => { cancelled = true }
  }, [connected, attempt])

  const load = connected && loaded && loaded.attempt === attempt ? loaded : null

  const manualInput = (
    <input
      type="text"
      value={value}
      placeholder="FIN project identifier, e.g. the name in /api/{project}/"
      onChange={e => onChange(e.target.value.trim())}
    />
  )

  if (!connected) {
    return (
      <>
        {manualInput}
        <p className="ds-hint" style={{ margin: '4px 0 0' }}>
          Connect to FIN to choose from the projects on the server. Until then the identifier can be typed.
        </p>
      </>
    )
  }

  if (!load) {
    return <p className="ds-hint" style={{ margin: 0 }}>Loading FIN projects...{value ? ` (saved: ${value})` : ''}</p>
  }

  if (load.state === 'error') {
    return (
      <>
        <div style={{ color: 'var(--red)', fontSize: '12px', marginBottom: '6px' }} role="alert">
          Unable to load FIN projects. {load.message}
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
          <button type="button" className="ds-btn ds-btn-secondary" style={{ padding: '4px 12px', fontSize: '12px' }}
            onClick={() => setAttempt(n => n + 1)}>
            Retry
          </button>
        </div>
        {manualInput}
        <p className="ds-hint" style={{ margin: '4px 0 0' }}>Enter the project identifier manually until the list loads.</p>
      </>
    )
  }

  const { projects } = load
  const saved = savedProjectState(projects, value)

  if (manual) {
    return (
      <>
        {manualInput}
        <button type="button" className="ds-btn ds-btn-secondary" style={{ padding: '4px 12px', fontSize: '12px', marginTop: '6px' }}
          onClick={() => setManual(false)}>
          Choose from the list
        </button>
      </>
    )
  }

  return (
    <>
      <select value={value} onChange={e => onChange(projectIdFromSelection(projects, e.target.value))}>
        <option value="">{projects.length ? 'Select FIN project' : 'No FIN projects returned'}</option>
        {saved === 'missing' && <option value={value}>{value} (not available on this FIN server)</option>}
        {projects.map(p => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
      </select>
      {saved === 'missing' && (
        <div style={{ color: 'var(--red)', fontSize: '12px', marginTop: '4px' }} role="alert">
          FIN project is no longer available: {value}. Nothing was changed; pick another project or keep it.
        </div>
      )}
      {!projects.length && (
        <p className="ds-hint" style={{ margin: '4px 0 0' }}>FIN returned no projects for this account.</p>
      )}
      <button type="button" className="ds-btn ds-btn-secondary" style={{ padding: '4px 12px', fontSize: '12px', marginTop: '6px' }}
        onClick={() => setManual(true)}>
        Enter project ID manually
      </button>
    </>
  )
}
