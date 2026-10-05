import { useState, useCallback, useEffect } from 'react'
import { useFinStore } from '@/store/useFinStore'
import { useProjectStore } from '@/store/useProjectStore'

export function FinLoginPanel() {
  const isConnected = useFinStore(s => s.isConnected)
  const isAuthenticating = useFinStore(s => s.isAuthenticating)
  const connectionError = useFinStore(s => s.connectionError)
  const status = useFinStore(s => s.status)
  const login = useFinStore(s => s.login)
  const logout = useFinStore(s => s.logout)
  const fetchStatus = useFinStore(s => s.fetchStatus)

  const [serverUrl, setServerUrl] = useState('https://localhost')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [projectName, setProjectName] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const syncProjectSettings = useFinStore(s => s.syncProjectSettings)
  const projectId = useProjectStore(s => s.currentProject?.projectId)
  const apiSettings = useProjectStore(s => s.currentProject?.apiSettings)

  // Check backend status on mount
  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // A connected session follows the open project: switching projects or saving
  // Dashboard Settings points the backend at that project's FIN configuration
  useEffect(() => {
    if (isConnected) syncProjectSettings()
  }, [isConnected, projectId, apiSettings, syncProjectSettings])

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    await login({
      username,
      password,
      server_url: serverUrl || undefined,
      project_name: projectName || undefined,
    })
  }, [login, username, password, serverUrl, projectName])

  const handleLogout = useCallback(async () => {
    await logout()
  }, [logout])

  if (isConnected) {
    // false = signed in, but the project name did not resolve on this FIN server.
    // null/undefined = not checked (e.g. an older backend): shown as before.
    const notValidated = status?.project_validated === false
    return (
      <div className="fin-login-panel fin-connected">
        <div className="fin-status-badge">
          <span className="fin-status-dot connected" style={notValidated ? { background: '#d9a400' } : undefined} />
          <span className="fin-status-label">{notValidated ? 'Not validated' : 'FIN Connected'}</span>
        </div>
        {status?.project_validated === true && (
          <div className="fin-validated" style={{ fontSize: '12px', opacity: 0.85 }}>✓ Project validated</div>
        )}
        {notValidated && (
          <div className="fin-error" role="alert">
            FIN connection succeeded, but the selected FIN project could not be validated.
            {status?.project_name ? ` Check the FIN Project Name (${status.project_name}).` : ''}
          </div>
        )}
        <div className="fin-connected-info">
          <span className="fin-project-name">{status?.display_name || status?.project_name || 'FIN'}</span>
          <span className="fin-server-url">{status?.server_url || serverUrl}</span>
          {status?.project_source === 'default' && (
            <span className="fin-server-url" title="This project sets no FIN Project Name, so the backend default is used">
              Project: {status.project_name} (backend default)
            </span>
          )}
        </div>
        <button className="fin-btn fin-btn-disconnect" onClick={handleLogout}>
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className="fin-login-panel">
      <div className="fin-login-header">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" className="fin-icon">
          <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
        </svg>
        <h3>FIN Connect</h3>
      </div>

      <form className="fin-login-form" onSubmit={handleLogin}>
        <div className="fin-field">
          <label htmlFor="fin-server">Server URL</label>
          <input
            id="fin-server"
            type="text"
            value={serverUrl}
            onChange={e => setServerUrl(e.target.value)}
            placeholder="https://localhost"
          />
        </div>

        <div className="fin-field">
          <label htmlFor="fin-username">Username</label>
          <input
            id="fin-username"
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="su"
            autoComplete="username"
            required
          />
        </div>

        <div className="fin-field">
          <label htmlFor="fin-password">Password</label>
          <input
            id="fin-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>

        <button
          type="button"
          className="fin-advanced-toggle"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? '▾ Advanced' : '▸ Advanced'}
        </button>

        {showAdvanced && (
          <div className="fin-field">
            <label htmlFor="fin-project">Project Name</label>
            <input
              id="fin-project"
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="Blank = this project's FIN Project Name"
            />
          </div>
        )}

        {connectionError && (
          <div className="fin-error">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            {connectionError}
          </div>
        )}

        <button
          type="submit"
          className="fin-btn fin-btn-login"
          disabled={isAuthenticating || !username || !password}
        >
          {isAuthenticating ? (
            <>
              <span className="fin-spinner" />
              Authenticating...
            </>
          ) : (
            'Connect'
          )}
        </button>
      </form>
    </div>
  )
}
