import { create } from 'zustand'
import type { LoadedModel } from '@/types'

interface ModelState {
  models: LoadedModel[]
  modelVisibility: Record<string, boolean>
  activeModelId: string | null
  addModel: (model: LoadedModel) => void
  removeModel: (modelId: string) => void
  clearModels: () => void
  toggleVisibility: (modelId: string) => void
  setModelVisibility: (modelId: string, visible: boolean) => void
  setActiveModelId: (modelId: string | null) => void
  updateModelTransform: (modelId: string, transform: { position?: [number, number, number], rotation?: [number, number, number], scale?: [number, number, number] }) => void
  modelsLoadedInEngine: Record<string, boolean>
  markModelLoadedInEngine: (modelId: string) => void
}

export const useModelStore = create<ModelState>((set) => ({
  models: [],
  modelVisibility: {},
  modelsLoadedInEngine: {},
  activeModelId: null,
  addModel: (model) => set((state) => ({ 
    models: [...state.models, model],
    modelVisibility: { ...state.modelVisibility, [model.modelId]: true },
    modelsLoadedInEngine: { ...state.modelsLoadedInEngine, [model.modelId]: false }
  })),
  removeModel: (modelId) => set((state) => {
    const { [modelId]: _, ...restVisibility } = state.modelVisibility
    const { [modelId]: __, ...restLoaded } = state.modelsLoadedInEngine
    return {
      models: state.models.filter(m => m.modelId !== modelId),
      modelVisibility: restVisibility,
      modelsLoadedInEngine: restLoaded,
      activeModelId: state.activeModelId === modelId ? null : state.activeModelId,
    }
  }),
  clearModels: () => set({ models: [], modelVisibility: {}, modelsLoadedInEngine: {}, activeModelId: null }),
  toggleVisibility: (modelId) => set((state) => ({
    modelVisibility: { ...state.modelVisibility, [modelId]: !state.modelVisibility[modelId] }
  })),
  setModelVisibility: (modelId, visible) => set((state) => ({
    modelVisibility: { ...state.modelVisibility, [modelId]: visible }
  })),
  setActiveModelId: (modelId) => set({ activeModelId: modelId }),
  updateModelTransform: (modelId, transform) => set((state) => ({
    models: state.models.map(m => m.modelId === modelId ? { ...m, ...transform } : m),
  })),
  markModelLoadedInEngine: (modelId) => set((state) => ({
    modelsLoadedInEngine: { ...state.modelsLoadedInEngine, [modelId]: true }
  })),
}))
