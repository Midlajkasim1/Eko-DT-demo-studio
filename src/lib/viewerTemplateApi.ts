import { useAppStore } from '@/store/useAppStore'
import { VIEW_TEMPLATES, getViewTemplate } from '@/constants/viewTemplates'
import type { TemplateId } from '@/constants/renderSettings'

/**
 * The bridge a dashboard template drives the view templates through.
 *
 * The dashboard is injected HTML that runs outside React (see DashboardOverlay),
 * so it needs a plain global rather than a hook. Three ways in, all equivalent:
 *
 *   window.ViewerTemplates.set('xray')
 *   window.dispatchEvent(new CustomEvent('set-viewer-template', { detail: 'xray' }))
 *   window.ViewerTemplates.subscribe(id => …)   // or listen for the event below
 *
 * Every change — from here, from the studio panel, or from the switcher in the
 * exported viewer — comes back out as a `viewer-template-changed` event, so a
 * dashboard can keep its own buttons in step.
 */

export interface ViewerTemplateApi {
  /** Every template that can be picked, in the order the switcher shows them */
  list: () => { id: TemplateId; label: string; note: string }[]
  get: () => TemplateId
  set: (id: TemplateId) => void
  /** Returns an unsubscribe function */
  subscribe: (listener: (id: TemplateId) => void) => () => void
}

declare global {
  interface Window {
    ViewerTemplates?: ViewerTemplateApi
  }
}

export const TEMPLATE_CHANGED_EVENT = 'viewer-template-changed'
export const SET_TEMPLATE_EVENT = 'set-viewer-template'

let installed = false

export function installViewerTemplateApi() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const api: ViewerTemplateApi = {
    list: () => VIEW_TEMPLATES.map(({ id, label, note }) => ({ id, label, note })),
    get: () => useAppStore.getState().templateId,
    set: (id) => useAppStore.getState().setTemplate(id),
    subscribe: (listener) =>
      useAppStore.subscribe((state, prev) => {
        if (state.templateId !== prev.templateId) listener(state.templateId)
      }),
  }
  window.ViewerTemplates = api

  // The detail may be the id on its own or wrapped, so a dashboard button can
  // send whichever shape is easiest for it
  window.addEventListener(SET_TEMPLATE_EVENT, (event: Event) => {
    const detail = (event as CustomEvent).detail
    const id = (typeof detail === 'string' ? detail : detail?.id) as TemplateId | undefined
    if (id) api.set(id)
  })

  api.subscribe(id => {
    const { label, note } = getViewTemplate(id)
    window.dispatchEvent(new CustomEvent(TEMPLATE_CHANGED_EVENT, { detail: { id, label, note } }))
  })
}
