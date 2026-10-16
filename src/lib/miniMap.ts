import * as THREE from 'three'
import type { FragmentsEngine } from './fragmentsEngine'

const SIZE = 256
/** Unreal MiniMapCapture bRotateWithPlayer. Map forward stays up. */
const ROTATE_WITH_VIEW = true
const HIDE_NAMES = new Set(['SkyDome', 'CloudsDome', 'ShadowCatcherPlane'])

export type MiniMapHandle = {
  attach: (root: HTMLElement | null) => void
  setEnabled: (on: boolean) => void
  capture: () => void
  dispose: () => void
}

export function createMiniMap(engine: FragmentsEngine): MiniMapHandle {
  const miniCam = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 200000)
  miniCam.up.set(0, 0, -1)

  const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  })
  rt.texture.colorSpace = THREE.SRGBColorSpace

  const pixels = new Uint8Array(SIZE * SIZE * 4)
  const img = new ImageData(SIZE, SIZE)
  const target = new THREE.Vector3()
  const eye = new THREE.Vector3()
  const look = new THREE.Vector3()
  const upXZ = new THREE.Vector3()
  const hit = new THREE.Vector3()
  const nearPt = new THREE.Vector3()
  const farPt = new THREE.Vector3()
  const ray = new THREE.Ray()
  const plane = new THREE.Plane()
  const ndc = new THREE.Vector3()
  const box = new THREE.Box3()
  const size = new THREE.Vector3()
  const vp = new THREE.Vector4()
  const sc = new THREE.Vector4()
  const clearCol = new THREE.Color()
  const mapBg = new THREE.Color(0xd7e0ea)
  const hidden: { obj: THREE.Object3D; vis: boolean }[] = []
  const corners: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const NDC_CORNERS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

  let enabled = false
  let frame = 0
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null
  let root: HTMLElement | null = null
  let frustEl: SVGPolygonElement | null = null
  let headEl: SVGGElement | null = null
  let orthoWidth = 40
  let targetY = 0
  let modelCount = -1
  let cachedSpan = 40
  let cachedHeight = 24

  const renderer = () => engine.world?.renderer?.three as THREE.WebGLRenderer | undefined
  const scene = () => engine.world?.scene?.three as THREE.Scene | undefined
  const mainCam = () => engine.world?.camera?.three as THREE.Camera | undefined
  const controls = () => engine.world?.camera?.controls as {
    getTarget?: (v: THREE.Vector3) => THREE.Vector3
    getPosition?: (v: THREE.Vector3) => THREE.Vector3
    setLookAt?: (x: number, y: number, z: number, tx: number, ty: number, tz: number, smooth?: boolean) => void
  } | undefined

  const refreshBbox = () => {
    const count = engine.fragments?.models?.list?.size ?? 0
    if (count === modelCount && cachedSpan > 1) return
    modelCount = count
    box.makeEmpty()
    const models = engine.fragments?.models?.list
    if (models) {
      for (const m of models.values()) {
        const obj = (m as { object?: THREE.Object3D }).object
        if (obj) box.expandByObject(obj)
      }
    }
    if (box.isEmpty()) {
      scene()?.traverse((obj: THREE.Object3D) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh && !HIDE_NAMES.has(mesh.name)) box.expandByObject(mesh)
      })
    }
    if (box.isEmpty()) {
      cachedSpan = 40
      cachedHeight = 24
      return
    }
    box.getSize(size)
    cachedSpan = Math.max(size.x, size.z, 8)
    cachedHeight = Math.min(120, Math.max(16, size.y * 0.6 + 8))
  }

  const hideForCapture = (root3d: THREE.Scene) => {
    hidden.length = 0
    root3d.traverse(obj => {
      const mesh = obj as THREE.Mesh
      const mat = mesh.material as { isLodMaterial?: boolean } | { isLodMaterial?: boolean }[] | undefined
      const lod = Array.isArray(mat) ? mat.some(m => m?.isLodMaterial) : !!mat?.isLodMaterial
      if (HIDE_NAMES.has(obj.name) || (obj as { isGridHelper?: boolean }).isGridHelper || lod) {
        hidden.push({ obj, vis: obj.visible })
        obj.visible = false
      }
    })
  }

  const restoreHidden = () => {
    for (const h of hidden) h.obj.visible = h.vis
    hidden.length = 0
  }

  const placeCamera = () => {
    const cam = mainCam()
    const ctl = controls()
    if (!cam) return false
    refreshBbox()
    if (ctl?.getTarget) ctl.getTarget(target)
    else {
      cam.getWorldDirection(look)
      target.copy(cam.position).addScaledVector(look, 20)
    }
    if (ctl?.getPosition) ctl.getPosition(eye)
    else eye.copy(cam.position)
    /* Unreal centres the capture on the camera XY, not the look target. */
    targetY = target.y
    look.copy(target).sub(eye)
    look.y = 0
    if (look.lengthSq() < 1e-6) look.set(0, 0, -1)
    else look.normalize()

    const dist = eye.distanceTo(target)
    const t = Math.max(0, Math.min(1, (dist - cachedSpan * 0.15) / (cachedSpan * 1.2)))
    orthoWidth = cachedSpan * 0.35 + (cachedSpan * 1.35 - cachedSpan * 0.35) * t

    const half = orthoWidth * 0.5
    miniCam.left = -half
    miniCam.right = half
    miniCam.top = half
    miniCam.bottom = -half
    miniCam.near = 0.1
    miniCam.far = 200000
    miniCam.position.set(eye.x, eye.y + cachedHeight, eye.z)
    if (ROTATE_WITH_VIEW) miniCam.up.set(look.x, 0, look.z)
    else miniCam.up.set(0, 0, -1)
    miniCam.lookAt(eye.x, target.y, eye.z)
    miniCam.updateMatrixWorld(true)
    miniCam.updateProjectionMatrix()
    return true
  }

  const worldToMap = (p: THREE.Vector3) => {
    ndc.copy(p).project(miniCam)
    return {
      x: (ndc.x * 0.5 + 0.5) * SIZE,
      y: (-ndc.y * 0.5 + 0.5) * SIZE,
      ok: Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && ndc.z > -1 && ndc.z < 1,
    }
  }

  const frustumHits = () => {
    const cam = mainCam()
    if (!cam) return false
    plane.set(upXZ.set(0, 1, 0), -targetY)
    let hits = 0
    const maxR = orthoWidth * 1.4
    for (let i = 0; i < 4; i++) {
      const [x, y] = NDC_CORNERS[i]
      nearPt.set(x, y, -1).unproject(cam)
      farPt.set(x, y, 1).unproject(cam)
      ray.origin.copy(nearPt)
      ray.direction.copy(farPt).sub(nearPt)
      const len = ray.direction.length()
      if (len < 1e-8) {
        corners[i].set(nearPt.x, targetY, nearPt.z)
        continue
      }
      ray.direction.multiplyScalar(1 / len)
      if (ray.intersectPlane(plane, corners[i])) hits++
      else corners[i].set(farPt.x, targetY, farPt.z)
      const dx = corners[i].x - eye.x
      const dz = corners[i].z - eye.z
      const r = Math.hypot(dx, dz)
      if (r > maxR && r > 1e-6) {
        corners[i].x = eye.x + dx * maxR / r
        corners[i].z = eye.z + dz * maxR / r
        corners[i].y = targetY
      }
    }
    return hits > 0
  }

  const paintOverlay = () => {
    if (headEl) {
      /* Rotating map already faces look-up, so the wedge stays upright. */
      const yaw = ROTATE_WITH_VIEW ? 0 : Math.atan2(look.x, -look.z) * (180 / Math.PI)
      headEl.setAttribute('transform', `translate(${SIZE / 2},${SIZE / 2}) rotate(${yaw})`)
    }
    if (!frustEl) return
    if (!frustumHits()) {
      frustEl.setAttribute('points', '')
      return
    }
    const pts: string[] = []
    for (const c of corners) {
      const m = worldToMap(c)
      pts.push(`${m.x.toFixed(1)},${m.y.toFixed(1)}`)
    }
    frustEl.setAttribute('points', pts.join(' '))
  }

  const blit = (gl: THREE.WebGLRenderer) => {
    if (!ctx) return
    gl.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, pixels)
    const dst = img.data
    for (let y = 0; y < SIZE; y++) {
      const srcRow = (SIZE - 1 - y) * SIZE * 4
      dst.set(pixels.subarray(srcRow, srcRow + SIZE * 4), y * SIZE * 4)
    }
    ctx.putImageData(img, 0, 0)
  }

  const capture = () => {
    if (!enabled || !canvas || !ctx) return
    const gl = renderer()
    const scn = scene()
    if (!gl || !scn) return
    frame++
    const doGpu = (frame & 1) === 0
    if (!placeCamera()) return
    paintOverlay()
    if (!doGpu) return

    const prevRT = gl.getRenderTarget()
    const prevBg = scn.background
    const prevFog = scn.fog
    const prevAuto = gl.autoClear
    const prevScissor = gl.getScissorTest()
    const prevTone = gl.toneMapping
    const prevAlpha = gl.getClearAlpha()
    gl.getViewport(vp)
    gl.getScissor(sc)
    gl.getClearColor(clearCol)
    const prevShadow = gl.shadowMap.autoUpdate

    hideForCapture(scn)
    scn.background = mapBg
    scn.fog = null
    gl.toneMapping = THREE.NoToneMapping
    gl.shadowMap.autoUpdate = false
    gl.autoClear = true
    gl.setClearColor(mapBg, 1)
    gl.setRenderTarget(rt)
    gl.setViewport(0, 0, SIZE, SIZE)
    gl.setScissor(0, 0, SIZE, SIZE)
    gl.setScissorTest(true)
    gl.clear()
    gl.render(scn, miniCam)

    blit(gl)

    restoreHidden()
    scn.background = prevBg
    scn.fog = prevFog
    gl.toneMapping = prevTone
    gl.shadowMap.autoUpdate = prevShadow
    gl.autoClear = prevAuto
    gl.setClearColor(clearCol, prevAlpha)
    gl.setViewport(vp)
    gl.setScissor(sc)
    gl.setScissorTest(prevScissor)
    gl.setRenderTarget(prevRT)
  }

  const clickToWorld = (nx: number, ny: number) => {
    if (!placeCamera()) return null
    const cx = nx - 0.5
    const cy = ny - 0.5
    const w = orthoWidth
    const lx = look.x
    const lz = look.z
    if (ROTATE_WITH_VIEW) {
      /* Map up = look, map right = look × +Y. Canvas +Y is down. */
      hit.set(
        eye.x + w * (-cx * lz - cy * lx),
        targetY,
        eye.z + w * (cx * lx - cy * lz),
      )
    } else {
      hit.set(eye.x + cx * w, targetY, eye.z + cy * w)
    }
    return hit
  }

  const onClick = (ev: MouseEvent) => {
    if (!enabled || !root) return
    ev.preventDefault()
    ev.stopPropagation()
    const rect = (canvas || root).getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    const nx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
    const ny = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height))
    const worldHit = clickToWorld(nx, ny)
    const ctl = controls()
    const cam = mainCam()
    if (!worldHit || !ctl?.setLookAt || !cam) return
    if (ctl.getPosition) ctl.getPosition(eye)
    else eye.copy(cam.position)
    if (ctl.getTarget) ctl.getTarget(target)
    else target.copy(worldHit)
    /* Unreal: pawn XY = click, keep height and yaw. Shift eye and target together. */
    const dx = worldHit.x - eye.x
    const dz = worldHit.z - eye.z
    ctl.setLookAt(
      worldHit.x,
      eye.y,
      worldHit.z,
      target.x + dx,
      target.y,
      target.z + dz,
      true,
    )
  }

  const onPointer = (ev: PointerEvent) => {
    ev.stopPropagation()
  }

  const unbind = () => {
    if (root) {
      root.removeEventListener('click', onClick)
      root.removeEventListener('pointerdown', onPointer)
    }
    canvas = null
    ctx = null
    root = null
    frustEl = null
    headEl = null
  }

  const attach = (el: HTMLElement | null) => {
    if (!el) {
      unbind()
      enabled = false
      return
    }
    const next = el.querySelector('canvas.mmap-view') as HTMLCanvasElement | null
    if (root === el && canvas === next && enabled) return
    unbind()
    root = el
    canvas = next
    if (!canvas) {
      enabled = false
      return
    }
    canvas.width = SIZE
    canvas.height = SIZE
    ctx = canvas.getContext('2d', { alpha: false })
    frustEl = el.querySelector('polygon.mmap-frust') as SVGPolygonElement | null
    headEl = el.querySelector('g.mmap-head') as SVGGElement | null
    el.addEventListener('click', onClick)
    el.addEventListener('pointerdown', onPointer)
    enabled = true
    frame = 1
    if (ctx) ctx.putImageData(img, 0, 0)
    placeCamera()
    paintOverlay()
    if (engine.world?.renderer) engine.world.renderer.needsUpdate = true
  }

  const setEnabled = (on: boolean) => {
    enabled = !!on && !!canvas
    if (!on) return
    if (engine.world?.renderer) engine.world.renderer.needsUpdate = true
  }

  const dispose = () => {
    unbind()
    enabled = false
    rt.dispose()
  }

  return { attach, setEnabled, capture, dispose }
}
