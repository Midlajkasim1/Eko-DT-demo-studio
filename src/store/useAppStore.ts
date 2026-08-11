import { create } from 'zustand'
import { RENDER_DEFAULTS, type RenderSettings } from '@/constants/renderSettings'
import type { AppStep } from '@/types'

interface AppState extends RenderSettings {
  step: AppStep
  conversionProgress: number
  conversionStepLabel: string
  error: string | null
  materialPickerActive: boolean
  selectedMaterialElement: { modelId: string, id: number, category?: string } | null
  copiedMaterial: any | null
  isFullscreen: boolean
  isToolbarVisible: boolean

  setStep: (step: AppStep) => void
  setProgress: (progress: number, label?: string) => void
  setError: (error: string) => void
  setRealisticMode: (enabled: boolean) => void
  setLightingParams: (params: Partial<RenderSettings>) => void
  setMaterialPickerActive: (active: boolean) => void
  setSelectedMaterialElement: (element: { modelId: string, id: number, category?: string } | null) => void
  setCopiedMaterial: (material: any) => void
  setIsFullscreen: (full: boolean) => void
  setIsToolbarVisible: (visible: boolean) => void
  reset: () => void
}

export const useAppStore = create<AppState>((set) => ({
  ...RENDER_DEFAULTS,
  step: 'projects',
  conversionProgress: 0,
  conversionStepLabel: '',
  error: null,
  materialPickerActive: false,
  selectedMaterialElement: null,
  copiedMaterial: null,
  isFullscreen: false,
  isToolbarVisible: true,

  setStep: (step) => set({ step, error: null }),
  setProgress: (progress, label = '') => set({ conversionProgress: progress, conversionStepLabel: label }),
  setError: (error) => set({ step: 'error', error }),
  setRealisticMode: (realisticMode) => set({ realisticMode }),
  setLightingParams: (params) => set((state) => ({ ...state, ...params })),
  setMaterialPickerActive: (materialPickerActive) => set({ materialPickerActive, selectedMaterialElement: null }),
  setSelectedMaterialElement: (selectedMaterialElement) => set({ selectedMaterialElement }),
  setCopiedMaterial: (copiedMaterial) => set({ copiedMaterial }),
  setIsFullscreen: (isFullscreen) => set({ isFullscreen }),
  setIsToolbarVisible: (isToolbarVisible) => set({ isToolbarVisible }),
  reset: () =>
    set({
      ...RENDER_DEFAULTS,
      step: 'idle',
      conversionProgress: 0,
      conversionStepLabel: '',
      error: null,
      materialPickerActive: false,
      selectedMaterialElement: null,
      copiedMaterial: null,
      isFullscreen: false,
      isToolbarVisible: true,
    }),
}))
