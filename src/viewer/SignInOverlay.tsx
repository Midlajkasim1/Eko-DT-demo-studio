import { useEffect, useState } from 'react'

// Current routes first, legacy second — matches backend/login.html behavior
const STATUS_URLS = ['/api/auth/status', '/api/fin/status']
const LOGIN_URLS = ['/api/auth/login', '/api/fin/login']
// Who THIS browser is signed in as (its session cookie). The status above says only whether the
// backend is connected to FIN, which another browser's sign-in also makes true.
const ME_URLS = ['/api/auth/me', '/api/fin/me']

async function requestFirst(urls: string[], options?: RequestInit): Promise<Response | null> {
  let lastErr: unknown = null
  for (const url of urls) {
    try {
      const res = await fetch(url, options)
      if (res.status !== 404) return res
    } catch (err) {
      lastErr = err
    }
  }
  if (lastErr) throw lastErr
  return null
}

export interface SessionStatus {
  reachable: boolean
  /** This browser has a session (from /api/auth/me), not "the backend is connected to FIN" */
  authenticated: boolean
  /** The session could not be checked (server or network error): retry, never assume */
  error?: boolean
  displayName?: string
  serverUrl?: string
}

/** 'signed_in' | 'signed_out' (401, or a backend without /me) | 'error' */
async function sessionHere(): Promise<'signed_in' | 'signed_out' | 'error'> {
  try {
    const res = await requestFirst(ME_URLS, { cache: 'no-store', credentials: 'same-origin' })
    if (!res || res.status === 401) return 'signed_out'
    return res.ok ? 'signed_in' : 'error'
  } catch {
    return 'error'
  }
}

export async function checkSession(): Promise<SessionStatus> {
  try {
    const res = await requestFirst(STATUS_URLS, { cache: 'no-store' })
    if (!res || !res.ok) return { reachable: false, authenticated: false }
    const data = await res.json()
    const here = await sessionHere()
    return {
      reachable: true,
      authenticated: here === 'signed_in',
      error: here === 'error',
      displayName: data.display_name,
      serverUrl: data.server_url,
    }
  } catch {
    return { reachable: false, authenticated: false }
  }
}

interface SignInOverlayProps {
  ready: boolean
  displayName?: string
  serverUrl?: string
  /** Shown before any sign-in attempt, e.g. when the session could not be checked */
  notice?: string
  onRetry?: () => void
  onSuccess: () => void
}

