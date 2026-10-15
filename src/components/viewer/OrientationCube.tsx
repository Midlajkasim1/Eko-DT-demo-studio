import { useEffect, useRef, useCallback, useState } from 'react'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import { resetCameraToHome } from '@/lib/cameraUtils'
import { useModelStore } from '@/store/useModelStore'
import * as THREE from 'three'

interface OrientationCubeProps {
  engineRef: React.MutableRefObject<FragmentsEngine | null>
  dashboardVisible?: boolean
}

// Camera presets: [position offset, world target]
const D = 80
const FACE_VIEWS: Record<string, [number[], number[]]> = {
  Top:    [[0, D, 0],   [0, 0, 0]],
  Bottom: [[0, -D, 0],  [0, 0, 0]],
  Front:  [[0, 0, D],   [0, 0, 0]],
  Back:   [[0, 0, -D],  [0, 0, 0]],
  Right:  [[D, 0, 0],   [0, 0, 0]],
  Left:   [[-D, 0, 0],  [0, 0, 0]],
}
const EDGE_VIEWS: Record<string, [number[], number[]]> = {
  'Top-Front': [[0, D * 0.7, D * 0.7],   [0, 0, 0]],
  'Top-Back':  [[0, D * 0.7, -D * 0.7],  [0, 0, 0]],
  'Top-Right': [[D * 0.7, D * 0.7, 0],   [0, 0, 0]],
  'Top-Left':  [[-D * 0.7, D * 0.7, 0],  [0, 0, 0]],
}
const CORNER_ISO: [number[], number[]] = [[D * 0.58, D * 0.58, D * 0.58], [0, 0, 0]]

const FACE_LABELS: { face: string; transform: string; accent?: boolean }[] = [
  { face: 'Front',  transform: 'rotateY(0deg)   translateZ(40px)' },
  { face: 'Back',   transform: 'rotateY(180deg) translateZ(40px)' },
  { face: 'Left',   transform: 'rotateY(-90deg) translateZ(40px)' },
  { face: 'Right',  transform: 'rotateY(90deg)  translateZ(40px)' },
  { face: 'Top',    transform: 'rotateX(90deg)  translateZ(40px)', accent: true },
  { face: 'Bottom', transform: 'rotateX(-90deg) translateZ(40px)' },
]

