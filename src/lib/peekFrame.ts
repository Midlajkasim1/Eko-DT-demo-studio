import * as THREE from 'three'
import type { FragmentsEngine } from './fragmentsEngine'
import { frameSphereInView, type ViewRect } from './viewFraming'

/**
 * Phone and tablet Overview shows the Studio canvas through a short card at the
 * top of the page (.mpeek). The camera is framed for the whole window, so that
 * card is mostly sky. While the card is on screen, shift the same view so the
 * model sits in the card. Opening the model, or leaving Overview, puts the
 * camera back. A drag, or a fly to an asset, keeps the camera where it was sent.
 */

const SKIP = new Set(['SkyDome', 'CloudsDome'])
const POSE_EPS = 0.2

export interface Pose {
  position: THREE.Vector3
  target: THREE.Vector3
}

interface PeekControls {
  getPosition: (out: THREE.Vector3) => void
  getTarget: (out: THREE.Vector3) => void
  setLookAt: (px: number, py: number, pz: number, tx: number, ty: number, tz: number, smooth?: boolean) => void
  updateCameraUp?: () => void
  addEventListener: (type: string, fn: () => void) => void
  removeEventListener: (type: string, fn: () => void) => void
}

export interface PeekHooks {
  mode: () => 'peek' | 'off'
  rect: () => { canvas: ViewRect; visible: ViewRect } | null
  sphere: () => THREE.Sphere | null
  pose: () => Pose
  /** Move the camera. Return true when that move started a transition. */
  look: (pose: Pose, smooth: boolean) => boolean
  camera: THREE.PerspectiveCamera
}

function clonePose(pose: Pose): Pose {
  return { position: pose.position.clone(), target: pose.target.clone() }
}

function samePose(a: Pose, b: Pose): boolean {
  return a.position.distanceTo(b.position) < POSE_EPS && a.target.distanceTo(b.target) < POSE_EPS
}

function sphereKey(sphere: THREE.Sphere): string {
  const c = sphere.center
  return `${c.x.toFixed(1)}:${c.y.toFixed(1)}:${c.z.toFixed(1)}:${sphere.radius.toFixed(1)}`
}

function rectKey(rect: ViewRect): string {
  return `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.w)}:${Math.round(rect.h)}`
}

/** Meshes of the loaded models, ignoring the sky dome. Empty until a model has geometry. */
export function modelSphere(engine: FragmentsEngine): THREE.Sphere | null {
  const box = new THREE.Box3()
  const take = (root: THREE.Object3D | null | undefined) => {
    root?.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh || SKIP.has(mesh.name)) return
      box.expandByObject(mesh)
    })
  }
  const models = engine.fragments?.models?.list
  if (models && models.size) {
    for (const model of models.values()) {
      const obj = (model as { object?: THREE.Object3D }).object || (model as unknown as THREE.Object3D)
      if (obj && typeof obj.traverse === 'function') take(obj)
    }
  }
  if (box.isEmpty()) take(engine.world?.scene?.three)
  if (box.isEmpty()) return null
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  if (!Number.isFinite(sphere.radius) || sphere.radius < 1e-3) return null
  return sphere
}

export class PeekFramer {
  private saved: Pose | null = null
  private applied: Pose | null = null
  private lastLive: Pose | null = null
  private active = false
  private userLock = false
  private external = false
  private expectRest = false
  /** The framed pose has been reached. The rest event that follows is ours. */
  private ownRest = false
  private ourMove = 0
  private guard = false
  private rectSig = ''
  private sphereSig = ''

  constructor(private hooks: PeekHooks) {}

  /** A drag or a wheel on the canvas. Leave that view alone. */
  userControlled() {
    if (this.ourMove) return
    if (this.hooks.mode() === 'peek') this.userLock = true
  }

  /** setLookAt from somewhere else (home, locate, a saved view). */
  transitionStarted() {
    if (this.ourMove) return
    this.external = true
    this.expectRest = false
    this.ownRest = false
  }

  rested() {
    const ours = this.ownRest || (this.expectRest && !this.external)
    this.expectRest = false
    this.ownRest = false
    if (this.userLock) return
    if (ours) return
    if (this.hooks.mode() !== 'peek') return
    this.saved = clonePose(this.hooks.pose())
    this.active = false
    this.applied = null
    this.external = false
    this.rectSig = ''
    this.sphereSig = ''
    this.sync()
  }

  sync() {
    if (this.guard) return
    this.guard = true
    try {
      this.syncNow()
    } finally {
      this.guard = false
    }
  }

  /** Overlay going away: put the camera back if this card still owns it. */
  release() {
    if (this.active && this.saved && !this.userLock && !this.external) this.move(this.saved, false)
    this.clear()
  }

