import { create } from 'zustand'
import type {
  FinEquipment,
  FinPowerLiveResponse,
  FinStatusResponse,
  FinLoginRequest,
  FinSession,
} from '@/types/fin'
import type { ProjectApiSettings } from '@/types'
import { useProjectStore } from '@/store/useProjectStore'
import { toBackendSettings } from '@/lib/finSettings'

interface FinState {
  // Connection: this BROWSER is signed in (its own session, /api/auth/me) and the backend is
  // connected to FIN. Another browser having connected FIN does not make this one connected.
  isConnected: boolean
  isAuthenticating: boolean
  connectionError: string | null
  status: FinStatusResponse | null
  /** Who this browser is signed in as, from the server; null when not signed in here */
  session: FinSession | null
  /** The last /api/auth/me check: an 'error' (network, server) is retryable, never "signed in" */
  sessionCheck: 'unknown' | 'signed_in' | 'signed_out' | 'error'

  // Data
  equipment: FinEquipment[]
  powerData: FinPowerLiveResponse | null
  lastUpdated: string | null

  // Actions
  login: (req: FinLoginRequest) => Promise<boolean>
  logout: () => Promise<void>
  fetchStatus: () => Promise<void>
  fetchEquipment: () => Promise<void>
  fetchPower: () => Promise<void>
  /** Point the live session at the open project's FIN configuration (mappings, severity, ...) */
  syncProjectSettings: () => Promise<void>
  setConnectionError: (error: string | null) => void
}

const FIN_API_BASE = '/api/fin'
const ME_URL = '/api/auth/me'

/** Tell the dashboard (bell) to ask the server again who this browser is. Carries no identity. */
function announceAuthChange() {
  window.dispatchEvent(new Event('eko-auth-changed'))
}

/** This browser's own session: a user, none (401), or an error to retry */
async function readSession(): Promise<{ check: 'signed_in' | 'signed_out' | 'error'; session: FinSession | null }> {
  try {
    const res = await fetch(ME_URL, { cache: 'no-store', credentials: 'same-origin' })
    if (res.status === 401) return { check: 'signed_out', session: null }
    if (!res.ok) return { check: 'error', session: null }
    const me = await res.json()
    return typeof me?.user_id === 'string' ? { check: 'signed_in', session: me } : { check: 'error', session: null }
  } catch {
    return { check: 'error', session: null }
  }
}

/** Which project's configuration the backend session is running, so it is only re-sent on change */
let appliedConfigKey: string | null = null

/** Bumped whenever the session changes project (sign-in, switch, sign-out): an answer to a
 *  request sent before that is dropped, so a slow reply never lands on the next project. */
let dataEpoch = 0

/** Switches run one at a time, each for the project open when it runs, so the last one wins */
let syncChain: Promise<void> = Promise.resolve()

/** The backend stamps data with the Eko-DT project it was polled for (X-Eko-Project). An answer
 *  for another project is dropped; a backend that does not stamp is trusted as before. */
function forOpenProject(res: Response): boolean {
  const stamp = res.headers.get('X-Eko-Project')
  if (stamp === null) return true
  return decodeURIComponent(stamp) === (useProjectStore.getState().currentProject?.projectId ?? '')
}

/** The open project's identity and backend-relevant settings. Every project has them (a project
 *  with none sends {} and the backend falls back to its config.json defaults), so a connected
 *  session never keeps serving the previous project's mappings. null only when no project is open. */
function currentProjectConfig(): { key: string; projectId: string; settings: ProjectApiSettings } | null {
  const project = useProjectStore.getState().currentProject
  if (!project) return null
  const settings = toBackendSettings(project.apiSettings)
  return { key: `${project.projectId}:${JSON.stringify(settings)}`, projectId: project.projectId, settings }
}