export function OrientationCube({ engineRef, dashboardVisible }: OrientationCubeProps) {
  const cubeRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef(0)

  // Aggressive RTL detection (FIN dashboard might set it on body or a child container)
  const [isRTL, setIsRTL] = useState(false)
  useEffect(() => {
    const checkRTL = () => {
      const hasRTL = document.documentElement.dir === 'rtl' || 
                     document.dir === 'rtl' || 
                     document.body.dir === 'rtl' ||
                     document.body.classList.contains('rtl') ||
                     document.querySelector('[dir="rtl"]') !== null
      setIsRTL(hasRTL)
    }
    checkRTL()
    const observer = new MutationObserver(checkRTL)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['dir', 'class'] })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['dir', 'lang'] })
    return () => observer.disconnect()
  }, [])
  
  // Drag state for orbiting
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ x: number, y: number } | null>(null)

  /** Point the camera along a cube face and frame the loaded model, not the sky. */
  const snapTo = useCallback((posOffset: number[], _tgt: number[], closer?: boolean) => {
    const engine = engineRef.current
    if (!engine?.world?.camera?.controls) return
    const box = new THREE.Box3()
    const models = engine.fragments?.models?.list
    if (closer) {
      const spaceIds = useModelStore.getState().models
        .filter(m => /space/i.test(m.originalFileName || ''))
        .map(m => m.modelId)
      for (const id of spaceIds) {
        const frag = models?.get(id) as any
        const obj = frag?.object
        if (obj) box.expandByObject(obj)
      }
    }
    if (box.isEmpty() && models && models.size) {
      for (const model of models.values()) {
        const obj = (model as any).object || model
        if (obj && typeof obj.updateWorldMatrix === 'function') box.expandByObject(obj)
      }
    }
    if (box.isEmpty()) {
      engine.world.scene.three.traverse((obj: any) => {
        if (obj.isMesh && obj.name !== 'SkyDome' && obj.name !== 'CloudsDome') {
          box.expandByObject(obj)
        }
      })
    }
    const size = box.isEmpty() ? new THREE.Vector3(20, 10, 20) : box.getSize(new THREE.Vector3())
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3())
    const dir = new THREE.Vector3(posOffset[0], posOffset[1], posOffset[2]).normalize()
    const cam = engine.world.camera.three as THREE.PerspectiveCamera
    const fov = THREE.MathUtils.degToRad(cam.fov || 50)
    const aspect = Math.max(cam.aspect || 1, 0.25)
    const ax = Math.abs(dir.x), ay = Math.abs(dir.y), az = Math.abs(dir.z)
    let spanW: number, spanH: number
    if (ay >= ax && ay >= az) {
      spanW = size.x
      spanH = size.z
    } else if (ax >= az) {
      spanW = size.z
      spanH = size.y
    } else {
      spanW = size.x
      spanH = size.y
    }
    const distV = (spanH / 2) / Math.tan(fov / 2)
    const distH = (spanW / 2) / (Math.tan(fov / 2) * aspect)
    const topOrBottom = ay > 0.9
    const dist = topOrBottom
      ? Math.max(distV, distH, 8) * (closer ? 1.25 : 0.82)
      : Math.max(size.x, size.y, size.z, 8) * 0.7
    /* Keep world Y-up. A true vertical look locks orbit and mouse rotates the wrong way. */
    if (topOrBottom) dir.set(dir.x, dir.y, dir.z + (dir.y >= 0 ? 0.14 : -0.14)).normalize()
    cam.up.set(0, 1, 0)
    const controls = engine.world.camera.controls as { setLookAt: Function; updateCameraUp?: Function }
    controls.updateCameraUp?.()
    controls.setLookAt(
      center.x + dir.x * dist,
      center.y + dir.y * dist,
      center.z + dir.z * dist,
      center.x, center.y, center.z,
      true
    )
  }, [engineRef])

  useEffect(() => {
    const onLook = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      const face = detail.face as keyof typeof FACE_VIEWS
      const v = face && FACE_VIEWS[face]
      if (v) snapTo(v[0], v[1], !!detail.closer)
    }
    window.addEventListener('eko-look-face', onLook)
    return () => window.removeEventListener('eko-look-face', onLook)
  }, [snapTo])

  /** Sync cube rotation to the live camera */
  useEffect(() => {
    const tick = () => {
      const cube = cubeRef.current
      const engine = engineRef.current
      if (cube && engine?.world?.camera?.three) {
        const cam = engine.world.camera.three as THREE.PerspectiveCamera
        const euler = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ')
        const xDeg = THREE.MathUtils.radToDeg(euler.x)
        const yDeg = -THREE.MathUtils.radToDeg(euler.y)
        cube.style.transform = `rotateX(${xDeg.toFixed(2)}deg) rotateY(${yDeg.toFixed(2)}deg)`
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [engineRef])

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragStartRef.current = { x: e.clientX, y: e.clientY }

    const onMove = (ev: PointerEvent) => {
      if (!dragStartRef.current) return
      const dx = ev.clientX - dragStartRef.current.x
      const dy = ev.clientY - dragStartRef.current.y
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        setIsDragging(true)
        const engine = engineRef.current
        if (engine?.world?.camera?.controls) {
          const controls = engine.world.camera.controls as any
          if (typeof controls.rotate === 'function') {
            controls.rotate(-dx * 0.008, -dy * 0.008, false)
          }
        }
        dragStartRef.current = { x: ev.clientX, y: ev.clientY }
      }
    }

    const onUp = () => {
      dragStartRef.current = null
      setTimeout(() => setIsDragging(false), 50)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className="orientation-cube"
      style={{
        position: 'absolute',
        // Push down further when dashboard is visible
        top: dashboardVisible ? '130px' : '36px',
        // In dashboard mode, move inward to clear the collapsed sidebars
        ...(isRTL
          ? { left: dashboardVisible ? '110px' : '36px', right: 'auto' }
          : { right: dashboardVisible ? '110px' : '36px', left: 'auto' }
        ),
        // z-index 10 keeps it behind the DashboardOverlay (15) and Right Panels (25)
        zIndex: 10,
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        pointerEvents: 'auto',
        transition: 'top 0.3s ease',
      }}
      title="Orientation Cube — drag to orbit, click a face to snap"
      onDragStart={e => e.preventDefault()}
      onPointerDown={handlePointerDown}
    >
      {/* Isometric Home Button */}
      <div
        title="Home (Isometric View)"
        onClick={(e) => {
          e.stopPropagation()
          if (isDragging) return
          resetCameraToHome(engineRef.current)
          // Home also drops the dashboard's selection (popup, equipment colour, asset panel)
          if (dashboardVisible) (window as any).EKO?.clearSelection?.()
        }}
        style={{
          position: 'absolute',
          top: '-12px', left: '-28px',
          width: '24px', height: '24px',
          borderRadius: '50%',
          background: 'transparent',
          cursor: 'pointer',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.15s, background 0.15s',
          color: '#6a7a8a',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement
          el.style.color = '#2a334d'
          el.style.background = 'rgba(235, 240, 245, 0.8)'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement
          el.style.color = '#6a7a8a'
          el.style.background = 'transparent'
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
      </div>

      <div
        title="Bottom view"
        onClick={(e) => {
          e.stopPropagation()
          if (isDragging) return
          const v = FACE_VIEWS.Bottom
          if (v) snapTo(v[0], v[1])
        }}
        style={{
          position: 'absolute',
          top: '-12px', right: '-28px', left: 'auto',
          width: '24px', height: '24px',
          borderRadius: '50%',
          background: 'transparent',
          cursor: 'pointer',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#6a7a8a',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement
          el.style.color = '#2a334d'
          el.style.background = 'rgba(235, 240, 245, 0.8)'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement
          el.style.color = '#6a7a8a'
          el.style.background = 'transparent'
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Perspective wrapper */}
      <div style={{ perspective: '320px', width: '80px', height: '80px' }}>
        <div
          ref={cubeRef}
          style={{
            width: '80px',
            height: '80px',
            position: 'relative',
            transformStyle: 'preserve-3d',
          }}
        >
          {/* Six faces */}
          {FACE_LABELS.map(({ face, transform, accent }) => (
            <div
              key={face}
              title={`${face} view`}
              onClick={(e) => {
                e.stopPropagation()
                if (isDragging) return
                const v = FACE_VIEWS[face]
                if (v) snapTo(v[0], v[1])
              }}
              style={{
                position: 'absolute',
                inset: 0,
                transform,
                background: accent
                  ? 'rgba(215, 225, 235, 0.85)'
                  : 'rgba(235, 240, 245, 0.85)',
                border: '1px solid rgba(150, 160, 175, 0.5)',
                backdropFilter: 'blur(3px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '9px',
                fontWeight: 700,
                letterSpacing: '0.05em',
                color: '#3a4a5a',
                textTransform: 'uppercase',
                transition: 'background 0.12s, color 0.12s',
                boxSizing: 'border-box',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement
                el.style.background = '#2a334d'
                el.style.color = '#ffffff'
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement
                el.style.background = accent
                  ? 'rgba(215, 225, 235, 0.85)'
                  : 'rgba(235, 240, 245, 0.85)'
                el.style.color = '#3a4a5a'
              }}
            >
              {face}
            </div>
          ))}

          {/* Edge snap zones */}
          {Object.entries(EDGE_VIEWS).map(([key, view]) => (
            <div
              key={key}
              title={`${key.replace('-', ' + ')} view`}
              onClick={(e) => {
                e.stopPropagation()
                if (isDragging) return
                snapTo(view[0], view[1])
              }}
              style={{
                position: 'absolute',
                width: '10px', height: '80px',
                top: 0, right: key.includes('Right') ? 0 : undefined,
                left: key.includes('Left') ? 0 : undefined,
                background: 'transparent',
                cursor: 'crosshair',
                zIndex: 5,
              }}
            />
          ))}

        </div>
      </div>

      {/* Compass ring */}
      <CompassRing engineRef={engineRef} />
    </div>
  )
}

function CompassRing({ engineRef }: { engineRef: React.MutableRefObject<FragmentsEngine | null> }) {
  const needleRef = useRef<SVGGElement>(null)

  useEffect(() => {
    let frame = 0
    const tick = () => {
      const engine = engineRef.current
      if (engine?.world?.camera?.three && needleRef.current) {
        const cam = engine.world.camera.three as THREE.PerspectiveCamera
        const euler = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ')
        const deg = THREE.MathUtils.radToDeg(euler.y)
        needleRef.current.style.transform = `rotate(${-deg.toFixed(1)}deg)`
        needleRef.current.style.transformOrigin = '18px 18px'
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [engineRef])

  return (
    <svg width="36" height="36" viewBox="0 0 36 36" style={{ opacity: 0.85 }}>
      <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(150,160,175,0.4)" strokeWidth="1.5" />
      <text x="18" y="5.5"  textAnchor="middle" fontSize="5" fill="rgba(80,90,105,0.9)" fontWeight="bold">N</text>
      <text x="18" y="33.5" textAnchor="middle" fontSize="5" fill="rgba(120,130,145,0.7)">S</text>
      <text x="33" y="20"   textAnchor="middle" fontSize="5" fill="rgba(120,130,145,0.7)">E</text>
      <text x="3"  y="20"   textAnchor="middle" fontSize="5" fill="rgba(120,130,145,0.7)">W</text>
      <g ref={needleRef}>
        <polygon points="18,4 16.5,18 19.5,18" fill="rgba(200,60,60,0.9)" />
        <polygon points="18,32 16.5,18 19.5,18" fill="rgba(150,160,175,0.6)" />
      </g>
    </svg>
  )
}
