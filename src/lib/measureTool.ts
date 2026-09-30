import * as THREE from 'three'

export function formatLength(metres: number): { value: string; unit: string; text: string } {
  if (!isFinite(metres)) return { value: '—', unit: '', text: '—' }
  if (metres < 1) {
    const mm = metres * 1000
    const value = mm >= 100 ? mm.toFixed(0) : mm.toFixed(1)
    return { value, unit: 'mm', text: `${value} mm` }
  }
  const value = metres < 10 ? metres.toFixed(3) : metres.toFixed(2)
  return { value, unit: 'm', text: `${value} m` }
}

export type MeasureResult = {
  value: string
  unit: string
  points: { x: number; y: number; z: number }[]
}

type Line = {
  a: THREE.Vector3
  b: THREE.Vector3
  outer: THREE.Mesh
  inner: THREE.Mesh
  label: THREE.Sprite
  ticks: THREE.Points | null
}

type Marker = {
  pos: THREE.Vector3
  sphere: THREE.Mesh
  axes: THREE.Mesh[]
}

type Chain = {
  points: THREE.Vector3[]
  lines: Line[]
  markers: Marker[]
  total: THREE.Sprite | null
}

export type MeasureHandle = {
  start: () => void
  cancel: () => void
  clear: () => void
  finish: () => void
  armed: () => boolean
  pending: () => boolean
  lastPoint: () => THREE.Vector3 | null
  click: (point: THREE.Vector3) => void
  hover: (point: THREE.Vector3 | null) => void
  dispose: () => void
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const noRaycast = () => {}

let active: MeasureHandle | null = null

export function setMeasureTool(tool: MeasureHandle | null) {
  active = tool
}

export function measureTool() {
  return active
}

export type SnapCandidate = {
  point: THREE.Vector3
  distance: number
  kind: 'point' | 'line' | 'face'
}


export function chooseSnapPoint(
  hits: SnapCandidate[],
  screenPx: (point: THREE.Vector3) => number,
  snapPx = 14,
  depth = 0.45,
): THREE.Vector3 | null {
  if (!hits.length) return null
  let nearest = Infinity
  for (const hit of hits) {
    if (hit.distance < nearest) nearest = hit.distance
  }
  const band = hits.filter(hit => hit.distance <= nearest + depth)
  const closest = (kind: SnapCandidate['kind']) => {
    let best: { point: THREE.Vector3; px: number } | null = null
    for (const hit of band) {
      if (hit.kind !== kind) continue
      const px = screenPx(hit.point)
      if (px > snapPx) continue
      if (!best || px < best.px) best = { point: hit.point, px }
    }
    return best?.point ?? null
  }
  const snapped = closest('point') || closest('line')
  if (snapped) return snapped.clone()
  let face: SnapCandidate | null = null
  for (const hit of band) {
    if (!face || hit.distance < face.distance) face = hit
  }
  return face ? face.point.clone() : null
}

function worldPerPx(camera: THREE.Camera, point: THREE.Vector3, viewH: number, px: number) {
  const h = viewH || 800
  const persp = camera as THREE.PerspectiveCamera
  if (persp.isPerspectiveCamera) {
    const dist = Math.max(camera.position.distanceTo(point), 0.05)
    const worldH = 2 * Math.tan((persp.fov * Math.PI / 180) / 2) * dist
    return (worldH / h) * px
  }
  const ortho = camera as THREE.OrthographicCamera
  if (ortho.isOrthographicCamera) {
    const worldH = (ortho.top - ortho.bottom) / (ortho.zoom || 1)
    return (worldH / h) * px
  }
  return 0.01 * px
}

// Drawn at 3× so the tag stays sharp when the view is on a high-density screen.
function paintLabel(text: string): { canvas: HTMLCanvasElement; aspect: number } {
  const scale = 3
  const fontPx = 22 * scale
  const padX = 12 * scale
  const padY = 7 * scale
  const canvas = document.createElement('canvas')
  const measure = canvas.getContext('2d')
  if (!measure) {
    canvas.width = 4
    canvas.height = 4
    return { canvas, aspect: 1 }
  }
  measure.font = `600 ${fontPx}px Inter, system-ui, sans-serif`
  const textW = Math.ceil(measure.measureText(text).width)
  const bw = textW + padX * 2
  const bh = fontPx + padY * 2
  canvas.width = bw
  canvas.height = bh
  const g = canvas.getContext('2d')
  if (!g) return { canvas, aspect: bw / bh }
  g.font = `600 ${fontPx}px Inter, system-ui, sans-serif`
  g.clearRect(0, 0, bw, bh)
  const r = 8 * scale
  g.beginPath()
  g.moveTo(r, 0)
  g.arcTo(bw, 0, bw, bh, r)
  g.arcTo(bw, bh, 0, bh, r)
  g.arcTo(0, bh, 0, 0, r)
  g.arcTo(0, 0, bw, 0, r)
  g.closePath()
  g.fillStyle = 'rgba(16, 24, 40, 0.94)'
  g.fill()
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, bw / 2, bh / 2 + scale * 0.5)
  return { canvas, aspect: bw / bh }
}

