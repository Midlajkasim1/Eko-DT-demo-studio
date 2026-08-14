import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import * as THREE from 'three'
import { useProjectStore } from '@/store/useProjectStore'
import { hasMap } from '@/lib/mapConfig'

interface ViewerToolbarProps {
  engineRef: React.MutableRefObject<FragmentsEngine | null>
  onToggleStats: () => void
  statsVisible: boolean
  pickerActive: boolean
  onTogglePicker: () => void
  dashboardVisible: boolean
  onToggleDashboard: () => void
  materialPickerActive?: boolean
  onToggleMaterialPicker?: () => void
}

import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'

export function ViewerToolbar({ engineRef, onToggleStats, statsVisible, pickerActive, onTogglePicker, dashboardVisible, onToggleDashboard, materialPickerActive, onToggleMaterialPicker }: ViewerToolbarProps) {
  const engine = engineRef.current
  const gridActive = useAppStore(s => s.gridVisible)
  const setLightingParams = useAppStore(s => s.setLightingParams)
  const currentProject = useProjectStore(s => s.currentProject)

  const fitView = async () => {
    if (!engine) return
    try {
      const box = new THREE.Box3()
      engine.world.scene.three.traverse((obj: THREE.Object3D) => {
        if ((obj as THREE.Mesh).isMesh) box.expandByObject(obj)
      })
      if (!box.isEmpty()) {
        await engine.world.camera.controls.fitToBox(box, true)
      }
    } catch (e) { console.warn('fitView error', e) }
  }

  const toggleGrid = () => setLightingParams({ gridVisible: !gridActive })
  const resetCamera = () => {
    if (!engine) return
    const camera = useProjectStore.getState().currentProject?.camera
    if (camera) {
      const pos = camera.position as any
      const tgt = camera.target as any
      
      const px = Array.isArray(pos) ? pos[0] : pos.x
      const py = Array.isArray(pos) ? pos[1] : pos.y
      const pz = Array.isArray(pos) ? pos[2] : pos.z
      
      const tx = Array.isArray(tgt) ? tgt[0] : tgt.x
      const ty = Array.isArray(tgt) ? tgt[1] : tgt.y
      const tz = Array.isArray(tgt) ? tgt[2] : tgt.z

      engine.world.camera.controls.setLookAt(px, py, pz, tx, ty, tz, true)
    } else {
      engine.world.camera.controls.setLookAt(50, 30, 50, 0, 0, 0, true)
    }
  }

  const isFullscreen = useAppStore(s => s.isFullscreen)
  const setIsFullscreen = useAppStore(s => s.setIsFullscreen)
  const setIsToolbarVisible = useAppStore(s => s.setIsToolbarVisible)

  // Listen to the window event dispatched by DraggableFullscreenWidget
  useEffect(() => {
    const handleExit = () => setIsFullscreen(false)
    window.addEventListener('toggle-fullscreen-exit', handleExit)
    return () => window.removeEventListener('toggle-fullscreen-exit', handleExit)
  }, [setIsFullscreen])

  const toggleFullscreen = () => {
    const newFullscreen = !isFullscreen;
    setIsFullscreen(newFullscreen);
    if (newFullscreen) {
      setIsToolbarVisible(false);
    }
  }

  const returnToMap = (window as never as { __returnToMap?: () => void }).__returnToMap
  const showMapButton = hasMap(currentProject) && !!returnToMap

  const tools = [
    ...(showMapButton ? [{
      title: 'Back to map',
      action: () => returnToMap?.(),
      active: false,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15">
          <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z" strokeLinejoin="round" />
          <path d="M9 4v13M15 6.5v13" strokeLinejoin="round" />
        </svg>
      ),
    }] : []),
    {
      title: isFullscreen ? 'Exit Focus Mode' : 'Focus Mode',
      action: toggleFullscreen,
      active: isFullscreen,
      icon: isFullscreen ? (
        <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
          <path d="M5 8h2v2H5V8zm2-3H5v2h2V5zm6 0h-2v2h2V5zm0 5h-2v2h2v-2zM3 3h14v14H3V3z" fillRule="evenodd" clipRule="evenodd"/>
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
          <path d="M3 3h4v2H5v2H3V3zm14 0h-4v2h2v2h2V3zM3 17h4v-2H5v-2H3v4zm14 0h-4v-2h2v-2h2v4z"/>
        </svg>
      ),
    },
    {
      title: 'Fit View',
      action: fitView,
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
          <path d="M3 4a1 1 0 011-1h4a1 1 0 010 2H5.414l3.293 3.293a1 1 0 01-1.414 1.414L4 6.414V8a1 1 0 01-2 0V4zm13 0a1 1 0 00-1-1h-4a1 1 0 000 2h2.586l-3.293 3.293a1 1 0 001.414 1.414L15 6.414V8a1 1 0 002 0V4zm-13 9a1 1 0 011 1v1.586l3.293-3.293a1 1 0 011.414 1.414L5.414 17H8a1 1 0 010 2H4a1 1 0 01-1-1v-4a1 1 0 011-1zm13 0a1 1 0 00-1 1v1.586l-3.293-3.293a1 1 0 00-1.414 1.414L14.586 17H12a1 1 0 000 2h4a1 1 0 001-1v-4a1 1 0 00-1-1z"/>
        </svg>
      ),
    },
    {
      title: 'Toggle Grid',
      action: toggleGrid,
      active: gridActive,
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
          <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>
        </svg>
      ),
    },
    {
      title: 'Reset Camera',
      action: resetCamera,
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
          <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"/>
        </svg>
      ),
    },
    {
      title: statsVisible ? 'Hide Stats' : 'Show Stats',
      action: onToggleStats,
      active: statsVisible,
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
          <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 012 2v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/>
        </svg>
      ),
    },
    {
      title: pickerActive ? 'Picker Active (Click to disable)' : 'Pick Coordinate',
      action: onTogglePicker,
      active: pickerActive,
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
          <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"/>
        </svg>
      ),
    },
    {
      title: materialPickerActive ? 'Material Editor Active (Click to disable)' : 'Material Editor',
      action: onToggleMaterialPicker || (() => {}),
      active: !!materialPickerActive,
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
          <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z"/>
        </svg>
      ),
    },
    {
      title: dashboardVisible ? 'Hide Dashboard' : 'Show Dashboard',
      action: onToggleDashboard,
      active: dashboardVisible,
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M4 13h6c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1zm0 8h6c.55 0 1-.45 1-1v-4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1zm10 0h6c.55 0 1-.45 1-1v-8c0-.55-.45-1-1-1h-6c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1zM13 4v4c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1h-6c-.55 0-1 .45-1 1z"/>
        </svg>
      ),
    },
  ]

  return (
    <div className="viewer-toolbar">
      {tools.map((tool) => (
        <button
          key={tool.title}
          className={`toolbar-btn ${tool.active ? 'active' : ''}`}
          onClick={tool.action}
          title={tool.title}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  )
}
