import * as THREE from 'three'
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import type { TemplateFrame } from '@/constants/viewTemplates'

type Ink = NonNullable<TemplateFrame['ink']>

/**
 * Lines along silhouettes and creases, the way an elevation is drawn. The scene
 * is re-rendered into view-space normals with a depth buffer alongside, and the
 * lines are wherever those two disagree between neighbouring pixels: a jump in
 * normal is a corner, a jump in depth is one surface passing in front of another,
 * and the empty sky reads as both, which is what draws the outer silhouette.
 *
 * Unlike the depth-only Sobel in CustomEdgeShader this catches creases inside a
 * silhouette, which is what a white-model or X-ray template is drawn with.
 */
export class InkPass extends Pass {
  private scene: THREE.Scene
  private camera: THREE.Camera
  private readonly buffer: THREE.WebGLRenderTarget
  private readonly normals = new THREE.MeshNormalMaterial()
  private readonly quad: FullScreenQuad
  private readonly material: THREE.ShaderMaterial

  constructor(scene: THREE.Scene, camera: THREE.Camera, ink: Ink) {
    super()
    this.scene = scene
    this.camera = camera

    const depth = new THREE.DepthTexture(1, 1)
    depth.format = THREE.DepthFormat
    depth.type = THREE.UnsignedIntType
    // Plain 8-bit colour: MeshNormalMaterial writes 0..1, so a half-float target
    // buys nothing, and a half-float colour buffer paired with a 32-bit depth
    // texture is the combination drivers are least happy about — under software
    // GL it intermittently yields an empty frame.
    this.buffer = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: depth,
    })

    this.material = new THREE.ShaderMaterial({
      name: 'InkShader',
      uniforms: {
        tDiffuse: { value: null },
        tNormal: { value: this.buffer.texture },
        tDepth: { value: depth },
        texel: { value: new THREE.Vector2() },
        color: { value: new THREE.Color(ink.color) },
        thickness: { value: ink.thickness },
        depthEdge: { value: ink.depth },
        creaseEdge: { value: ink.crease },
        strength: { value: ink.strength },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 200000 },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: INK_FRAGMENT,
    })
    this.quad = new FullScreenQuad(this.material)
  }

  /** Restates the line settings without rebuilding the pass. */
  setInk(ink: Ink) {
    const u = this.material.uniforms
    u.color.value.set(ink.color)
    u.thickness.value = ink.thickness
    u.depthEdge.value = ink.depth
    u.creaseEdge.value = ink.crease
    u.strength.value = ink.strength
  }

  /** The camera object is swapped when the projection changes, so the pass is
   *  told which scene and camera it is drawing every frame. */
  view(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene
    this.camera = camera
  }

  setSize(width: number, height: number) {
    this.buffer.setSize(width, height)
    this.material.uniforms.texel.value.set(1 / width, 1 / height)
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ) {
    const camera = this.camera as THREE.PerspectiveCamera
    this.material.uniforms.cameraNear.value = camera.near ?? 0.1
    this.material.uniforms.cameraFar.value = camera.far ?? 200000

    // Normals only: the sky would otherwise be painted over the buffer and every
    // pixel would look like geometry.
    const background = this.scene.background
    const clear = renderer.getClearColor(new THREE.Color())
    const clearAlpha = renderer.getClearAlpha()
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate
    this.scene.background = null
    this.scene.overrideMaterial = this.normals
    // The normal material ignores lighting, so the shadow map cannot affect it
    renderer.shadowMap.autoUpdate = false
    renderer.setClearColor(0x000000, 0)
    renderer.setRenderTarget(this.buffer)
    renderer.clear()
    renderer.render(this.scene, this.camera)
    this.scene.overrideMaterial = null
    this.scene.background = background
    renderer.setClearColor(clear, clearAlpha)
    renderer.shadowMap.autoUpdate = shadowAutoUpdate

    this.material.uniforms.tDiffuse.value = readBuffer.texture
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer)
    if (this.clear) renderer.clear()
    this.quad.render(renderer)
  }

  dispose() {
    this.buffer.dispose()
    this.buffer.depthTexture?.dispose()
    this.normals.dispose()
    this.material.dispose()
    this.quad.dispose()
  }
}

const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const INK_FRAGMENT = /* glsl */ `
  #include <packing>

  uniform sampler2D tDiffuse;
  uniform sampler2D tNormal;
  uniform sampler2D tDepth;
  uniform vec2 texel;
  uniform vec3 color;
  uniform float thickness;
  uniform float depthEdge;
  uniform float creaseEdge;
  uniform float strength;
  uniform float cameraNear;
  uniform float cameraFar;
  varying vec2 vUv;

  /** Distance from the eye, in world units, so thresholds mean the same everywhere. */
  float eyeDistance(vec2 uv) {
    float depth = texture2D(tDepth, uv).x;
    return -perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  }

  void main() {
    vec4 base = texture2D(tDiffuse, vUv);

    vec2 step = texel * thickness;
    vec4 here = texture2D(tNormal, vUv);
    float depthHere = eyeDistance(vUv);

    float crease = 0.0;
    float ridge = 0.0;

    for (int i = 0; i < 4; i++) {
      vec2 offset = i == 0 ? vec2(step.x, 0.0)
                  : i == 1 ? vec2(-step.x, 0.0)
                  : i == 2 ? vec2(0.0, step.y)
                  : vec2(0.0, -step.y);
      vec2 uv = clamp(vUv + offset, vec2(0.0), vec2(1.0));

      vec4 there = texture2D(tNormal, uv);
      // The alpha channel is 0 where nothing was drawn, which makes the sky read
      // as a hard break and gives the outer silhouette.
      crease = max(crease, length(there.rgb - here.rgb) + abs(there.a - here.a));

      float depthThere = eyeDistance(uv);
      // Relative to distance: a 10 cm step reads as an edge up close and not at
      // 200 m, which is how a drawing behaves.
      ridge = max(ridge, abs(depthThere - depthHere) / max(depthHere, 1.0));
    }

    float line = max(
      smoothstep(creaseEdge, creaseEdge + 0.35, crease),
      smoothstep(depthEdge * 0.01, depthEdge * 0.03, ridge)
    );

    gl_FragColor = vec4(mix(base.rgb, color, line * strength), base.a);
  }
`