function setCursor(on: boolean) {
  document.querySelector('.viewer-canvas-container')?.classList.toggle('measure-cursor', on)
}

function metres(n: number) {
  return isFinite(n) ? n.toFixed(2) : '—'
}

function chainLength(points: THREE.Vector3[]) {
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += points[i - 1].distanceTo(points[i])
  return sum
}

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]

export function createMeasure(opts: {
  scene: THREE.Scene
  getCamera: () => THREE.Camera
  getViewHeight: () => number
  controls?: { addEventListener: (type: string, cb: () => void) => void; removeEventListener: (type: string, cb: () => void) => void }
  onResult?: (result: MeasureResult | null) => void
}): MeasureHandle {
  const root = new THREE.Group()
  root.name = 'eko-measures'
  root.userData.ekoMeasure = true
  opts.scene.add(root)

  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8)
  const sphereGeo = new THREE.SphereGeometry(1, 12, 8)
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.92, toneMapped: false,
  })
  const lineMat = new THREE.MeshBasicMaterial({
    color: 0x1256b4, depthTest: false, depthWrite: false, toneMapped: false,
  })
  const rubberMat = new THREE.MeshBasicMaterial({
    color: 0x6d8fbe, depthTest: false, depthWrite: false, toneMapped: false,
  })
  const markerMats = {
    green: new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false, depthWrite: false, toneMapped: false }),
    red: new THREE.MeshBasicMaterial({ color: 0xff2020, depthTest: false, depthWrite: false, toneMapped: false }),
    gray: new THREE.MeshBasicMaterial({ color: 0xc8c8c8, depthTest: false, depthWrite: false, toneMapped: false }),
  }
  const tickMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 6, sizeAttenuation: false, depthTest: false, depthWrite: false, toneMapped: false,
  })
  const finished: Chain[] = []
  let current: Chain | null = null
  let rubber: Line | null = null
  let cursor: Marker | null = null
  let liveTotal: THREE.Sprite | null = null
  let armed = false

  const publish = (result: MeasureResult | null) => {
    const report = (window as any).EKO_REPORT_MEASURE
    if (typeof report === 'function') {
      report(result)
      return
    }
    const host = (window as any).EKO_HOST_ENGINE
    if (host && typeof host.reportMeasure === 'function') host.reportMeasure(result)
    else opts.onResult?.(result)
  }

  function tag(obj: THREE.Object3D, part: string) {
    obj.frustumCulled = false
    obj.renderOrder = part === 'total' || part === 'live' || part === 'plus' ? 10001 : 10000
    obj.raycast = noRaycast
    obj.userData.ekoMeasure = true
    obj.userData.ekoPart = part
    root.add(obj)
  }

  function makeSprite(part: string) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: true, toneMapped: false,
    }))
    tag(sprite, part)
    sprite.renderOrder = 10002
    return sprite
  }

  function makeMarker(color: THREE.MeshBasicMaterial): Marker {
    const sphere = new THREE.Mesh(sphereGeo, color)
    tag(sphere, 'marker')
    const axes = AXES.map(axis => {
      const mesh = new THREE.Mesh(cyl, color)
      mesh.quaternion.setFromUnitVectors(Y_AXIS, axis)
      tag(mesh, 'axis')
      return mesh
    })
    return { pos: new THREE.Vector3(), sphere, axes }
  }

  function makeLine(innerMat: THREE.Material, part: string, withTicks: boolean): Line {
    const outer = new THREE.Mesh(cyl, haloMat)
    const inner = new THREE.Mesh(cyl, innerMat)
    tag(outer, 'halo')
    tag(inner, part)
    const label = makeSprite(part === 'rubber' ? 'plus' : 'label')
    let ticks: THREE.Points | null = null
    if (withTicks) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(7 * 3), 3))
      ticks = new THREE.Points(geo, tickMat)
      tag(ticks, 'tick')
    }
    return { a: new THREE.Vector3(), b: new THREE.Vector3(), outer, inner, label, ticks }
  }

  function placeSprite(sprite: THREE.Sprite, anchor: THREE.Vector3, liftPx: number, text: string) {
    const camera = opts.getCamera()
    const viewH = opts.getViewHeight()
    const mat = sprite.material as THREE.SpriteMaterial
    if (sprite.userData.text !== text) {
      sprite.userData.text = text
      if (mat.map) mat.map.dispose()
      if (text) {
        const painted = paintLabel(text)
        sprite.userData.aspect = painted.aspect
        const tex = new THREE.CanvasTexture(painted.canvas)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.generateMipmaps = false
        tex.minFilter = THREE.LinearFilter
        tex.magFilter = THREE.LinearFilter
        mat.map = tex
      } else {
        mat.map = null
      }
      mat.needsUpdate = true
    }
    if (!text) {
      sprite.visible = false
      return
    }
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    sprite.position.copy(anchor).addScaledVector(up, worldPerPx(camera, anchor, viewH, liftPx))
    const h = worldPerPx(camera, anchor, viewH, 34)
    const aspect = sprite.userData.aspect || 3
    sprite.scale.set(h * aspect, h, 1)
    sprite.visible = true
  }

  function layoutLine(line: Line, text: string, outerPx: number, innerPx: number) {
    const camera = opts.getCamera()
    const viewH = opts.getViewHeight()
    const len = line.a.distanceTo(line.b)
    const mid = line.a.clone().add(line.b).multiplyScalar(0.5)
    const show = len > 1e-4
    line.outer.visible = show
    line.inner.visible = show
    if (line.ticks) line.ticks.visible = show
    if (show) {
      const dir = line.b.clone().sub(line.a).multiplyScalar(1 / len)
      const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir)
      const place = (mesh: THREE.Mesh, radiusPx: number) => {
        mesh.position.copy(mid)
        mesh.quaternion.copy(q)
        const r = worldPerPx(camera, mid, viewH, radiusPx)
        mesh.scale.set(r, len, r)
      }
      place(line.outer, outerPx)
      place(line.inner, innerPx)
      if (line.ticks) {
        const pos = line.ticks.geometry.getAttribute('position') as THREE.BufferAttribute
        for (let i = 1; i <= 7; i++) {
          const p = line.a.clone().lerp(line.b, i / 8)
          pos.setXYZ(i - 1, p.x, p.y, p.z)
        }
        pos.needsUpdate = true
      }
    }
    placeSprite(line.label, mid, 28, show ? text : '')
  }

  function layoutMarker(marker: Marker) {
    const camera = opts.getCamera()
    const viewH = opts.getViewHeight()
    const radius = worldPerPx(camera, marker.pos, viewH, 5)
    const arm = worldPerPx(camera, marker.pos, viewH, 13)
    const thick = worldPerPx(camera, marker.pos, viewH, 1.3)
    marker.sphere.position.copy(marker.pos)
    marker.sphere.scale.setScalar(radius)
    for (const axis of marker.axes) {
      axis.position.copy(marker.pos)
      axis.scale.set(thick, arm * 2, thick)
    }
  }

  function layoutChain(chain: Chain) {
    for (let i = 0; i < chain.lines.length; i++) {
      const len = chain.points[i].distanceTo(chain.points[i + 1])
      layoutLine(chain.lines[i], `${metres(len)} m`, 4.2, 2.1)
    }
    for (const marker of chain.markers) layoutMarker(marker)
    if (chain.total && chain.points.length) {
      placeSprite(chain.total, chain.points[chain.points.length - 1], 52, chain.total.userData.text || '')
    }
  }

  function layoutRubber() {
    if (!rubber || !current || !current.points.length) return
    const extra = rubber.a.distanceTo(rubber.b)
    layoutLine(rubber, `+ ${metres(extra)} m`, 3.2, 1.5)
    if (cursor) {
      const show = extra > 1e-4
      cursor.sphere.visible = show
      for (const axis of cursor.axes) axis.visible = show
      if (show) layoutMarker(cursor)
    }
    if (liveTotal) {
      const total = chainLength(current.points) + extra
      const text = current.points.length > 1 || extra > 1e-4 ? `Total: ${metres(total)}` : ''
      placeSprite(liveTotal, rubber.b, 52, text)
    }
  }

  function layoutAll() {
    for (const chain of finished) layoutChain(chain)
    if (current) layoutChain(current)
    layoutRubber()
  }

  const onCamera = () => layoutAll()
  opts.controls?.addEventListener('update', onCamera)

  function dropSprite(sprite: THREE.Sprite) {
    root.remove(sprite)
    const mat = sprite.material as THREE.SpriteMaterial
    mat.map?.dispose()
    mat.dispose()
  }

  function dropLine(line: Line) {
    root.remove(line.outer, line.inner)
    if (line.ticks) {
      root.remove(line.ticks)
      line.ticks.geometry.dispose()
    }
    dropSprite(line.label)
  }

  function dropMarker(marker: Marker) {
    root.remove(marker.sphere, ...marker.axes)
  }

  function dropChain(chain: Chain) {
    for (const line of chain.lines) dropLine(line)
    for (const marker of chain.markers) dropMarker(marker)
    if (chain.total) dropSprite(chain.total)
  }

  function dropRubber() {
    if (rubber) {
      dropLine(rubber)
      rubber = null
    }
    if (cursor) {
      dropMarker(cursor)
      cursor = null
    }
    if (liveTotal) {
      dropSprite(liveTotal)
      liveTotal = null
    }
  }

  function resultOf(points: THREE.Vector3[]): MeasureResult {
    return {
      value: metres(chainLength(points)),
      unit: 'm',
      points: points.map(p => ({ x: p.x, y: p.y, z: p.z })),
    }
  }

  function publishLatest() {
    const last = finished[finished.length - 1]
    publish(last && last.points.length > 1 ? resultOf(last.points) : null)
  }

  function discardOpen() {
    if (current) dropChain(current)
    current = null
    dropRubber()
  }

  function syncRubber(point: THREE.Vector3) {
    if (!current || !current.points.length) return
    const last = current.points[current.points.length - 1]
    rubber = rubber || makeLine(rubberMat, 'rubber', true)
    rubber.a.copy(last)
    rubber.b.copy(point)
    cursor = cursor || makeMarker(markerMats.gray)
    cursor.pos.copy(point)
    liveTotal = liveTotal || makeSprite('live')
    layoutRubber()
  }

  const handle: MeasureHandle = {
    start() {
      armed = true
      setCursor(true)
    },
    cancel() {
      armed = false
      setCursor(false)
      discardOpen()
      publishLatest()
    },
    clear() {
      armed = false
      setCursor(false)
      discardOpen()
      for (const chain of finished) dropChain(chain)
      finished.length = 0
      publish(null)
    },
    finish() {
      if (!armed) return
      dropRubber()
      if (current && current.points.length > 1) {
        const chain = current
        current = null
        chain.total = makeSprite('total')
        const end = chain.points[chain.points.length - 1]
        placeSprite(chain.total, end, 52, `TOTAL: ${metres(chainLength(chain.points))} m`)
        finished.push(chain)
        publish(resultOf(chain.points))
        return
      }
      discardOpen()
      publishLatest()
    },
    armed: () => armed,
    pending: () => !!(current && current.points.length),
    lastPoint() {
      const pts = current?.points
      return pts && pts.length ? pts[pts.length - 1].clone() : null
    },
    click(point: THREE.Vector3) {
      if (!armed) return
      if (!current) current = { points: [], lines: [], markers: [], total: null }
      const last = current.points[current.points.length - 1]
      if (last && last.distanceTo(point) < 1e-4) return
      const p = point.clone()
      if (last) {
        const line = makeLine(lineMat, 'segment', false)
        line.a.copy(last)
        line.b.copy(p)
        current.lines.push(line)
      }
      const marker = makeMarker(current.points.length === 0 ? markerMats.green : markerMats.red)
      marker.pos.copy(p)
      current.markers.push(marker)
      current.points.push(p)
      if (current.points.length > 1) publish(resultOf(current.points))
      syncRubber(p)
      layoutAll()
    },
    hover(point: THREE.Vector3 | null) {
      if (!armed || !current || !current.points.length || !point) {
        dropRubber()
        return
      }
      syncRubber(point)
    },
    dispose() {
      armed = false
      setCursor(false)
      discardOpen()
      for (const chain of finished) dropChain(chain)
      finished.length = 0
      opts.controls?.removeEventListener('update', onCamera)
      opts.scene.remove(root)
      cyl.dispose()
      sphereGeo.dispose()
      haloMat.dispose()
      lineMat.dispose()
      rubberMat.dispose()
      markerMats.green.dispose()
      markerMats.red.dispose()
      markerMats.gray.dispose()
      tickMat.dispose()
      if (active === handle) active = null
    },
  }

  return handle
}
