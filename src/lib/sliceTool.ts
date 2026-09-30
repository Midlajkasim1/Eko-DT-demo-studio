import * as THREE from 'three'

export function planeFromHit(
  point: THREE.Vector3,
  surfaceNormal: THREE.Vector3,
  cameraPosition: THREE.Vector3,
): THREE.Plane {
  const removed = surfaceNormal.clone()
  if (removed.lengthSq() < 1e-12) removed.set(0, 1, 0)
  else removed.normalize()
  if (removed.dot(cameraPosition.clone().sub(point)) < 0) removed.negate()
  return new THREE.Plane().setFromNormalAndCoplanarPoint(removed.negate(), point)
}

type Cut = {
  origin: THREE.Vector3
  removed: THREE.Vector3
  plane: THREE.Plane
  group: THREE.Group
  quad: THREE.Mesh
  edge: THREE.LineSegments
  shaft: THREE.Mesh
  head: THREE.Mesh
  grip: THREE.Mesh
}

type FragmentsLike = {
  update: (force?: boolean) => Promise<void>
  models: {
    list: {
      values: () => Iterable<{ getClippingPlanesEvent: () => THREE.Plane[] }>
      onItemSet: { add: (fn: (e: { value: { getClippingPlanesEvent: () => THREE.Plane[] } }) => void) => void, remove?: (fn: unknown) => void }
    }
    materials: {
      list: {
        values: () => Iterable<THREE.Material>
        onItemSet: { add: (fn: (e: { value: THREE.Material }) => void) => void, remove?: (fn: unknown) => void }
      }
    }
  }
}

export type SliceHandle = {
  start: () => void
  clear: () => void
  armed: () => boolean
  dragging: () => boolean
  suppressClick: () => boolean
  hitsHandle: (clientX: number, clientY: number) => boolean
  stop: () => void
  place: (point: THREE.Vector3, normal: THREE.Vector3) => void
  count: () => number
  dispose: () => void
}

const clipPlanes: THREE.Plane[] = []
const watched = new Set<THREE.Material>()
let active: SliceHandle | null = null

const noRaycast = () => {}

function applyMaterial(material: THREE.Material) {
  if (material.userData?.ekoSlice) return
  material.clippingPlanes = clipPlanes.length ? clipPlanes : null
  material.clipShadows = clipPlanes.length > 0
  material.needsUpdate = true
}

export function watchClipping(material: THREE.Material) {
  watched.add(material)
  applyMaterial(material)
}

export function unwatchClipping(material: THREE.Material) {
  watched.delete(material)
}

export function hasCuts() {
  return clipPlanes.length > 0
}

