import { useEffect, useRef } from 'react'
import { useProjectStore } from '@/store/useProjectStore'
import { useAppStore } from '@/store/useAppStore'
import { useModelStore } from '@/store/useModelStore'
import type { ProjectApiSettings } from '@/types'

interface DashboardOverlayProps {
  visible: boolean
}

function loadScripts(scripts: HTMLScriptElement[], signal: { mounted: boolean }) {
  return scripts.reduce<Promise<void>>((prev, s) => prev.then(() => new Promise((resolve) => {
    if (!signal.mounted) { resolve(); return }
    if (s.src) {
      const script = document.createElement('script')
      try {
        const url = new URL(s.src)
        url.searchParams.set('v', Date.now().toString())
        script.src = url.toString()
      } catch {
        script.src = s.src + (s.src.includes('?') ? '&' : '?') + 'v=' + Date.now()
      }
      script.async = false
      script.className = 'dt-dashboard-injected'
      script.onload = () => resolve()
      script.onerror = () => resolve()
      document.body.appendChild(script)
    } else {
      try { window.eval(s.innerHTML) } catch (err) { console.error(err) }
      resolve()
    }
  })), Promise.resolve())
}

export function DashboardOverlay({ visible }: DashboardOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const currentProject = useProjectStore(s => s.currentProject)
  const templateId = useAppStore(s => s.templateId)
  const xrayColor = useAppStore(s => s.xrayColor)

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('viewer-state-sync', {
      detail: { templateId, xrayColor }
    }))
  }, [templateId, xrayColor])

  useEffect(() => {
    if (!visible) return
    const signal = { mounted: true }
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent
      if (customEvent.detail?.action === 'setTemplate') {
        const { templateId } = customEvent.detail
        const setLightingParams = useAppStore.getState().setLightingParams
        const setTemplate = useAppStore.getState().setTemplate
        const project = useProjectStore.getState().currentProject
        if (templateId === 'default' && project?.renderSettings) {
          setLightingParams({
            templateId: 'default',
            realisticMode: project.renderSettings.realisticMode ?? false,
            renderLite: project.renderSettings.renderLite ?? false
          })
        } else {
          setTemplate(templateId)
        }
      } else if (customEvent.detail?.action === 'setXrayColor') {
        useAppStore.getState().setLightingParams({ xrayColor: customEvent.detail.color })
      } else if (customEvent.detail?.action === 'isolateModel') {
        const { keyword } = customEvent.detail
        const models = useModelStore.getState().models
        models.forEach(m => {
          // If keyword is 'all', show all. Otherwise, check if modelId contains the keyword.
          const visible = keyword === 'all' || m.modelId.toLowerCase().includes(keyword.toLowerCase())
          useModelStore.getState().setModelVisibility(m.modelId, visible)
        })
      }
    }
    window.addEventListener('dashboard-event', handler)

    fetch('templates/index.html?v=' + Date.now())
      .then(res => res.text())
      .then(html => {
        if (!signal.mounted || !containerRef.current) return
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')

        Array.from(doc.querySelectorAll('style, link[rel="stylesheet"]')).forEach(el => {
          if (el.tagName === 'STYLE') {
            let cssText = el.innerHTML
            cssText = cssText.replace(/body\s*\{/g, '.dashboard-native-container {')
            const style = document.createElement('style')
            style.className = 'dt-dashboard-injected'
            style.innerHTML = cssText
            document.head.appendChild(style)
          } else {
            const link = el.cloneNode() as HTMLLinkElement
            link.className = 'dt-dashboard-injected'
            document.head.appendChild(link)
          }
        })

        const tempDiv = document.createElement('div')
        tempDiv.innerHTML = doc.body.innerHTML
        Array.from(tempDiv.querySelectorAll('script')).forEach(s => s.remove())
        containerRef.current.innerHTML = tempDiv.innerHTML

        const apiSettings: ProjectApiSettings = currentProject?.apiSettings || {}
        const configScript = `
          window.INJECTED_PROJECT_CONFIG = {
            initialTemplate: "${currentProject?.renderSettings?.templateId || 'default'}",
            initialXrayColor: "${currentProject?.renderSettings?.xrayColor || 'blue'}",
            fin: {
              baseUrl: "${apiSettings.finBaseUrl || 'https://localhost'}",
              project: "${apiSettings.finProjectName || ''}",
              interval: ${apiSettings.finInterval || 5000},
              directMode: ${apiSettings.finDirectMode || false},
              livePoints: ${apiSettings.finLivePoints ? JSON.stringify(apiSettings.finLivePoints) : 'undefined'},
              endpoints: ${apiSettings.finEndpoints ? JSON.stringify(apiSettings.finEndpoints) : 'undefined'}
            }
          };
        `
        try { window.eval(configScript) } catch (err) { console.error(err) }

        return loadScripts(Array.from(doc.querySelectorAll('script')), signal)
      })

    return () => {
      signal.mounted = false
      window.removeEventListener('dashboard-event', handler)
      try { (window as any).DashboardOverlayTeardown?.() } catch {}
      try { (window as any).DashboardData?.stop?.() } catch {}
      document.querySelectorAll('.dt-dashboard-injected').forEach(el => el.remove())
      if (containerRef.current) containerRef.current.innerHTML = ''
      delete (window as any).INJECTED_PROJECT_CONFIG
    }
  }, [visible, currentProject?.apiSettings])

  if (!visible) return null

  return (
    <div className="dashboard-overlay-container">
      <div
        ref={containerRef}
        className="dashboard-native-container"
        data-theme="dark"
        data-nav="full"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
    </div>
  )
}