export function SignInOverlay({ ready, displayName, serverUrl, notice, onRetry, onSuccess }: SignInOverlayProps) {
  const [server, setServer] = useState(serverUrl || 'https://localhost')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const shown = message || notice || ''

  useEffect(() => {
    if (serverUrl) setServer(serverUrl)
  }, [serverUrl])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')
    setBusy(true)
    try {
      const res = await requestFirst(LOGIN_URLS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          server_url: server.trim().replace(/\/+$/, ''),
        }),
      })
      if (!res) {
        setMessage('Login endpoint not found. Restart the server and try again.')
        setBusy(false)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.status === 'success') {
        // FIN accepted the sign-in; carry on once the server confirms this browser's session
        const here = await sessionHere()
        if (here === 'signed_in') {
          window.dispatchEvent(new Event('eko-auth-changed'))   // the dashboard bell asks the server again
          onSuccess()
          return
        }
        setMessage(here === 'signed_out'
          ? 'Signed in, but this browser did not keep the session. Allow cookies for this site and try again.'
          : 'Signed in, but the session could not be confirmed. Try again.')
        setBusy(false)
        return
      }
      setMessage(`Access Denied: ${data.detail || data.message || 'Invalid Credentials'}`)
      setBusy(false)
    } catch {
      setMessage('Connection Error: Server Unreachable')
      setBusy(false)
    }
  }

  return (
    <div className="signin-overlay">
      {ready && (
        <div className="signin-card">
          <div className="signin-head">
            <div className="signin-logo">
              <svg viewBox="0 0 948.6 499.7" xmlns="http://www.w3.org/2000/svg">
                <path fill="#FFFFFF" d="M66.8,310.5h285.4c1.3-8.3,2-15.5,2-24.2c0-85.4-68.2-154.6-152.3-154.6S49.6,201,49.6,286.4 S117.8,441,201.9,441c44.7,0,85-19.6,112.8-50.8l-38.4-36.1c-18.3,20.7-44.8,33.7-74.3,33.7c-55.1,0-99.8-45.4-99.8-101.4 S146.9,185,202,185c47.1,0,86.6,33.1,97.1,77.7H94.5L66.8,310.5z"/>
                <path fill="#FFFFFF" d="M375,32.5h62.3v221.9l112.6-114.2h76.5L518.2,244l118.6,178.7h-76l-86.4-137.2l-37.2,36.1v101.1h-62.3V32.5 H375z"/>
                <path fill="#FFFFFF" d="M889,219.3c-6.6-17.2-16.3-32-28.9-44.5c-12.7-12.4-28.2-22.1-46.5-29.2c-18.4-7.1-39.2-10.6-62.7-10.6 s-44.4,3.5-62.7,10.6c-18.4,7.1-74.8,40.9-87.4,53.3l-63.6,45.6l68.6,88.8c14.5,18.8,23.2,31.3,35.9,43.7s28.2,22.2,46.5,29.2 c18.3,7.1,39.2,10.6,62.7,10.6c23.4,0,44.3-3.5,62.7-10.6s33.8-16.8,46.5-29.2c12.6-12.4,22.3-27.2,28.9-44.5 c6.6-17.2,10-36.2,10-56.9C899,255.4,895.6,236.6,889,219.3z M829.5,310.1c-3.2,11.2-8.2,21.3-15,30.3s-15.5,16.2-26.1,21.7 s-23.1,8.3-37.4,8.3c-14.4,0-26.9-2.8-37.5-8.3s-19.3-12.8-26.1-21.7c-6.8-9-11.8-19.1-15-30.3c-3.2-11.2-4.8-22.7-4.8-34.4 c0-11.4,1.6-22.8,4.8-34.1c3.2-11.4,8.2-21.5,15-30.3s15.5-15.9,26.1-21.5c10.6-5.5,23.1-8.3,37.5-8.3c14.3,0,26.8,2.8,37.4,8.3 c10.6,5.5,19.3,12.7,26.1,21.5s11.8,18.9,15,30.3s4.8,22.8,4.8,34.1C834.3,287.5,832.7,298.9,829.5,310.1z"/>
              </svg>
            </div>
            {displayName && <div className="signin-site">{displayName}</div>}
          </div>

          <form onSubmit={submit}>
            <div className="signin-group">
              <label className="signin-label" htmlFor="signin-server">Endpoint URL</label>
              <div className="signin-input-wrap">
                <input
                  id="signin-server"
                  className="signin-input"
                  type="text"
                  value={server}
                  onChange={e => setServer(e.target.value)}
                  placeholder="https://localhost"
                  required
                />
                <svg className="signin-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
                </svg>
              </div>
            </div>

            <div className="signin-group">
              <label className="signin-label" htmlFor="signin-username">Operator ID</label>
              <div className="signin-input-wrap">
                <input
                  id="signin-username"
                  className="signin-input"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Enter your ID"
                  autoComplete="username"
                  autoFocus
                  required
                />
                <svg className="signin-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                </svg>
              </div>
            </div>

            <div className="signin-group">
              <label className="signin-label" htmlFor="signin-password">Authentication Key</label>
              <div className="signin-input-wrap">
                <input
                  id="signin-password"
                  className="signin-input"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your key"
                  autoComplete="current-password"
                  required
                />
                <svg className="signin-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                </svg>
              </div>
            </div>

            <button className="signin-btn" type="submit" disabled={busy}>
              {busy ? 'Authenticating...' : 'Secure Connect'}
            </button>
          </form>

          <div className="signin-message" style={{ opacity: shown ? 1 : 0 }}>{shown}</div>
          {notice && onRetry && !message && (
            <button className="signin-btn" type="button" onClick={onRetry} style={{ marginTop: 8 }}>Retry</button>
          )}
        </div>
      )}
    </div>
  )
}
