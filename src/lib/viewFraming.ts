import * as THREE from 'three'

/** A rectangle in page pixels */
export interface ViewRect { x: number; y: number; w: number; h: number }

/**
 * Where to put the camera so a bounding sphere sits whole, and centred, in the part of the canvas the user can
 * actually see. The canvas fills the whole window; the dashboard's panels cover most of it, so fitting to the
 * canvas hides part of the asset under them. The camera keeps its direction (azimuth and polar); only its
 * distance and its target change. Pure: it returns the pose, the caller moves the camera.
 */
export function frameSphereInView(
  camera: THREE.PerspectiveCamera, center: THREE.Vector3, radius: number,
  canvas: ViewRect, visible: ViewRect, margin = 1.15
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)        // vertical half-angle of the whole canvas
  const perPx = tanHalf / (canvas.h / 2)                                     // tan(angle) per pixel, square pixels
  const fitHalf = Math.min(visible.w, visible.h) / 2 * perPx                 // the tighter half-angle of the visible part
  const dist = (radius * margin) / Math.sin(Math.atan(fitHalf))
  camera.updateMatrixWorld()
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
  const forward = camera.getWorldDirection(new THREE.Vector3())
  // shift the target so the sphere's centre lands on the visible area's centre, not the canvas's
  const dx = (visible.x + visible.w / 2) - (canvas.x + canvas.w / 2)
  const dy = (visible.y + visible.h / 2) - (canvas.y + canvas.h / 2)
  const worldPerPx = dist * perPx
  const target = center.clone().addScaledVector(right, -dx * worldPerPx).addScaledVector(up, dy * worldPerPx)
  return { position: target.clone().addScaledVector(forward, -dist), target }
}
