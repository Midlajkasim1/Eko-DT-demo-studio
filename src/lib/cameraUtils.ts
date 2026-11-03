import * as THREE from 'three'
import type { FragmentsEngine } from './fragmentsEngine'
import { useProjectStore } from '@/store/useProjectStore'

/** Radians from straight down within which a view is a plan (Top, Plan, or orbited all the way up). */
const FROM_ABOVE_RAD = THREE.MathUtils.degToRad(15)

/** Speed sign for a sideways drag. From above it is -1, so a right drag turns the plan clockwise
 *  on screen wherever it is grabbed. Elsewhere the usual turntable, which from below is clockwise already. */
export function azimuthDragSign(polarAngle: number): number {
  return Number.isFinite(polarAngle) && polarAngle < FROM_ABOVE_RAD ? -1 : 1
}

/** A straight-down look has no heading. Nudge it so Front (+z) sits at the top of the screen. */
export function tiltIfVertical(offset: THREE.Vector3): THREE.Vector3 {
  const dist = offset.length()
  if (!(dist > 0) || Math.abs(offset.y) / dist <= 0.995) return offset
  offset.multiplyScalar(1 / dist)
  offset.z += offset.y >= 0 ? -0.14 : 0.14
  return offset.normalize().multiplyScalar(dist)
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
 * Returns false when nothing is loaded.
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
  const dir = tiltIfVertical(new THREE.Vector3(0, 1, 0))
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
