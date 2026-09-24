import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useProjectStore } from '@/store/useProjectStore'
import { useAppStore } from '@/store/useAppStore'
import { useModelStore } from '@/store/useModelStore'
import type { ProjectApiSettings } from '@/types'

import type { FragmentsEngine } from '@/lib/fragmentsEngine'

interface DashboardOverlayProps {
  visible: boolean
  engineRef?: React.MutableRefObject<FragmentsEngine | null>
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

export function DashboardOverlay({ visible, engineRef }: DashboardOverlayProps) {
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
    const engine = engineRef?.current
    if (!engine) return

    const bimIdWorldPos = new Map<string, THREE.Vector3>()
    const bimIdBox = new Map<string, THREE.Box3>()
    const assetNameToBimId = new Map<string, string>()
    const highlightedItems: { model: any; localId: number }[] = []

    const resolveBimId = async (bimId: string): Promise<THREE.Vector3 | null> => {
      if (!engine?.fragments?.models?.list) {
        console.warn(`[DashboardOverlay] resolveBimId(${bimId}): No models list`)
        return null
      }
      if (bimIdWorldPos.has(bimId)) return bimIdWorldPos.get(bimId)!

      for (const [, model] of engine.fragments.models.list.entries()) {
        try {
          const m = model as any
          if (typeof m.getLocalIdsByGuids === 'function') {
            const localIds = await m.getLocalIdsByGuids([bimId])
            if (localIds && localIds[0] != null) {
              const localId = localIds[0]
              console.log(`[DashboardOverlay] resolveBimId(${bimId}): Found localId ${localId}`)
              let box: THREE.Box3 | null = null
              if (typeof m.getMergedBox === 'function') {
                box = await m.getMergedBox([localId])
              }
              if (box && !box.isEmpty()) {
                const worldBox = box.clone().applyMatrix4(m.object.matrixWorld)
                const center = new THREE.Vector3()
                worldBox.getCenter(center)
                bimIdWorldPos.set(bimId, center)
                bimIdBox.set(bimId, worldBox)
                return center
              } else if (typeof m.getPositions === 'function') {
                const posArr = await m.getPositions([localId])
                if (posArr && posArr[0]) {
                  const pos = posArr[0].clone().applyMatrix4(m.object.matrixWorld)
                  bimIdWorldPos.set(bimId, pos)
                  return pos
                }
              } else {
                console.warn(`[DashboardOverlay] resolveBimId(${bimId}): found localId but no getMergedBox/getPositions`)
              }
            }
          }
        } catch (e) {
          console.error(`[DashboardOverlay] resolveBimId(${bimId}): Error during lookup:`, e)
        }
      }
      console.log(`[DashboardOverlay] resolveBimId(${bimId}): Not found in any model`)
      return null
    }

    const resolveAllAssetPositions = async () => {
      console.log('[DashboardOverlay] resolveAllAssetPositions called')
      const eko = (window as any).EKO
      if (!eko?.data) {
        console.warn('[DashboardOverlay] No EKO.data found')
        return
      }
      const assets: any[] = eko.data.assets || []
      const alarms: any[] = eko.data.alarms || []

      console.log(`[DashboardOverlay] Checking ${assets.length} assets and ${alarms.length} alarms for bimId`)

      let updatedAny = false

      for (const asset of assets) {
        if (asset.bimId) {
          assetNameToBimId.set(asset.id, asset.bimId)
          const pos = await resolveBimId(asset.bimId)
          console.log(`[DashboardOverlay] Asset ${asset.id} bimId ${asset.bimId} resolved to:`, pos)
          if (pos) {
            asset.x = pos.x
            asset.y = pos.y
            asset.z = pos.z
            asset.world = { x: pos.x, y: pos.y, z: pos.z }
            updatedAny = true
          }
        }
      }

      for (const alarm of alarms) {
        let bimId = alarm.bimId
        if (!bimId && alarm.asset) {
          bimId = assetNameToBimId.get(alarm.asset)
          if (bimId) alarm.bimId = bimId
        }
        if (bimId) {
          const pos = await resolveBimId(bimId)
          console.log(`[DashboardOverlay] Alarm for asset ${alarm.asset} bimId ${bimId} resolved to:`, pos)
          if (pos) {
            alarm.x = pos.x
            alarm.y = pos.y
            alarm.z = pos.z
            alarm.world = { x: pos.x, y: pos.y, z: pos.z }
            updatedAny = true
          }
        }
      }

      if (updatedAny) {
        console.log('[DashboardOverlay] Positions updated, triggering schedulePosition')
        if (typeof (window as any).EKO_V?.schedulePosition === 'function') {
          (window as any).EKO_V.schedulePosition(eko)
        }
        if (typeof eko.set === 'function') {
          eko.set({})
        }
      } else {
        console.log('[DashboardOverlay] No positions updated')
      }
    }

    const projectPoint = (point: { x: number; y: number; z?: number; bimId?: string; asset?: string; alarm?: string }) => {
      if (!engine?.world?.camera?.three) return null
      const camera = engine.world.camera.three

      let worldVec: THREE.Vector3 | null = null

      if (point.bimId && bimIdWorldPos.has(point.bimId)) {
        worldVec = bimIdWorldPos.get(point.bimId)!
      } else if (point.asset && assetNameToBimId.has(point.asset)) {
        const bId = assetNameToBimId.get(point.asset)!
        if (bimIdWorldPos.has(bId)) worldVec = bimIdWorldPos.get(bId)!
      } else if (point.alarm) {
        const eko = (window as any).EKO
        const al = eko?.data?.alarms?.find((a: any) => a.id === point.alarm)
        if (al?.bimId && bimIdWorldPos.has(al.bimId)) {
          worldVec = bimIdWorldPos.get(al.bimId)!
        }
      }

      if (!worldVec && isFinite(point.x) && isFinite(point.y) && point.z != null && isFinite(point.z) && point.z !== 0) {
        worldVec = new THREE.Vector3(point.x, point.y, point.z)
      }

      if (!worldVec) return null

      const host = document.getElementById('enginehost')
      const hr = host ? host.getBoundingClientRect() : engine.world.renderer.three.domElement.getBoundingClientRect()
      if (hr.width < 2 || hr.height < 2) return { x: 0, y: 0, visible: false }

      const v = worldVec.clone()
      v.project(camera)

      const cameraDir = new THREE.Vector3()
      camera.getWorldDirection(cameraDir)
      const toPoint = worldVec.clone().sub(camera.position)
      const inFront = cameraDir.dot(toPoint) > 0
      const inFrustum = inFront && v.z < 1.0 && v.z > -1.0

      const screenX = (v.x * 0.5 + 0.5) * hr.width
      const screenY = (-v.y * 0.5 + 0.5) * hr.height
      const on = inFrustum && screenX >= 0 && screenX <= hr.width && screenY >= 0 && screenY <= hr.height

      return { x: screenX, y: screenY, visible: on }
    }

    const flyToAsset = async (assetIdOrBimId: string) => {
      if (!engine?.world?.camera?.controls) return false
      let bimId = assetIdOrBimId
      if (assetNameToBimId.has(assetIdOrBimId)) {
        bimId = assetNameToBimId.get(assetIdOrBimId)!
      }

      if (bimIdBox.has(bimId)) {
        const box = bimIdBox.get(bimId)!
        await engine.world.camera.controls.fitToBox(box, true)
        return true
      }

      for (const [, model] of engine.fragments.models.list.entries()) {
        try {
          const m = model as any
          if (typeof m.getLocalIdsByGuids === 'function') {
            const localIds = await m.getLocalIdsByGuids([bimId])
            if (localIds && localIds[0] != null) {
              const localId = localIds[0]
              if (typeof m.getMergedBox === 'function') {
                const box = await m.getMergedBox([localId])
                if (box && !box.isEmpty()) {
                  const worldBox = box.clone().applyMatrix4(m.object.matrixWorld)
                  bimIdBox.set(bimId, worldBox)
                  await engine.world.camera.controls.fitToBox(worldBox, true)
                  return true
                }
              }
            }
          }
        } catch {}
      }
      return false
    }

    const highlightAsset = async (assetIdOrBimId: string) => {
      await clearHighlight()
      if (!engine) return false
      let bimId = assetIdOrBimId
      if (assetNameToBimId.has(assetIdOrBimId)) {
        bimId = assetNameToBimId.get(assetIdOrBimId)!
      }

      for (const [, model] of engine.fragments.models.list.entries()) {
        try {
          const m = model as any
          if (typeof m.getLocalIdsByGuids === 'function') {
            const localIds = await m.getLocalIdsByGuids([bimId])
            if (localIds && localIds[0] != null) {
              const localId = localIds[0]
              if (typeof m.setColor === 'function') {
                await m.setColor([localId], new THREE.Color(0xff8800))
                highlightedItems.push({ model: m, localId })
                return true
              }
            }
          }
        } catch {}
      }
      return false
    }

    const clearHighlight = async () => {
      while (highlightedItems.length > 0) {
        const item = highlightedItems.pop()
        if (item && typeof item.model.resetColor === 'function') {
          try {
            await item.model.resetColor([item.localId])
          } catch {}
        }
      }
    }

    ;(window as any).EKO_HOST_ENGINE = {
      projectPoint,
      resolveAllAssetPositions,
      flyToAsset,
      highlightAsset,
      clearHighlight,
      resolveBimId
    }

    const onCameraUpdate = () => {
      const eko = (window as any).EKO
      if (eko?.engine && typeof eko.engine.fireCameraChange === 'function') {
        eko.engine.fireCameraChange()
      } else if (eko && typeof (window as any).EKO_V?.position === 'function') {
        (window as any).EKO_V.position(eko)
      }
    }

    if (engine.world?.camera?.controls) {
      engine.world.camera.controls.addEventListener('update', onCameraUpdate)
    }

    const timer1 = setTimeout(() => { resolveAllAssetPositions() }, 1000)
    const timer2 = setTimeout(() => { resolveAllAssetPositions() }, 3000)

    return () => {
      if (engine.world?.camera?.controls) {
        engine.world.camera.controls.removeEventListener('update', onCameraUpdate)
      }
      clearTimeout(timer1)
      clearTimeout(timer2)
      delete (window as any).EKO_HOST_ENGINE
    }
  }, [engineRef?.current])

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
        const engine = engineRef?.current
        
        models.forEach(m => {
          // If keyword is 'all', show all. Otherwise, check if originalFileName contains the keyword.
          const isVisible = keyword === 'all' || m.originalFileName.toLowerCase().includes(keyword.toLowerCase())
          useModelStore.getState().setModelVisibility(m.modelId, isVisible)
          
          if (engine) {
            let object3D = null
            if (m.type === 'glb') {
              object3D = engine.world.scene.three.children.find((c: any) => c.userData?.modelId === m.modelId)
            } else {
              const fragModel = engine.fragments.models.list.get(m.modelId)
              object3D = fragModel?.object
            }
            if (object3D) {
              object3D.visible = isVisible
            }
          }
        })
      } else if (customEvent.detail?.action === 'resolveAssets') {
        (window as any).EKO_HOST_ENGINE?.resolveAllAssetPositions?.()
      } else if (customEvent.detail?.action === 'flyToAsset') {
        (window as any).EKO_HOST_ENGINE?.flyToAsset?.(customEvent.detail.assetId)
      } else if (customEvent.detail?.action === 'highlightAsset') {
        (window as any).EKO_HOST_ENGINE?.highlightAsset?.(customEvent.detail.assetId)
      } else if (customEvent.detail?.action === 'clearHighlight') {
        (window as any).EKO_HOST_ENGINE?.clearHighlight?.()
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