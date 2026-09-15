import { installViewerTemplateApi } from '@/lib/viewerTemplateApi'
import { useAppStore } from '@/store/useAppStore'
import { useProjectStore } from '@/store/useProjectStore'
import type { TemplateId } from '@/constants/renderSettings'

export interface StudioViewerApi {
  setStyle: (id: TemplateId) => void
  setXrayColor: (color: 'blue' | 'white') => void
}

declare global {
  interface Window {
    StudioViewer?: StudioViewerApi
  }
}

let installed = false

export function installStudioViewerApi() {
  if (installed || typeof window === 'undefined') return
  installed = true
  installViewerTemplateApi()
  window.StudioViewer = {
    setStyle: (id) => {
      if (id === 'default') {
        const project = useProjectStore.getState().currentProject
        if (project?.renderSettings) {
          useAppStore.getState().setLightingParams({
            templateId: 'default',
            realisticMode: project.renderSettings.realisticMode ?? false,
            renderLite: project.renderSettings.renderLite ?? false,
          })
          return
        }
      }
      window.ViewerTemplates?.set(id)
    },
    setXrayColor: (color) => {
      useAppStore.getState().setLightingParams({ xrayColor: color })
    },
  }
}
