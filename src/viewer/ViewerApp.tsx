import { useRef, useCallback, useState, useEffect } from 'react'
import { ViewerCanvas } from '@/components/viewer/ViewerCanvas'
import { useAppStore } from '@/store/useAppStore'
import { useModelStore } from '@/store/useModelStore'
import { loadProjectFromHandle, loadModelsFromProject } from '@/lib/projectDb'
import { streamHttpModels } from '@/lib/projectLoad'
import { useProjectStore } from '@/store/useProjectStore'
import { useLoadingProgressStore } from '@/store/useLoadingProgressStore'
import { useMapStore } from '@/store/useMapStore'
import { hasMap } from '@/lib/mapConfig'
import { dashboardProjectInfo } from '@/lib/finSettings'
import { MapLayer } from '@/components/map/MapLayer'
import { SignInOverlay, checkSession } from '@/viewer/SignInOverlay'
import { EkoLoading } from '@/components/viewer/EkoLoading'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import type { ProjectMeta } from '@/types'

export default function ViewerApp() {
  const engineRef = useRef<FragmentsEngine | null>(null)
  const setStep = useAppStore(s => s.setStep)
  const setRealisticMode = useAppStore(s => s.setRealisticMode)
  const setLightingParams = useAppStore(s => s.setLightingParams)
  const addModel = useModelStore(s => s.addModel)
  const models = useModelStore(s => s.models)

  const [projectMeta, setProjectMeta] = useState<ProjectMeta | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [standalone, setStandalone] = useState(false)
  const [auth, setAuth] = useState<'checking' | 'required' | 'authed'>('checking')
  const [sessionInfo, setSessionInfo] = useState<{ displayName?: string; serverUrl?: string }>({})
  const progressActive = useLoadingProgressStore(s => s.sessionActive)

  // Session gate runs in parallel with model loading — models stream in behind
  // the sign-in overlay, so the scene is ready (or close to it) once the
  // operator is authenticated
  useEffect(() => {
    let mounted = true
    checkSession().then(s => {
      if (!mounted) return
      setSessionInfo({ displayName: s.displayName, serverUrl: s.serverUrl })
      setAuth(s.reachable && !s.authenticated ? 'required' : 'authed')
    })
    return () => { mounted = false }
  }, [])

  // Apply saved render settings from project.json
  const applyRenderSettings = useCallback((meta: ProjectMeta) => {
    if (meta.renderSettings) {
      setRealisticMode(meta.renderSettings.realisticMode)
      setLightingParams(meta.renderSettings)
    }
  }, [setRealisticMode, setLightingParams])

  // Apply saved camera position after engine is ready
  const applyCameraPosition = useCallback((meta: ProjectMeta) => {
    if (!meta.camera) return
    const tryApply = (attempts = 0) => {
      const engine = engineRef.current
      if (engine && meta.camera) {
        engine.world.camera.controls.setLookAt(
          meta.camera.position[0], meta.camera.position[1], meta.camera.position[2],
          meta.camera.target[0], meta.camera.target[1], meta.camera.target[2],
          false
        )
      } else if (attempts < 20) {
        setTimeout(() => tryApply(attempts + 1), 300)
      }
    }
    setTimeout(() => tryApply(), 500)
  }, [])

  // Manual folder picker (fallback if auto-load fails)
  const handleOpenProject = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const handle = await (window as any).showDirectoryPicker()
      const meta = await loadProjectFromHandle(handle)

      if (!meta) {
        setError('No project.json found in this folder')
        setIsLoading(false)
        return
      }

      setProjectMeta(meta)
      useProjectStore.setState({ currentProject: meta, folderHandle: handle })
      applyRenderSettings(meta)

      // A project with a map opens on it, and loads nothing until a location is picked
      if (hasMap(meta)) {
        useMapStore.getState().reset()
        setStep('map')
        return
      }

      const { beginSession, updateEntry } = useLoadingProgressStore.getState()
      beginSession(meta.models.map(m => ({
        modelId: m.modelId,
        name: m.originalFileName,
        sizeBytes: m.convertedFileSizeBytes || m.originalFileSizeBytes || 0,
      })), 'disk')

      await loadModelsFromProject(handle, meta, (pm, readMs) => {
        updateEntry(pm.modelId, { phase: 'pending', readMs, bytesRead: pm.fragBytes.byteLength, sizeBytes: pm.fragBytes.byteLength })
        addModel({
          modelId: pm.modelId,
          originalFileName: pm.originalFileName,
          originalFileSizeBytes: pm.originalFileSizeBytes,
          convertedFileSizeBytes: pm.convertedFileSizeBytes,
          conversionTimeMs: pm.conversionTimeMs,
          fragBytes: pm.fragBytes,
          type: pm.type,
          position: pm.position,
          rotation: pm.rotation,
          scale: pm.scale,
        })
      }, (modelId, bytesRead, totalBytes) => {
        updateEntry(modelId, { phase: 'reading', bytesRead, sizeBytes: totalBytes })
      })
      setStep('viewing')
      applyCameraPosition(meta)
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError(e?.message ?? 'Failed to open project')
      }
    } finally {
      setIsLoading(false)
    }
  }, [addModel, setStep, applyRenderSettings, applyCameraPosition])

  const handleEngineReady = useCallback(
    (ref: React.MutableRefObject<FragmentsEngine | null>) => {
      engineRef.current = ref.current
    },
    []
  )

  // Auto-load: fetches project.json and models/ from the FastAPI backend
  useEffect(() => {
    let mounted = true
    async function autoLoad() {
      try {
        setIsLoading(true)

        // Retry up to 3 times (server may still be starting)
        let res: Response | null = null
        for (let i = 0; i < 3; i++) {
          try {
            res = await fetch('project.json')
            if (res.ok) break
          } catch (e) {
            if (i === 2) throw e
            await new Promise(r => setTimeout(r, 800))
          }
        }

        if (!res || !res.ok) throw new Error('project.json not found')

        const contentType = res.headers.get('content-type') || ''
        if (contentType.includes('text/html')) {
          throw new Error('Received HTML instead of JSON — not running in standalone mode.')
        }

        const meta = (await res.json()) as ProjectMeta
        if (!mounted) return
        setStandalone(true)

        if (meta.isFinProject && meta.apiSettings) {
          const s = meta.apiSettings
          ;(window as any).INJECTED_PROJECT_CONFIG = {
            ...dashboardProjectInfo(meta),
            fin: {
              baseUrl: s.finBaseUrl || 'https://localhost',
              project: s.finProjectName || '',
              interval: s.finInterval || 5000,
              directMode: s.finDirectMode || false,
              livePoints: s.finLivePoints || undefined,
              endpoints: s.finEndpoints || undefined,
              realtimeMs: s.finRealtimeMs || undefined,
              workorderExpr: s.finWorkorderExpr || '',
              meterProfile: s.finMeterProfile || undefined,
              severityBands: s.finSeverityBands || undefined,
              equipmentClasses: s.finEquipmentClasses || undefined,
              realtimeEndpoints: s.finRealtimeEndpoints || undefined,
            },
            weather: {
              lat: s.weatherLat ?? 24.469,
              lon: s.weatherLon ?? 54.358,
              apiKey: s.weatherApiKey || undefined,   // only the project's own key
            },
            navButtons: s.navButtons || undefined,
            leftCards: s.leftCards || undefined,
            rightCards: s.rightCards || undefined,
            sideButtons: s.sideButtons ? s.sideButtons.filter((b: any) => b.enabled !== false) : undefined,
            subPanels: s.subPanels || undefined,
            modelsConfig: s.modelsConfig || undefined,
            floorsConfig: s.floorsConfig || undefined,
          }
          console.log('[ViewerApp] Injected FIN project config for standalone viewer')
        }

        setProjectMeta(meta)
        useProjectStore.setState({ currentProject: meta })
        applyRenderSettings(meta)

        // A project with a map opens on it, and loads nothing until a location is picked
        if (hasMap(meta)) {
          useMapStore.getState().reset()
          setStep('map')
          return
        }

        await streamHttpModels(meta, { isCancelled: () => !mounted })

        if (mounted) {
          setStep('viewing')
          applyCameraPosition(meta)
        }
      } catch (e: any) {
        // Expected in dev server — silently ignore, show manual picker instead
        console.info('Auto-load skipped (dev mode or error):', e.message)
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    autoLoad()
    return () => { mounted = false }
  }, [setStep, applyRenderSettings, applyCameraPosition])

  const step = useAppStore(s => s.step)
  const hasModels = models.length > 0

  return (
    <div className="app-layout">
      {/* Body — no header, no sidebar, full screen */}
      <div className="app-body">
        <main className="app-main">
          {/* adminMode=false hides RenderPanel + ModelPositionPanel */}
          <ViewerCanvas onEngineReady={handleEngineReady} adminMode={false} isFinProject={projectMeta?.isFinProject} />
          <MapLayer adminMode={false} engineRef={engineRef} showProjectExit={false} />

          {/* Open Project overlay — dev fallback only, never in the exported viewer */}
          {!standalone && !hasModels && !isLoading && step !== 'map' && (
            <div className="viewer-overlay" style={{ background: 'rgba(245,246,248,0.92)' }}>
              <div style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '40px',
                maxWidth: '400px',
                width: '100%',
                textAlign: 'center',
                boxShadow: '0 8px 32px rgba(0,0,0,0.06)',
              }}>
                <svg viewBox="0 0 64 64" fill="none" width="56" height="56" style={{ margin: '0 auto 20px', display: 'block', opacity: 0.3 }}>
                  <rect x="8" y="20" width="20" height="28" rx="2" stroke="currentColor" strokeWidth="2"/>
                  <rect x="32" y="12" width="20" height="36" rx="2" stroke="currentColor" strokeWidth="2"/>
                  <path d="M8 44h44" stroke="currentColor" strokeWidth="2"/>
                </svg>

                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                  Open Project
                </h2>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 24 }}>
                  Select the project folder to load the 3D models.
                </p>

                {error && (
                  <div className="upload-error" style={{ marginBottom: 16, justifyContent: 'center' }}>
                    <span>⚠</span> {error}
                  </div>
                )}

                <button
                  className="download-btn"
                  onClick={handleOpenProject}
                  disabled={isLoading}
                  style={{ width: '100%' }}
                >
                  <>
                    <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
                    </svg>
                    Select Project Folder
                  </>
                </button>
              </div>
            </div>
          )}

          {/* Before a percentage exists, the same EKO splash with no number */}
          {isLoading && !progressActive && <EkoLoading />}

          {/* Sign-in gate — models keep streaming in behind it */}
          {auth !== 'authed' && (
            <SignInOverlay
              ready={auth === 'required'}
              displayName={sessionInfo.displayName}
              serverUrl={sessionInfo.serverUrl}
              onSuccess={() => setAuth('authed')}
            />
          )}
        </main>
      </div>
    </div>
  )
}