  private syncNow() {
    const live = this.hooks.pose()
    if (this.hooks.mode() !== 'peek') {
      if (this.active && this.saved && !this.userLock && !this.external) this.move(this.saved, true)
      this.clear()
      return
    }
    if (this.userLock) return
    if (this.expectRest && this.applied) {
      if (samePose(live, this.applied)) {
        this.expectRest = false
        this.ownRest = true
      } else if (this.lastLive && live.position.distanceTo(this.applied.position) > this.lastLive.position.distanceTo(this.applied.position) + 0.5) {
        // The transition was replaced (the saved project camera snaps with no event).
        this.expectRest = false
        this.saved = clonePose(live)
        this.active = false
        this.applied = null
        this.rectSig = ''
        this.sphereSig = ''
      } else {
        this.lastLive = clonePose(live)
        return
      }
    }
    this.lastLive = clonePose(live)
    if (this.external) return
    if (this.active && this.applied && !samePose(live, this.applied)) {
      this.saved = clonePose(live)
      this.active = false
      this.applied = null
      this.rectSig = ''
      this.sphereSig = ''
    }
    const sphere = this.hooks.sphere()
    const rect = this.hooks.rect()
    if (!sphere || !rect) return
    const nextSphere = sphereKey(sphere)
    const nextRect = rectKey(rect.visible)
    if (this.active && nextSphere === this.sphereSig && nextRect === this.rectSig) return
    if (!this.saved) this.saved = clonePose(live)
    if (this.saved.position.distanceTo(this.saved.target) < 0.05) return
    const scratch = this.hooks.camera.clone()
    scratch.position.copy(this.saved.position)
    scratch.up.set(0, 1, 0)
    scratch.lookAt(this.saved.target)
    scratch.updateMatrixWorld(true)
    const pose = frameSphereInView(scratch, sphere.center, sphere.radius, rect.canvas, rect.visible)
    this.sphereSig = nextSphere
    this.rectSig = nextRect
    this.active = true
    this.applied = clonePose(pose)
    this.move(pose, true)
  }

  private move(pose: Pose, smooth: boolean) {
    this.ownRest = false
    this.ourMove++
    let started = false
    try {
      started = this.hooks.look(pose, smooth)
    } finally {
      this.ourMove--
    }
    if (started) this.expectRest = true
  }

  private clear() {
    this.saved = null
    this.applied = null
    this.lastLive = null
    this.active = false
    this.userLock = false
    this.external = false
    this.expectRest = false
    this.ownRest = false
    this.rectSig = ''
    this.sphereSig = ''
  }
}

function dashboardRoot(): Element | null {
  return document.querySelector('.dashboard-native-container')
}

function peekMode(): 'peek' | 'off' {
  const root = dashboardRoot()
  if (!root || root.getAttribute('data-stacked') !== '1') return 'off'
  if (root.getAttribute('data-modelfs') === '1') return 'off'
  const peek = root.querySelector('.mpeek')
  if (!peek || peek.getClientRects().length === 0) return 'off'
  return 'peek'
}

function peekRect(canvas: HTMLElement): { canvas: ViewRect; visible: ViewRect } | null {
  const peek = dashboardRoot()?.querySelector('.mpeek')
  if (!peek) return null
  const c = canvas.getBoundingClientRect()
  const p = peek.getBoundingClientRect()
  const x = Math.max(c.left, p.left)
  const y = Math.max(c.top, p.top)
  const w = Math.min(c.right, p.right) - x
  const h = Math.min(c.bottom, p.bottom) - y
  if (w < 80 || h < 80 || c.width < 2 || c.height < 2) return null
  return {
    canvas: { x: c.left, y: c.top, w: c.width, h: c.height },
    visible: { x, y, w, h },
  }
}

/** Watch the stacked Overview card and frame the Studio camera into it. */
export function startPeekFramer(engine: FragmentsEngine): () => void {
  const controls = engine.world?.camera?.controls as PeekControls | undefined
  const live = engine.world?.camera?.three
  const canvas = engine.world?.renderer?.three?.domElement as HTMLElement | undefined
  if (!controls?.setLookAt || !controls.getPosition || !controls.getTarget || !live?.isPerspectiveCamera || !canvas) {
    return () => {}
  }
  const camera = live as THREE.PerspectiveCamera
  const read = (): Pose => {
    const position = new THREE.Vector3()
    const target = new THREE.Vector3()
    controls.getPosition(position)
    controls.getTarget(target)
    return { position, target }
  }
  const framer = new PeekFramer({
    mode: peekMode,
    rect: () => peekRect(canvas),
    sphere: () => modelSphere(engine),
    pose: read,
    camera,
    look: (pose, smooth) => {
      let started = false
      const mark = () => { started = true }
      controls.addEventListener('transitionstart', mark)
      try {
        camera.up.set(0, 1, 0)
        controls.updateCameraUp?.()
        controls.setLookAt(pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z, smooth)
      } finally {
        controls.removeEventListener('transitionstart', mark)
      }
      return started
    },
  })
  const onControl = () => framer.userControlled()
  const onStart = () => framer.transitionStarted()
  const onRest = () => framer.rested()
  controls.addEventListener('control', onControl)
  controls.addEventListener('transitionstart', onStart)
  controls.addEventListener('rest', onRest)
  const root = dashboardRoot()
  let scheduled = false
  const kick = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      framer.sync()
    })
  }
  const observer = new MutationObserver(kick)
  if (root) observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-modelfs', 'data-stacked'] })
  window.addEventListener('resize', kick)
  const timer = window.setInterval(() => framer.sync(), 400)
  kick()
  return () => {
    window.clearInterval(timer)
    observer.disconnect()
    window.removeEventListener('resize', kick)
    controls.removeEventListener('control', onControl)
    controls.removeEventListener('transitionstart', onStart)
    controls.removeEventListener('rest', onRest)
    framer.release()
  }
}
