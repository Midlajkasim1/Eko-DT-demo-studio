// frameSphereInView: Locate in 3D frames the asset in the part of the canvas the user can see (not the whole canvas,
// whose edge sits under the dashboard's asset panel). Pure maths on a real THREE camera: no browser, no model.
// Run: node scripts/test-view-framing.mjs
import assert from 'node:assert'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src', import.meta.url))
const out = await build({
  stdin: { contents: "export * from '@/lib/viewFraming'\nexport * as THREE from 'three'", resolveDir: src, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': src }, logLevel: 'silent',
})
const { frameSphereInView, THREE } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('ok  ' + name) }

// the Studio at 1400x900: the canvas is 1024x848 right of the 340px sidebar; the model strip is the visible part
const canvas = { x: 340, y: 52, w: 1024, h: 848 }
const strip = { x: 580, y: 104, w: 404, h: 796 }
const makeCamera = () => {
  const c = new THREE.PerspectiveCamera(60, canvas.w / canvas.h, 0.1, 1e5)
  c.position.set(30, 20, 40); c.lookAt(0, 0, 0); c.updateMatrixWorld(); c.updateProjectionMatrix()
  return c
}
const center = new THREE.Vector3(3.5, -1.6, -34.7), radius = 0.9

// where a world point lands on the page, through a camera placed at the pose
function pageOf(pose, p) {
  const cam = new THREE.PerspectiveCamera(60, canvas.w / canvas.h, 0.1, 1e5)
  cam.position.copy(pose.position); cam.lookAt(pose.target); cam.updateMatrixWorld(); cam.updateProjectionMatrix()
  const v = p.clone().project(cam)
  return { x: canvas.x + (v.x * .5 + .5) * canvas.w, y: canvas.y + (-v.y * .5 + .5) * canvas.h, z: v.z, cam }
}
// the sphere's silhouette: its centre and the points a radius away along the camera's right and up
function silhouette(pose) {
  const { cam } = pageOf(pose, center)
  const r = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), u = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
  return [center, ...[r, u].flatMap(a => [center.clone().addScaledVector(a, radius), center.clone().addScaledVector(a, -radius)])].map(p => pageOf(pose, p))
}

test('the sphere centre lands on the visible area\'s centre, not the canvas centre', () => {
  const pose = frameSphereInView(makeCamera(), center, radius, canvas, strip)
  const c = pageOf(pose, center)
  assert.ok(Math.abs(c.x - (strip.x + strip.w / 2)) < 1 && Math.abs(c.y - (strip.y + strip.h / 2)) < 1, `${c.x},${c.y}`)
  assert.ok(Math.abs(c.x - (canvas.x + canvas.w / 2)) > 50, 'it is not where the canvas-wide fit would put it')
})

test('the whole sphere is inside the visible area (nothing under the asset panel)', () => {
  const pose = frameSphereInView(makeCamera(), center, radius, canvas, strip)
  for (const p of silhouette(pose)) {
    assert.ok(p.x >= strip.x && p.x <= strip.x + strip.w && p.y >= strip.y && p.y <= strip.y + strip.h, `${Math.round(p.x)},${Math.round(p.y)} outside ${JSON.stringify(strip)}`)
    assert.ok(p.z > -1 && p.z < 1, 'in front of the camera')
  }
})

test('it fills a sensible part of the area: close enough to see it, with the margin kept', () => {
  const pose = frameSphereInView(makeCamera(), center, radius, canvas, strip)
  const s = silhouette(pose), w = Math.max(...s.map(p => p.x)) - Math.min(...s.map(p => p.x))
  assert.ok(w / strip.w > 0.6 && w / strip.w < 0.95, `fills ${(w / strip.w).toFixed(2)} of the strip width`)
})

test('the camera keeps its direction: only its distance and target change', () => {
  const cam = makeCamera(), before = cam.getWorldDirection(new THREE.Vector3())
  const pose = frameSphereInView(cam, center, radius, canvas, strip)
  const after = pose.target.clone().sub(pose.position).normalize()
  assert.ok(before.distanceTo(after) < 1e-9, `${before.toArray()} -> ${after.toArray()}`)
})

test('a wide visible area is limited by its height, a tall one by its width', () => {
  for (const area of [{ x: 400, y: 300, w: 700, h: 200 }, { x: 600, y: 60, w: 150, h: 800 }]) {
    const pose = frameSphereInView(makeCamera(), center, radius, canvas, area)
    for (const p of silhouette(pose)) {
      assert.ok(p.x >= area.x - 0.5 && p.x <= area.x + area.w + 0.5 && p.y >= area.y - 0.5 && p.y <= area.y + area.h + 0.5, `${JSON.stringify(area)} <- ${Math.round(p.x)},${Math.round(p.y)}`)
    }
  }
})

test('the visible area being the whole canvas just centres the sphere on the canvas', () => {
  const pose = frameSphereInView(makeCamera(), center, radius, canvas, canvas)
  const c = pageOf(pose, center)
  assert.ok(Math.abs(c.x - (canvas.x + canvas.w / 2)) < 1 && Math.abs(c.y - (canvas.y + canvas.h / 2)) < 1)
})

test('a bigger asset is framed further away (distance follows the radius)', () => {
  const near = frameSphereInView(makeCamera(), center, 1, canvas, strip), far = frameSphereInView(makeCamera(), center, 4, canvas, strip)
  const d = p => p.position.distanceTo(p.target)
  assert.ok(Math.abs(d(far) / d(near) - 4) < 1e-6, `${d(far) / d(near)}`)
})

console.log(`\n${passed} view-framing tests passed`)
