import * as THREE from 'three'

/** The camera-controls 3.x members this reads. */
interface OrbitInternals {
  rotate: (azimuth: number, polar: number, enableTransition?: boolean) => Promise<void>
  update: (delta: number) => boolean
  updateCameraUp: () => void
  setLookAt: (...args: unknown[]) => Promise<void>
  fitToBox: (...args: unknown[]) => Promise<void[]>
  fitToSphere: (...args: unknown[]) => Promise<void[]>
  _spherical: THREE.Spherical
  _sphericalEnd: THREE.Spherical
  _yAxisUpSpace: THREE.Quaternion
  _yAxisUpSpaceInverse: THREE.Quaternion
  _thetaVelocity: { value: number }
  _phiVelocity: { value: number }
  _needsUpdate: boolean
}

/** How near a pole, in radians, the eased camera has to come before it turns over. */
const POLE_RAD = 0.01

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * A vertical drag carries on over the top and under the bottom, as in other model viewers,
 * instead of stopping straight above or below. At the pole the camera's up turns over, so the
 * picture does not jump; the model then shows upside down until the drag comes back over.
 * Any move the app makes (setLookAt, fitToBox, fitToSphere) stands the camera upright first.
 */
export function enableOrbitOverPoles(controls: unknown, camera: THREE.Camera): () => void {
  const cc = controls as OrbitInternals
  if (!cc?._spherical || !cc._sphericalEnd || !cc._yAxisUpSpace || !cc._thetaVelocity || typeof cc.rotate !== 'function') return () => {}
  const base = {
    rotate: cc.rotate,
    update: cc.update,
    updateCameraUp: cc.updateCameraUp,
    setLookAt: cc.setLookAt,
    fitToBox: cc.fitToBox,
    fitToSphere: cc.fitToSphere,
  }
  /* How far the drag has taken the end past a pole: below 0 over the top, above 0 under the bottom. */
  let beyond = 0
  const vertical = () => Math.abs(camera.up.x) < 1e-6 && Math.abs(camera.up.z) < 1e-6

  cc.rotate = function (azimuth, polar, enableTransition = false) {
    const end = cc._sphericalEnd
    const raw = end.phi + beyond + polar
    if (!vertical() || (raw >= 0 && raw <= Math.PI)) {
      beyond = 0
      return base.rotate.call(cc, azimuth, raw - end.phi, enableTransition)
    }
    // The end waits at the pole until the eased camera gets there
    beyond = raw < 0 ? raw : raw - Math.PI
    return base.rotate.call(cc, azimuth, (raw < 0 ? 0 : Math.PI) - end.phi, enableTransition)
  }

  /* Turning camera.up between +y and -y maps theta to -theta and phi to PI - phi. Past the pole
     the same view is theta + PI on the far side, so the picture carries on without a turn. */
  const turnOver = (overTop: boolean) => {
    const cur = cc._spherical
    const end = cc._sphericalEnd
    camera.up.negate()
    base.updateCameraUp.call(cc)
    cur.theta = -(cur.theta + Math.PI)
    cur.phi = overTop ? Math.PI : 0
    end.theta = -(end.theta + Math.PI)
    end.phi = overTop ? Math.PI + beyond : beyond
    cur.makeSafe()
    end.makeSafe()
    cc._thetaVelocity.value = -cc._thetaVelocity.value
    cc._phiVelocity.value = 0
    cc._needsUpdate = true
    beyond = 0
  }

  cc.update = function (delta) {
    if (beyond) {
      const phi = cc._spherical.phi
      if (beyond < 0 ? phi <= POLE_RAD : phi >= Math.PI - POLE_RAD) turnOver(beyond < 0)
    }
    return base.update.call(cc, delta)
  }

  // When the app sets camera.up, keep the camera where it is instead of letting it jump
  const curWorld = new THREE.Vector3()
  const endWorld = new THREE.Vector3()
  const before = new THREE.Quaternion()
  cc.updateCameraUp = function () {
    before.copy(cc._yAxisUpSpace)
    curWorld.setFromSpherical(cc._spherical).applyQuaternion(cc._yAxisUpSpaceInverse)
    endWorld.setFromSpherical(cc._sphericalEnd).applyQuaternion(cc._yAxisUpSpaceInverse)
    base.updateCameraUp.call(cc)
    if (Math.abs(before.dot(cc._yAxisUpSpace)) > 1 - 1e-9) return
    beyond = 0
    cc._spherical.setFromVector3(curWorld.applyQuaternion(cc._yAxisUpSpace))
    cc._sphericalEnd.setFromVector3(endWorld.applyQuaternion(cc._yAxisUpSpace))
    cc._sphericalEnd.theta = cc._spherical.theta + wrapAngle(cc._sphericalEnd.theta - cc._spherical.theta)
    cc._thetaVelocity.value = 0
    cc._phiVelocity.value = 0
    cc._needsUpdate = true
  }

  const upright = () => {
    beyond = 0
    if (camera.up.y >= 0) return
    camera.up.set(0, 1, 0)
    cc.updateCameraUp()
  }
  cc.setLookAt = function (...args) { upright(); return base.setLookAt.apply(cc, args) }
  cc.fitToBox = function (...args) { upright(); return base.fitToBox.apply(cc, args) }
  cc.fitToSphere = function (...args) { upright(); return base.fitToSphere.apply(cc, args) }

  return () => {
    Object.assign(cc, base)
    if (camera.up.y < 0) {
      camera.up.set(0, 1, 0)
      base.updateCameraUp.call(cc)
    }
  }
}
