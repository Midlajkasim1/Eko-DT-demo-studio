import { create } from 'zustand'
import type { MapConfig } from '@/types'

export type MapPhase = 'idle' | 'flying' | 'loading' | 'leaving'
export type MapEditTool = 'none' | 'pin'

interface MapState {
  /** Breadcrumb of location ids, root-first. The last entry is the level being shown. */
  path: string[]
  selectedId: string | null
  /** The pin whose models are in the scene, so returning to the map can restore focus */
  activeLocationId: string | null
  phase: MapPhase

  editing: boolean
  draft: MapConfig | null
  editTool: MapEditTool
  selectedOverlayId: string | null

  enterLevel: (id: string) => void
  exitLevel: () => void
  /** Root-first chain of ids; the caller resolves it from the config, which owns the tree */
  setPath: (path: string[]) => void
  select: (id: string | null) => void
  setPhase: (phase: MapPhase) => void
  setActiveLocationId: (id: string | null) => void

  beginEdit: (config: MapConfig) => void
  updateDraft: (patch: (draft: MapConfig) => MapConfig) => void
  endEdit: () => void
  setEditTool: (tool: MapEditTool) => void
  selectOverlay: (id: string | null) => void

  reset: () => void
}

const INITIAL = {
  path: [] as string[],
  selectedId: null,
  activeLocationId: null,
  phase: 'idle' as MapPhase,
  editing: false,
  draft: null,
  editTool: 'none' as MapEditTool,
  selectedOverlayId: null,
}

export const useMapStore = create<MapState>((set, get) => ({
  ...INITIAL,

  // The level stays selected on the way in, so its detail panel describes what is now on screen
  enterLevel: (id) => set(s => ({ path: [...s.path, id], selectedId: id })),
  exitLevel: () => set(s => ({ path: s.path.slice(0, -1), selectedId: null })),
  setPath: (path) => set({ path, selectedId: null }),

  select: (id) => set({ selectedId: id }),
  setPhase: (phase) => set({ phase }),
  setActiveLocationId: (id) => set({ activeLocationId: id }),

  beginEdit: (config) => set({ editing: true, draft: config }),
  updateDraft: (patch) => {
    const draft = get().draft
    if (!draft) return
    set({ draft: patch(draft) })
  },
  endEdit: () => set({ editing: false, draft: null, editTool: 'none', selectedOverlayId: null }),
  setEditTool: (editTool) => set({ editTool }),
  selectOverlay: (selectedOverlayId) => set({ selectedOverlayId }),

  reset: () => set({ ...INITIAL }),
}))
