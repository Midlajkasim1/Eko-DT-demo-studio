import * as THREE from 'three'
import type { FragmentsEngine } from './fragmentsEngine'
import { useProjectStore } from '@/store/useProjectStore'

/** Radians from straight up or straight down. Inside this cone a right-drag
 *  spins the plan the other way from every shallower view. */
const TOP_VIEW_RAD = 0.65

/** +1 keeps the usual turntable. -1 is the top and bottom views, so a drag
 *  to the right carries the far side of the plan to the right. */
export function azimuthDragSign(polarAngle: number): number {
  if (!Number.isFinite(polarAngle)) return 1
  return polarAngle < TOP_VIEW_RAD || polarAngle > Math.PI - TOP_VIEW_RAD ? -1 : 1
}

/** Radians from straight up or straight down in which the plan's far side fills much of the screen. */
const STEEP_VIEW_RAD = 1.05

/** A drag on the model: the part under the pointer follows it.
 *  camera-controls: a rightward drag has deltaX < 0, so theta falls when this returns +1.
 *  Checked, phi 0.14, theta 0 then -0.05: the top of the plan moves left, the bottom moves right.
 *  A grab above the centre therefore needs -1. The engine still measures the first movement
 *  and flips this if the point under the pointer went the other way. */
export function orbitDragSign(polarAngle: number, pointerAboveCentre: boolean): number {
  if (!Number.isFinite(polarAngle)) return 1
  if (polarAngle < STEEP_VIEW_RAD) return pointerAboveCentre ? -1 : 1
  if (polarAngle > Math.PI - STEEP_VIEW_RAD) return pointerAboveCentre ? 1 : -1
  return 1
}

/**
 * Universally unifies the "Home" and "Reset Camera" logic.
 * 1. Flies to the user's saved project camera if it exists.
 * 2. Defaults to a smart isometric overview calculated from the scene's bounding box.
 */
export function resetCameraToHome(engine: FragmentsEngine | null) {
  if (!engine?.world?.camera?.controls) return

  // 1. Try to use saved project camera first
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

    const cam = engine.world.camera.three as THREE.PerspectiveCamera
    cam.up.set(0, 1, 0)
    const controls = engine.world.camera.controls as { setLookAt: Function; updateCameraUp?: Function }
    controls.updateCameraUp?.()
    controls.setLookAt(px, py, pz, tx, ty, tz, true)
    return
  }

  // 2. If no saved camera, calculate smart isometric overview
  const box = new THREE.Box3()
  engine.world.scene.three.traverse((obj: any) => {
    if (obj.isMesh && obj.name !== 'SkyDome' && obj.name !== 'CloudsDome') {
      box.expandByObject(obj)
    }
  })
  
  const size = new THREE.Vector3()
  box.getSize(size)
  const scale = box.isEmpty() ? 30 : Math.max(size.x, size.y, size.z) * 0.7
  const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3())
  const cam = engine.world.camera.three as THREE.PerspectiveCamera
  cam.up.set(0, 1, 0)
  ;(engine.world.camera.controls as { updateCameraUp?: Function }).updateCameraUp?.()
  const f = scale
  engine.world.camera.controls.setLookAt(
    center.x + 0.58 * f,
    center.y + 0.58 * f,
    center.z + 0.58 * f,
    center.x, center.y, center.z,
    true
  )
}

const SKIP_PLAN = new Set(['SkyDome', 'CloudsDome'])

/** Bounds of the loaded fragments models. The sky dome is not part of the building. */
function loadedModelBox(engine: FragmentsEngine): THREE.Box3 {
  const box = new THREE.Box3()
  const models = engine.fragments?.models?.list
  if (models && models.size) {
    for (const model of models.values()) {
      const obj = (model as { object?: THREE.Object3D }).object || (model as unknown as THREE.Object3D)
      if (obj && typeof obj.traverse === 'function') box.expandByObject(obj)
    }
  }
  if (box.isEmpty()) {
    engine.world.scene.three.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh && !SKIP_PLAN.has(mesh.name)) box.expandByObject(mesh)
    })
  }
  return box
}

/**
 * Look down on the loaded model, the same top face as the orientation cube.
 * A true vertical look leaves orbit with no heading, so the camera sits 0.14
 * toward +z: direction (0, 1, 0.14) normalises to about (0, 0.990, 0.139).
 * The view looks toward −y and −z, and world up (0, 1, 0) puts the −z side
 * of the plan at the top of the screen. Returns false when nothing is loaded.
 */
export function frameModelFromAbove(engine: FragmentsEngine | null): boolean {
  if (!engine?.world?.camera?.controls) return false
  const box = loadedModelBox(engine)
  if (box.isEmpty()) return false
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const cam = engine.world.camera.three as THREE.PerspectiveCamera
  const fov = THREE.MathUtils.degToRad(cam.fov || 50)
  const aspect = Math.max(cam.aspect || 1, 0.25)
  const distV = (size.z / 2) / Math.tan(fov / 2)
  const distH = (size.x / 2) / (Math.tan(fov / 2) * aspect)
  const dist = Math.max(distV, distH, 8) * 1.15
  const dir = new THREE.Vector3(0, 1, 0.14).normalize()
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
  return true
}