export const useFinStore = create<FinState>((set, get) => ({
  isConnected: false,
  isAuthenticating: false,
  connectionError: null,
  status: null,
  session: null,
  sessionCheck: 'unknown',
  equipment: [],
  powerData: null,
  lastUpdated: null,

  login: async (req: FinLoginRequest): Promise<boolean> => {
    set({ isAuthenticating: true, connectionError: null })
    try {
      // The backend signs in with this project's FIN configuration, not just its config.json defaults
      const config = currentProjectConfig()
      dataEpoch++
      const res = await fetch(`${FIN_API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config ? { ...req, settings: config.settings, project_id: config.projectId } : req),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Login failed' }))
        set({ isAuthenticating: false, connectionError: err.detail || 'Login failed' })
        return false
      }
      appliedConfigKey = config?.key ?? null
      // FIN accepted the sign-in; this browser counts as signed in once the server confirms its session
      const me = await readSession()
      if (me.check !== 'signed_in') {
        set({
          isAuthenticating: false, session: null, sessionCheck: me.check,
          connectionError: me.check === 'signed_out'
            ? 'FIN accepted the sign-in, but this browser did not keep its session (are cookies blocked?).'
            : 'Signed in, but your session could not be confirmed. Retry.',
        })
        announceAuthChange()
        return false
      }
      set({ isConnected: true, isAuthenticating: false, connectionError: null, session: me.session, sessionCheck: 'signed_in' })
      announceAuthChange()
      // Signed in is not the same as usable: status carries whether the project name validated
      await get().fetchStatus()

      // Kick off initial data fetch
      setTimeout(() => {
        get().fetchEquipment()
        get().fetchPower()
      }, 2000)

      return true
    } catch (e) {
      set({
        isAuthenticating: false,
        connectionError: e instanceof Error ? e.message : 'Network error',
      })
      return false
    }
  },

  logout: async () => {
    // Ends THIS browser's session; the backend keeps FIN connected for anyone else still signed in
    try {
      await fetch(`${FIN_API_BASE}/logout`, { method: 'POST', credentials: 'same-origin' })
    } catch {
      // ignore
    }
    appliedConfigKey = null
    dataEpoch++
    set({
      isConnected: false,
      session: null,
      sessionCheck: 'signed_out',
      equipment: [],
      powerData: null,
      lastUpdated: null,
      status: null,
    })
    announceAuthChange()
    // What the backend serves now (FIN may still be connected for other users): shown, not inherited
    void get().fetchStatus()
  },

  fetchStatus: async () => {
    // Two questions: is the backend connected to FIN (shared), and is THIS browser signed in (its own)
    const [statusRes, me] = await Promise.all([
      fetch(`${FIN_API_BASE}/status`).then(r => (r.ok ? r.json() as Promise<FinStatusResponse> : null)).catch(() => null),
      readSession(),
    ])
    set({
      status: statusRes,
      session: me.session,
      sessionCheck: me.check,
      isConnected: !!statusRes?.connected && me.check === 'signed_in',
    })
  },

  fetchEquipment: async () => {
    const epoch = dataEpoch
    try {
      const res = await fetch(`${FIN_API_BASE}/equip-live`)
      if (epoch !== dataEpoch) return
      if (res.ok) {
        if (!forOpenProject(res)) return
        const data = await res.json()
        if (epoch !== dataEpoch) return
        set({
          equipment: data.equipment || [],
          lastUpdated: data.timestamp || new Date().toISOString(),
        })
      } else if (res.status === 401) {
        set({ isConnected: false })
      }
    } catch {
      // silent
    }
  },

  fetchPower: async () => {
    const epoch = dataEpoch
    try {
      const res = await fetch(`${FIN_API_BASE}/power-live`)
      if (epoch !== dataEpoch) return
      if (res.ok) {
        if (!forOpenProject(res)) return
        const data: FinPowerLiveResponse = await res.json()
        if (epoch !== dataEpoch) return
        set({ powerData: data })
      } else if (res.status === 401) {
        set({ isConnected: false })
      }
    } catch {
      // silent
    }
  },

  syncProjectSettings: () => {
    syncChain = syncChain.then(() => syncOnce(get, set)).catch(() => { /* the next change retries */ })
    return syncChain
  },

  setConnectionError: (error) => set({ connectionError: error }),
}))

type Get = () => FinState
type Set = (partial: Partial<FinState>) => void

/** One switch of the backend session to the project open now (read when it runs, not when asked) */
async function syncOnce(get: Get, set: Set): Promise<void> {
  const config = currentProjectConfig()
  if (!get().isConnected || !config || config.key === appliedConfigKey) return
  dataEpoch++
  try {
    const res = await fetch(`${FIN_API_BASE}/project-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: config.settings, project_id: config.projectId }),
    })
    if (res.status === 401) {
      set({ isConnected: false })
      return
    }
    if (!res.ok) return
    appliedConfigKey = config.key
    // The switch re-validates the project name, so the badge must follow it
    void get().fetchStatus()
    // Whatever was polled under the previous project must not linger on screen
    set({ equipment: [], powerData: null, lastUpdated: null })
    const data = await res.json().catch(() => ({}))
    if (data.reconnect_required) {
      set({ connectionError: 'This project uses a different FIN server. Disconnect and sign in again.' })
    }
    setTimeout(() => {
      get().fetchEquipment()
      get().fetchPower()
    }, 2000)
  } catch {
    // Backend not reachable; the next change retries
  }
}
