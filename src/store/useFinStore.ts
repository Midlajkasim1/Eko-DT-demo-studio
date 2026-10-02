import { create } from 'zustand'
import type {
  FinEquipment,
  FinPowerLiveResponse,
  FinStatusResponse,
  FinLoginRequest,
} from '@/types/fin'
import type { ProjectApiSettings } from '@/types'
import { useProjectStore } from '@/store/useProjectStore'
import { toBackendSettings } from '@/lib/finSettings'

interface FinState {
  // Connection
  isConnected: boolean
  isAuthenticating: boolean
  connectionError: string | null
  status: FinStatusResponse | null

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

/** Which project's configuration the backend session is running, so it is only re-sent on change */
let appliedConfigKey: string | null = null

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
  equipment: [],
  powerData: null,
  lastUpdated: null,

  login: async (req: FinLoginRequest): Promise<boolean> => {
    set({ isAuthenticating: true, connectionError: null })
    try {
      // The backend signs in with this project's FIN configuration, not just its config.json defaults
      const config = currentProjectConfig()
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
      set({ isConnected: true, isAuthenticating: false, connectionError: null })

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
    try {
      await fetch(`${FIN_API_BASE}/logout`, { method: 'POST' })
    } catch {
      // ignore
    }
    appliedConfigKey = null
    set({
      isConnected: false,
      equipment: [],
      powerData: null,
      lastUpdated: null,
      status: null,
    })
  },

  fetchStatus: async () => {
    try {
      const res = await fetch(`${FIN_API_BASE}/status`)
      if (res.ok) {
        const data: FinStatusResponse = await res.json()
        set({ status: data, isConnected: data.connected })
      }
    } catch {
      // Backend not running
      set({ isConnected: false })
    }
  },

  fetchEquipment: async () => {
    try {
      const res = await fetch(`${FIN_API_BASE}/equip-live`)
      if (res.ok) {
        const data = await res.json()
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
    try {
      const res = await fetch(`${FIN_API_BASE}/power-live`)
      if (res.ok) {
        const data: FinPowerLiveResponse = await res.json()
        set({ powerData: data })
      } else if (res.status === 401) {
        set({ isConnected: false })
      }
    } catch {
      // silent
    }
  },

  syncProjectSettings: async () => {
    const config = currentProjectConfig()
    if (!get().isConnected || !config || config.key === appliedConfigKey) return
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
  },

  setConnectionError: (error) => set({ connectionError: error }),
}))