// The negative side is the half the shader discards.
export function pointKept(point: THREE.Vector3) {
  for (const plane of clipPlanes) {
    if (plane.distanceToPoint(point) < -1e-4) return false
  }
  return true
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

function alignToNormal(obj: THREE.Object3D, normal: THREE.Vector3) {
  const z = normal.clone().normalize()
  const helper = Math.abs(z.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const x = new THREE.Vector3().crossVectors(helper, z).normalize()
  const y = new THREE.Vector3().crossVectors(z, x).normalize()
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

function projectOnAxis(ray: THREE.Ray, origin: THREE.Vector3, axis: THREE.Vector3, out: THREE.Vector3) {
  const w0 = ray.origin.clone().sub(origin)
  const b = ray.direction.dot(axis)
  const denom = 1 - b * b
  if (Math.abs(denom) < 1e-4) return false
  const t = (axis.dot(w0) - b * ray.direction.dot(w0)) / denom
  out.copy(origin).addScaledVector(axis, t)
  return true
}

export function createSlice(opts: {
  scene: THREE.Scene
  dom: HTMLElement
  getCamera: () => THREE.Camera
  getViewHeight: () => number
  controls?: {
    enabled: boolean
    addEventListener?: (type: string, cb: () => void) => void
    removeEventListener?: (type: string, cb: () => void) => void
  }
  fragments: FragmentsLike
  renderer?: { localClippingEnabled?: boolean }
}): SliceHandle {
  const { scene, dom, getCamera, getViewHeight, controls, fragments } = opts
  if (opts.renderer) opts.renderer.localClippingEnabled = true

  const root = new THREE.Group()
  root.name = 'eko-slices'
  scene.add(root)

  const fillMat = new THREE.MeshBasicMaterial({
    color: 0x1256b4, transparent: true, opacity: 0.28, side: THREE.DoubleSide,
    depthTest: false, depthWrite: false, toneMapped: false,
  })
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false,
  })
  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false,
  })
  const gripMat = new THREE.MeshBasicMaterial({ visible: false, depthWrite: false })
  for (const mat of [fillMat, edgeMat, arrowMat, gripMat]) mat.userData.ekoSlice = true

  const cuts: Cut[] = []
  let armed = false
  let drag: { cut: Cut, origin: THREE.Vector3, hit: THREE.Vector3 } | null = null
  let swallowClick = false
  let controlsWereEnabled = true
  let refreshAt = 0

  const bindModel = (model: { getClippingPlanesEvent: () => THREE.Plane[] }) => {
    model.getClippingPlanesEvent = () => clipPlanes
  }
  const onMaterial = ({ value }: { value: THREE.Material }) => applyMaterial(value)
  const onModel = ({ value }: { value: { getClippingPlanesEvent: () => THREE.Plane[] } }) => bindModel(value)
  fragments.models.materials.list.onItemSet.add(onMaterial)
  fragments.models.list.onItemSet.add(onModel)

  const publish = (rebuild: boolean) => {
    if (rebuild) {
      for (const material of fragments.models.materials.list.values()) applyMaterial(material)
      for (const material of watched) applyMaterial(material)
    }
    for (const model of fragments.models.list.values()) bindModel(model)
    void fragments.update(true)
  }

  const layout = (cut: Cut) => {
    const camera = getCamera()
    const px = (n: number) => worldPerPx(camera, cut.origin, getViewHeight(), n)
    const span = Math.max(px(150), 0.05)
    cut.quad.scale.set(span, span, 1)
    cut.edge.scale.set(span, span, 1)
    const len = Math.max(px(72), 0.04)
    const rad = Math.max(px(3.4), 0.004)
    const headLen = Math.max(px(16), 0.01)
    const grip = Math.max(px(16), rad * 3)
    cut.shaft.rotation.set(-Math.PI / 2, 0, 0)
    cut.shaft.scale.set(rad, len, rad)
    cut.shaft.position.set(0, 0, -len / 2)
    cut.head.rotation.set(-Math.PI / 2, 0, 0)
    cut.head.scale.set(rad * 2.6, headLen, rad * 2.6)
    cut.head.position.set(0, 0, -(len + headLen / 2))
    cut.grip.rotation.set(-Math.PI / 2, 0, 0)
    cut.grip.scale.set(grip, len + headLen, grip)
    cut.grip.position.set(0, 0, -(len + headLen) / 2)
    alignToNormal(cut.group, cut.plane.normal)
    cut.group.position.copy(cut.origin).addScaledVector(cut.removed, px(2))
  }

  const layoutAll = () => { for (const cut of cuts) layout(cut) }

  const setCursor = (on: boolean) => {
    dom.classList.toggle('slice-cursor', on)
    if (!on) dom.classList.toggle('slice-drag', false)
  }

  const endDrag = () => {
    if (!drag) return
    drag = null
    dom.classList.toggle('slice-drag', false)
    if (controls) controls.enabled = controlsWereEnabled
    void fragments.update(true)
  }

  const dropCuts = () => {
    endDrag()
    for (const cut of cuts) {
      cut.group.removeFromParent()
      cut.quad.geometry.dispose()
      cut.edge.geometry.dispose()
      cut.shaft.geometry.dispose()
      cut.head.geometry.dispose()
      cut.grip.geometry.dispose()
    }
    cuts.length = 0
    clipPlanes.length = 0
  }

  const rayFromEvent = (ev: PointerEvent, raycaster: THREE.Raycaster) => {
    const rect = dom.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(new THREE.Vector2(x, y), getCamera())
    return true
  }

  const raycaster = new THREE.Raycaster()
  const projected = new THREE.Vector3()

  const onDown = (ev: PointerEvent) => {
    if (!armed || ev.button !== 0 || !cuts.length) return
    if (!rayFromEvent(ev, raycaster)) return
    const grips = cuts.map(cut => cut.grip)
    const hit = raycaster.intersectObjects(grips, false)[0]
    if (!hit) return
    const cut = cuts.find(item => item.grip === hit.object)
    if (!cut) return
    ev.preventDefault()
    ev.stopPropagation()
    swallowClick = true
    controlsWereEnabled = controls ? controls.enabled : true
    if (controls) controls.enabled = false
    dom.classList.toggle('slice-drag', true)
    const hitPoint = projectOnAxis(raycaster.ray, cut.origin, cut.removed, projected)
      ? projected.clone()
      : cut.origin.clone()
    drag = { cut, origin: cut.origin.clone(), hit: hitPoint }
  }

  const onMove = (ev: PointerEvent) => {
    if (!drag) return
    if (!rayFromEvent(ev, raycaster)) return
    ev.preventDefault()
    ev.stopPropagation()
    if (!projectOnAxis(raycaster.ray, drag.origin, drag.cut.removed, projected)) return
    const next = drag.origin.clone().add(projected.sub(drag.hit))
    drag.cut.origin.copy(next)
    drag.cut.plane.setFromNormalAndCoplanarPoint(drag.cut.plane.normal, next)
    layout(drag.cut)
    const now = performance.now()
    if (now - refreshAt > 180) {
      refreshAt = now
      void fragments.update(true)
    }
  }

  const onUp = (ev: PointerEvent) => {
    if (!drag || ev.button !== 0) return
    endDrag()
  }

  dom.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  controls?.addEventListener?.('update', layoutAll)

  const handle: SliceHandle = {
    start() {
      armed = true
      setCursor(true)
    },
    clear() {
      armed = false
      swallowClick = false
      dropCuts()
      setCursor(false)
      publish(true)
    },
    armed: () => armed,
    dragging: () => drag !== null,
    suppressClick() {
      if (!swallowClick) return false
      swallowClick = false
      return true
    },
    stop() {
      armed = false
      swallowClick = false
      endDrag()
      setCursor(false)
    },
    hitsHandle(clientX, clientY) {
      if (!cuts.length) return false
      const rect = dom.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      const x = ((clientX - rect.left) / rect.width) * 2 - 1
      const y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(new THREE.Vector2(x, y), getCamera())
      const handles = cuts.flatMap(cut => [cut.quad, cut.grip])
      return raycaster.intersectObjects(handles, false).length > 0
    },
    place(point, normal) {
      if (!armed || !point || !normal) return
      const plane = planeFromHit(point, normal, getCamera().position)
      clipPlanes.push(plane)
      const removed = plane.normal.clone().negate()
      const group = new THREE.Group()
      group.userData.ekoSlice = true
      const quadGeom = new THREE.PlaneGeometry(1, 1)
      const quad = new THREE.Mesh(quadGeom, fillMat)
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(quadGeom), edgeMat)
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), arrowMat)
      const head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 10), arrowMat)
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), gripMat)
      for (const mesh of [quad, edge, shaft, head, grip]) {
        mesh.userData.ekoSlice = true
        mesh.frustumCulled = false
        mesh.renderOrder = 10000
      }
      edge.raycast = noRaycast
      shaft.raycast = noRaycast
      head.raycast = noRaycast
      group.add(quad, edge, shaft, head, grip)
      root.add(group)
      const cut: Cut = { origin: point.clone(), removed, plane, group, quad, edge, shaft, head, grip }
      cuts.push(cut)
      layout(cut)
      publish(true)
    },
    count: () => cuts.length,
    dispose() {
      armed = false
      dropCuts()
      setCursor(false)
      publish(true)
      dom.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      controls?.removeEventListener?.('update', layoutAll)
      fragments.models.materials.list.onItemSet.remove?.(onMaterial)
      fragments.models.list.onItemSet.remove?.(onModel)
      fillMat.dispose()
      edgeMat.dispose()
      arrowMat.dispose()
      gripMat.dispose()
      root.removeFromParent()
      if (active === handle) active = null
    },
  }
  active = handle
  return handle
}

export function setSliceTool(tool: SliceHandle | null) {
  active = tool
}

export function sliceTool() {
  return active
}
