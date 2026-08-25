import * as FRAGS from '@thatopen/fragments'
import { CloudShader } from './CloudShader'
import { CloudShadowShader } from './CloudShadowShader'
import * as OBC from '@thatopen/components'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js'
import { SSRPass } from 'three/examples/jsm/postprocessing/SSRPass.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { ColorGradeShader } from './ColorGradeShader'
import { TemplateGradeShader } from './TemplateGradeShader'
import { GodRayShader } from './GodRayShader'
import { CustomEdgeShader } from './CustomEdgeShader'
import { InkPass } from './InkPass'
import {
  dressMaterial,
  makeSkyEnvironment,
  makeSkyTexture,
  restoreMaterial,
  type DeliveredMaterials,
} from './templateScene'
import * as SunCalc from 'suncalc'
import { PBR_MATERIAL_MAPPINGS } from '../constants/pbrMaterials'
import { RENDER_DEFAULTS, type RenderSettings, type ToneMappingId } from '../constants/renderSettings'
import { getTemplateScene, type TemplateScene } from '../constants/viewTemplates'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { N8AOPass } from 'n8ao'

const TONE_MAPPINGS: Record<ToneMappingId, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
}

export interface FragmentsEngine {
  fragments: FRAGS.FragmentsModels
  world: any
  components: OBC.Components
  dispose: () => Promise<void>
  setLightingParams: (params: RenderSettings) => void
}

export async function initFragmentsEngine(
  container: HTMLDivElement
): Promise<FragmentsEngine> {
  const components = new OBC.Components()
  const worlds = components.get(OBC.Worlds)

  const world = worlds.create<
    OBC.SimpleScene,
    OBC.SimpleCamera,
    OBC.SimpleRenderer
  >()

  world.scene = new OBC.SimpleScene(components)
  world.scene.setup()
  world.scene.three.background = null

  world.renderer = new OBC.SimpleRenderer(components, container, { preserveDrawingBuffer: true, antialias: true })
  
  // Prepare Environment
  const pmremGenerator = new THREE.PMREMGenerator(world.renderer.three)
  pmremGenerator.compileEquirectangularShader()
  const envScene = new RoomEnvironment()
  let envTexture = pmremGenerator.fromScene(envScene, 0.04).texture
  envScene.dispose()

  // Load Photorealistic HDRI
  const rgbeLoader = new RGBELoader()
  rgbeLoader.load('/hdri/venice_sunset_1k.hdr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping
    const hdriTexture = pmremGenerator.fromEquirectangular(texture).texture
    envTexture = hdriTexture
    if (isRealistic) {
      world.scene.three.environment = envTexture
    }
    texture.dispose()
  })

  // Realistic Lights & Environment
  const realisticGroup = new THREE.Group()
  
  // Sky
  const sky = new Sky()
  sky.name = 'SkyDome'
  sky.scale.setScalar(500000)
  
  const skyUniforms = sky.material.uniforms
  skyUniforms['turbidity'].value = 5.0
  skyUniforms['rayleigh'].value = 2.0
  skyUniforms['mieCoefficient'].value = 0.005
  skyUniforms['mieDirectionalG'].value = 0.98
  
  const rAmbient = new THREE.HemisphereLight(0xffffff, 0x444455, 0.4)
  
  const rDir = new THREE.DirectionalLight(0xffeedd, 1.2)
  rDir.position.set(500, 1000, 500)
  rDir.castShadow = true
  
  // Map Size
  rDir.shadow.mapSize.width = 4096
  rDir.shadow.mapSize.height = 4096
  rDir.shadow.camera.near = 10
  rDir.shadow.camera.far = 20000
  rDir.shadow.camera.left = -5000
  rDir.shadow.camera.right = 5000
  rDir.shadow.camera.top = 5000
  rDir.shadow.camera.bottom = -5000
  rDir.shadow.bias = -0.0005
  rDir.shadow.normalBias = 0.05
  rDir.shadow.camera.layers.enable(11)

  // Clouds
  const cloudGeo = new THREE.SphereGeometry(190000, 64, 64)
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(CloudShader.uniforms),
    vertexShader: CloudShader.vertexShader,
    fragmentShader: CloudShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.NormalBlending
  })
  
  const cloudsDome = new THREE.Mesh(cloudGeo, cloudMat)
  cloudsDome.name = 'CloudsDome'

  const fog = new THREE.FogExp2(RENDER_DEFAULTS.fogColor, RENDER_DEFAULTS.fogDensity)

  realisticGroup.add(sky, rAmbient, rDir, cloudsDome)
  world.scene.three.add(realisticGroup)

  // ── Render Lite ──────────────────────────────────
  const liteDirLight = new THREE.DirectionalLight(0xfff5e0, 1.2)
  liteDirLight.name = 'LiteDirLight'
  liteDirLight.castShadow = true
  liteDirLight.shadow.mapSize.width = 1024
  liteDirLight.shadow.mapSize.height = 1024
  liteDirLight.shadow.camera.near = 1
  liteDirLight.shadow.camera.far = 10000
  liteDirLight.shadow.camera.left = -500
  liteDirLight.shadow.camera.right = 500
  liteDirLight.shadow.camera.top = 500
  liteDirLight.shadow.camera.bottom = -500
  liteDirLight.shadow.bias = -0.0005
  liteDirLight.shadow.normalBias = 0.05
  // sunOffset drives the render-loop repositioning relative to camera target
  liteDirLight.userData.sunOffset = new THREE.Vector3(300, 600, 300)
  // NOT added to scene yet — only added when Render Lite activates

  // ── View Templates ───────────────────────────────
  // Lit by hand rather than by the realistic rig, because every light is part of
  // the template and has to be reachable when the template changes.
  const templateGroup = new THREE.Group()
  templateGroup.name = 'TemplateLights'
  const tSun = new THREE.DirectionalLight()
  tSun.name = 'TemplateSun'
  tSun.shadow.mapSize.setScalar(2048)
  tSun.shadow.camera.near = 1
  tSun.shadow.bias = -0.0005
  tSun.shadow.normalBias = 0.05
  const tFill = new THREE.DirectionalLight()
  const tBounce = new THREE.HemisphereLight()
  const tAmbient = new THREE.AmbientLight()
  templateGroup.add(tSun, tFill, tBounce, tAmbient)
  templateGroup.visible = false
  world.scene.three.add(templateGroup)

  const gradCanvas = document.createElement('canvas')
  gradCanvas.width = 2
  gradCanvas.height = 512
  const gradCtx = gradCanvas.getContext('2d')!
  let gradTexture: THREE.CanvasTexture | null = null

  function applyGradientBackground(top: string, bottom: string) {
    const g = gradCtx.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0, top)
    g.addColorStop(1, bottom)
    gradCtx.fillStyle = g
    gradCtx.fillRect(0, 0, 2, 512)
    if (gradTexture) {
      gradTexture.needsUpdate = true
    } else {
      gradTexture = new THREE.CanvasTexture(gradCanvas)
    }
    world.scene.three.background = gradTexture
  }

  let isRealistic = false
  let isRenderLite = false
  let bloomPass: UnrealBloomPass
  let currentCloudSpeed = 1.0
  let bokehPass: any
  let renderPass: RenderPass
  let ssaoPass: any
  let ssrPass: any
  let colorGradePass: any
  let cloudShadowPass: any
  let godRayPass: any
  let edgePass: any
  let smaaPass: SMAAPass
  let grid: any
  let sceneDepthRT: THREE.WebGLRenderTarget
  let autoFocusEnabled = false
  let isPbrEnabled = true
  let progressiveRenderingEnabled = true
  let cameraMoving = false
  let progressiveRestoreTimer: ReturnType<typeof setTimeout> | null = null
  let savedAoEnabled = false
  let savedEdgeEnabled = false
  /** The template driving the scene, or null when the project settings do */
  let activeTemplate: TemplateScene | null = null
  let templateSky: THREE.Texture | null = null
  let templateEnv: THREE.Texture | null = null
  /** How the item materials arrived, so a template can be taken back off them */
  const templateBase: DeliveredMaterials = new WeakMap()

  // ── The template's own composer ──────────────────────────────────────────
  // A template does not borrow the studio's post-processing chain. It builds the
  // reference viewer's chain instead — a multisampled half-float target, then
  // occlusion, lines, bloom and grade in that order — so a template renders here
  // the way it renders there. The studio's own passes are left alone, which also
  // keeps Advanced Rendering and Render Lite exactly as they were.
  let templateComposer: EffectComposer | null = null
  let templateRenderPass: RenderPass | null = null
  let templateAoPass: GTAOPass | null = null
  let templateInkPass: InkPass | null = null

  const disposeTemplateComposer = () => {
    if (!templateComposer) return
    for (const pass of templateComposer.passes) (pass as any).dispose?.()
    templateComposer.renderTarget1.dispose()
    templateComposer.renderTarget2.dispose()
    templateComposer = null
    templateRenderPass = null
    templateAoPass = null
    templateInkPass = null
  }

  const buildTemplateComposer = (frame: TemplateScene['frame']) => {
    disposeTemplateComposer()

    const size = world.renderer.three.getDrawingBufferSize(new THREE.Vector2())
    // Multisampled and half float: the edges stay clean without a post-process
    // anti-aliasing pass, and tone mapping has headroom above white to work with.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    })

    const composer = new EffectComposer(world.renderer.three, target)
    composer.setSize(size.x, size.y)

    templateRenderPass = new RenderPass(world.scene.three, world.camera.three)
    composer.addPass(templateRenderPass)

    if (frame.ao) {
      // GTAO, as the reference uses — its radius is in world units, and it reads
      // far cleaner on building-scale geometry than a screen-space pass does.
      const ao = new GTAOPass(world.scene.three, world.camera.three, size.x, size.y)
      ao.updateGtaoMaterial({ radius: frame.ao.radius, distanceExponent: 1.5, thickness: 1 })
      ao.blendIntensity = frame.ao.intensity
      composer.addPass(ao)
      templateAoPass = ao
    }

    if (frame.ink) {
      const ink = new InkPass(world.scene.three, world.camera.three, frame.ink)
      composer.addPass(ink)
      templateInkPass = ink
    }

    if (frame.bloom) {
      composer.addPass(new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        frame.bloom.strength, frame.bloom.radius, frame.bloom.threshold,
      ))
    }

    if (frame.grade) {
      const grade = new ShaderPass(TemplateGradeShader)
      grade.uniforms.saturation.value = frame.grade.saturation
      grade.uniforms.contrast.value = frame.grade.contrast
      grade.uniforms.warmth.value = frame.grade.warmth
      grade.uniforms.vignette.value = frame.grade.vignette
      grade.uniforms.levels.value = frame.grade.levels
      composer.addPass(grade)
    }

    // Tone maps and converts to sRGB; every pass above works in linear light
    composer.addPass(new OutputPass())
    templateComposer = composer
  }

  /**
   * Items IFC carries that are not building fabric. Room volumes are the loud
   * ones — they export as translucent boxes that swallow whole floors — but
   * openings, grids and annotations are just as unwanted, and they are what makes
   * a washed or white model read as cluttered instead of clean. Hidden while a
   * template runs and put back on the way out; the reference viewer drops them on
   * load and never shows them at all.
   */
  const NON_PHYSICAL = [
    /^IFCSPACE$/, /^IFCSPATIALZONE$/, /^IFCZONE$/, /^IFCOPENINGELEMENT$/,
    /^IFCVIRTUALELEMENT$/, /^IFCGRID$/, /^IFCANNOTATION$/,
  ]

  /** modelId -> the ids this hid, so nothing hidden by an override is revived */
  const hiddenNonPhysical = new Map<string, number[]>()

  const hideNonPhysical = async (only?: string) => {
    for (const [id, model] of fragments.models.list.entries()) {
      if (only && id !== only) continue
      if (hiddenNonPhysical.has(id)) continue
      try {
        const found = await (model as any).getItemsOfCategories?.(NON_PHYSICAL)
        if (!found) continue
        const localIds = Object.values(found).flat() as number[]
        if (!localIds.length) continue
        await (model as any).setVisible(localIds, false)
        hiddenNonPhysical.set(id, localIds)
      } catch { /* the worker has not registered this model yet */ }
    }
    void fragments.update(true)
  }

  const showNonPhysical = async () => {
    for (const [id, localIds] of hiddenNonPhysical.entries()) {
      const model = fragments.models.list.get(id)
      if (!model) continue
      try { await (model as any).setVisible(localIds, true) } catch { /* model gone */ }
    }
    hiddenNonPhysical.clear()
    void fragments.update(true)
  }

  /**
   * Fragments streams geometry on demand: by default it swaps distant items for
   * LOD boxes and drops off-screen ones, which blinks geometry in and out while
   * the camera moves. That is barely noticeable on the delivered grey model and
   * very noticeable once a template has washed or ghosted the surfaces, because
   * the LOD stand-ins are not the template's colour. Templates therefore pin the
   * models to full geometry. ALL_GEOMETRY rather than ALL_VISIBLE: it still
   * honours items hidden by a material override.
   */
  const setTemplateStreaming = (on: boolean) => {
    // The reference also raises graphicsQuality to 1 and maxUpdateRate to 16 ms.
    // Both are deliberately NOT copied: they are streaming knobs rather than part
    // of the look, and together they make the worker push tiles at maximum detail
    // roughly every frame. On a large federated model that is most of the cost of
    // a template and none of its appearance, so the project's own values stand.
    for (const model of fragments.models.list.values()) {
      const setLodMode = (model as any).setLodMode
      if (typeof setLodMode !== 'function') continue
      // Rejects while the worker is still registering the model; harmless
      Promise.resolve(setLodMode.call(model, on ? FRAGS.LodMode.ALL_GEOMETRY : FRAGS.LodMode.DEFAULT))
        .catch(() => { /* model not ready on the worker side yet */ })
    }
  }

  /**
   * Half the largest dimension of everything loaded — what the sun distance and
   * the shadow camera are sized against. Cached per model count, because it walks
   * every model's bounding box.
   */
  const computeMaxRadius = () => {
    const currentModelCount = fragments.models ? fragments.models.list.size : 0
    if (world.scene.three.userData.maxRadius && world.scene.three.userData.cachedModelCount === currentModelCount) {
      return world.scene.three.userData.maxRadius as number
    }
    if (currentModelCount === 0) return 10000

    const box = new THREE.Box3()
    for (const model of fragments.models.list.values()) {
      const obj = (model as any).object || (model as any)
      if (obj && typeof obj.updateWorldMatrix === 'function') box.expandByObject(obj)
    }
    if (box.isEmpty()) return 10000

    const size = new THREE.Vector3()
    box.getSize(size)
    // Padded by the bounding box radius so shadows aren't clipped
    const maxRadius = Math.max(size.x, size.y, size.z) * 0.6
    world.scene.three.userData.maxRadius = maxRadius
    world.scene.three.userData.cachedModelCount = currentModelCount
    return maxRadius
  }

  /**
   * Puts back the Lambert materials the realistic pipeline swapped for Standard
   * ones. A template dresses the materials the fragments worker hands out, so it
   * can only be seen if those are the materials actually on the meshes.
   */
  const revertUpgradedMaterials = () => {
    world.scene.three.traverse((child: any) => {
      if (!child.isMesh || !child.material) return
      const revert = (mat: any) => {
        if (!mat?.userData?.isUpgraded || !mat.userData.originalMaterial) return mat
        const original = mat.userData.originalMaterial
        mat.dispose()
        return original
      }
      if (Array.isArray(child.material)) child.material = child.material.map(revert)
      else child.material = revert(child.material)
    })
  }

  /** Takes the template back off the scene, so another mode can set up its own. */
  const clearTemplate = () => {
    for (const material of fragments.models.materials.list.values()) {
      restoreMaterial(material as THREE.Material, templateBase)
    }
    templateGroup.visible = false
    tSun.castShadow = false
    if (tSun.target.parent) tSun.target.removeFromParent()
    const catcher = world.scene.three.getObjectByName('ShadowCatcherPlane')
    if (catcher) catcher.visible = true
    void showNonPhysical()
    templateSky?.dispose()
    templateSky = null
    templateEnv?.dispose()
    templateEnv = null
    world.scene.three.environment = null
    world.scene.three.background = null
    disposeTemplateComposer()
    setTemplateStreaming(false)
  }

  /**
   * Puts a whole rendering style on the scene at once: the sky behind the model,
   * the lights, what the surfaces are made of, and the passes that run over the
   * finished frame. Switching is instant — nothing is reloaded, only restated.
   */
  const applyTemplate = (template: TemplateScene, params: RenderSettings) => {
    const { lights, surfaces, frame } = template

    // ── Lights ──────────────────────────────────────────────────────────────
    const maxRadius = computeMaxRadius()
    const sunDistance = Math.max(1000, maxRadius * 4)
    const from = new THREE.Vector3(...lights.sun.from).normalize()

    tSun.color.set(lights.sun.color)
    tSun.intensity = lights.sun.intensity
    // Repositioned in the render loop so it follows the camera target
    tSun.userData.sunOffset = from.clone().multiplyScalar(sunDistance)
    tSun.position.copy(tSun.userData.sunOffset)

    // Opposite the sun, so faces turned away from it still describe themselves.
    tFill.color.set(lights.fill.color)
    tFill.intensity = lights.fill.intensity
    tFill.position
      .set(-lights.sun.from[0], lights.sun.from[1] * 0.6, -lights.sun.from[2])
      .normalize()
      .multiplyScalar(sunDistance)

    tBounce.color.set(lights.bounce.sky)
    tBounce.groundColor.set(lights.bounce.ground)
    tBounce.intensity = lights.bounce.intensity
    tAmbient.intensity = lights.ambient
    templateGroup.visible = true

    if (tSun.target.parent !== world.scene.three) world.scene.three.add(tSun.target)

    // Every other light in the scene belongs to a mode that is not running. The
    // realistic rig is switched off as a group, so its own lights are left alone
    // — they have to still be on when that mode comes back.
    realisticGroup.visible = false
    if (liteDirLight.parent) liteDirLight.removeFromParent()
    world.scene.three.traverse((child: any) => {
      if ((child.isDirectionalLight || child.isAmbientLight || child.isHemisphereLight)
        && child.parent !== templateGroup && child.parent !== realisticGroup) {
        child.visible = false
      }
    })

    // ── Sky, environment, tone ──────────────────────────────────────────────
    templateSky?.dispose()
    templateEnv?.dispose()
    templateSky = makeSkyTexture(template.sky)
    templateEnv = makeSkyEnvironment(template.sky)
    world.scene.three.background = templateSky
    world.scene.three.environment = templateEnv
    world.scene.three.environmentIntensity = 1
    world.scene.three.fog = null
    sky.visible = false
    cloudsDome.visible = false

    world.renderer.three.toneMapping = TONE_MAPPINGS[frame.toneMapping]
    world.renderer.three.toneMappingExposure = frame.exposure

    // ── Ground ──────────────────────────────────────────────────────────────
    // No shadow map and no slab. The reference lights the model with sun, fill
    // and bounce and lets the occlusion pass do the contact darkening; a hard sun
    // shadow across a white or ghosted model reads as a mistake.
    world.renderer.three.shadowMap.enabled = false
    tSun.castShadow = false

    // The catcher is a 10 km plane at grade. With no shadow map it has nothing to
    // catch, and it paints a bright band across the horizon — glaring on X-ray.
    const catcher = world.scene.three.getObjectByName('ShadowCatcherPlane')
    if (catcher) catcher.visible = false
    if (grid) grid.visible = false

    // ── Surfaces ────────────────────────────────────────────────────────────
    void hideNonPhysical()
    for (const material of fragments.models.materials.list.values()) {
      dressMaterial(material as THREE.Material, surfaces, templateEnv, templateBase)
    }

    // ── Frame ───────────────────────────────────────────────────────────────
    // The template draws through its own composer, so none of the studio's passes
    // run. They are switched off anyway, so nothing is left half-enabled when the
    // project goes back to Advanced Rendering or Render Lite.
    for (const pass of [ssaoPass, bloomPass, colorGradePass, edgePass, godRayPass,
                        ssrPass, bokehPass, cloudShadowPass, smaaPass]) {
      if (pass) pass.enabled = false
    }
    renderPass.enabled = true
    savedAoEnabled = false
    savedEdgeEnabled = false

    buildTemplateComposer(frame)
  }

  const setLightingParams = (params: RenderSettings) => {
    const template = getTemplateScene(params.templateId)
    // A template owns the whole picture, so it stands in for the other modes
    // rather than layering on top of them
    if (activeTemplate && !template) clearTemplate()
    activeTemplate = template

    if (template) {
      isRealistic = false
      isRenderLite = false
      isPbrEnabled = params.pbrMaterials !== false
      if (params.progressiveRendering !== undefined) progressiveRenderingEnabled = params.progressiveRendering
      // The grid and anti-aliasing are the template's to decide, not the
      // project's: the reference draws no grid, and its edges come from a
      // multisampled target rather than from a post-process pass.
      revertUpgradedMaterials()
      setTemplateStreaming(true)
      applyTemplate(template, params)

      world.scene.three.traverse((child: any) => {
        if (child.isMesh && child.material) child.material.needsUpdate = true
      })
      return
    }

    isRealistic = params.realisticMode
    isRenderLite = params.renderLite === true
    isPbrEnabled = params.pbrMaterials !== false
    if (params.progressiveRendering !== undefined) progressiveRenderingEnabled = params.progressiveRendering
    cloudMat.uniforms.cloudDensity.value = params.cloudDensity
    cloudMat.uniforms.cloudColor.value.set(params.cloudColor)
    currentCloudSpeed = params.cloudSpeed
    const cloudsVisible = params.cloudsEnabled !== false && params.cloudDensity > 0
    cloudsDome.visible = cloudsVisible

    if (!params.realisticMode && params.gradientSkyEnabled !== false) {
      const top = params.gradientSkyTop ?? '#c5c5c5'
      const bottom = params.gradientSkyBottom ?? '#7e7e7e'
      applyGradientBackground(top, bottom)
    } else if (!params.realisticMode) {
      world.scene.three.background = null
    }

    if (grid) grid.visible = params.gridVisible === true
    if (smaaPass) smaaPass.enabled = params.antialiasing !== false

    if (cloudShadowPass) {
      cloudShadowPass.enabled = params.realisticMode && cloudsVisible && params.cloudShadowsEnabled !== false
      cloudShadowPass.uniforms.cloudDensity.value = params.cloudDensity
    }

    if (bokehPass) {
      bokehPass.enabled = params.dofEnabled
      if (!autoFocusEnabled && params.dofFocus !== undefined) bokehPass.uniforms['focus'].value = params.dofFocus
      if (params.dofAperture !== undefined) bokehPass.uniforms['aperture'].value = params.dofAperture
      if (params.dofMaxBlur !== undefined) bokehPass.uniforms['maxblur'].value = params.dofMaxBlur
    }
    
    if (params.autoFocus !== undefined) {
      autoFocusEnabled = params.autoFocus
    }
    
    if (ssaoPass) {
      ssaoPass.enabled = params.realisticMode && params.ambientOcclusion !== false
      // N8AO renders the scene itself; exactly one of these two must draw it
      renderPass.enabled = !ssaoPass.enabled
      if (params.aoRadius !== undefined) ssaoPass.configuration.aoRadius = params.aoRadius
      if (params.aoIntensity !== undefined) ssaoPass.configuration.intensity = params.aoIntensity
    }
    
    if (edgePass) {
      edgePass.enabled = params.realisticMode && params.outlineEdges !== false
    }
    
    if (ssrPass) {
      ssrPass.enabled = params.realisticMode && params.ssrEnabled === true
    }
    
    if (godRayPass) {
      godRayPass.enabled = params.realisticMode && params.godRaysEnabled === true
      if (params.godRayStrength !== undefined) godRayPass.uniforms.godRayStrength.value = params.godRayStrength
    }
    
    if (colorGradePass) {
      colorGradePass.enabled = params.realisticMode
      if (params.visualSaturation !== undefined) colorGradePass.uniforms.saturation.value = params.visualSaturation
      if (params.visualTemperature !== undefined) colorGradePass.uniforms.temperature.value = params.visualTemperature
      if (params.visualContrast !== undefined) colorGradePass.uniforms.contrast.value = params.visualContrast
      if (params.visualVignette !== undefined) colorGradePass.uniforms.vignette.value = params.visualVignette
      if (params.chromaticAberration !== undefined) colorGradePass.uniforms.chromaticAberration.value = params.chromaticAberration
    }

    if (params.realisticMode) {
      // Upgrade Lambert materials to Standard for PBR reflections
      world.scene.three.traverse((child: any) => {
        if (child.isMesh) {
          let isInvisible = false;
          if (child.material) {
            const checkMat = (m: any) => m.transparent && (m.opacity < 0.05 || m.colorWrite === false)
            if (Array.isArray(child.material)) {
               isInvisible = child.material.length > 0 && child.material.every(checkMat)
            } else {
               isInvisible = checkMat(child.material)
            }
          }

          if (isInvisible) {
             child.castShadow = false;
             child.receiveShadow = false;
             child.visible = false;
             return;
          }

          child.castShadow = true
          child.receiveShadow = true
          
          if (child.material) {
            let mapping: any = null;
            for (const [modelId, model] of fragments.models.list.entries()) {
               const map = (model as any).userData?.pbrMaterialMap;
               if (map) {
                  if (map.has(child.uuid)) mapping = map.get(child.uuid);
                  else if (map.has(child.id?.toString())) mapping = map.get(child.id?.toString());
               }
               if (mapping) break;
            }

            const convert = (mat: any) => {
              // Revert to original material if PBR is disabled
              if (!isPbrEnabled) {
                 if (mat.userData.isUpgraded && mat.userData.originalMaterial) {
                     return mat.userData.originalMaterial;
                 }
                 return mat;
              }
              
              if ((mat.isMeshLambertMaterial || mat.isMeshBasicMaterial || mat.isMeshPhongMaterial) && !mat.userData.isUpgraded) {
                let newMat;
                
                const matColor = mat.color as THREE.Color | undefined
                const isUncolored = !matColor || (matColor.r >= 0.93 && matColor.g >= 0.93 && matColor.b >= 0.93)
                
                if (mapping) {
                  const resolvedColor = isUncolored ? mapping.color : matColor
                  
                  if (mapping.isPhysical) {
                    newMat = new THREE.MeshPhysicalMaterial({
                      color: resolvedColor,
                      roughness: mapping.roughness,
                      metalness: mapping.metalness,
                      transmission: mapping.transmission || 0,
                      transparent: mapping.transparent || false,
                      opacity: mapping.opacity !== undefined ? mapping.opacity : 1.0,
                      side: mat.side,
                      map: mat.map || null
                    });
                  } else {
                    newMat = new THREE.MeshStandardMaterial({
                      color: resolvedColor,
                      roughness: mapping.roughness,
                      metalness: mapping.metalness,
                      side: mat.side,
                      transparent: mat.transparent || (mapping.opacity !== undefined && mapping.opacity < 1.0),
                      opacity: mapping.opacity !== undefined ? mapping.opacity : (mat.opacity || 1.0),
                      map: mat.map || null
                    });
                  }
                } else {
                  newMat = new THREE.MeshStandardMaterial({
                    color: mat.color,
                    roughness: 0.8,
                    metalness: 0.1,
                    side: mat.side,
                    transparent: mat.transparent,
                    opacity: mat.opacity,
                    map: mat.map || null
                  })
                }
                newMat.userData.isUpgraded = true
                newMat.userData.originalMaterial = mat

                return newMat
              }
              return mat
            }
            if (Array.isArray(child.material)) {
              child.material = child.material.map(convert)
            } else {
              child.material = convert(child.material)
            }
          }
        }
      })
      // Calculate sun position for Dubai (Lat: 25.2048, Lon: 55.2708)
      // We force the UTC date to be (timeOfDay - 4 hours) so the slider acts as Dubai Local Time (UTC+4)
      const now = new Date()
      const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(params.timeOfDay) - 4, (params.timeOfDay % 1) * 60, 0))
      
      const sunPos = SunCalc.getPosition(date, 25.2048, 55.2708)
      
      // Convert SunCalc degrees back to radians
      const altitudeRad = sunPos.altitude * Math.PI / 180
      const azimuthRad = sunPos.azimuth * Math.PI / 180

      const phi = Math.PI / 2 - altitudeRad
      const theta = azimuthRad + Math.PI / 2
      
      // Ensure sky does not receive shadows (prevents giant black blobs in the sky)
      if (sky) {
        sky.receiveShadow = false
        sky.castShadow = false
        sky.visible = params.skyboxEnabled !== false
        skyUniforms['turbidity'].value = params.skyTurbidity
        skyUniforms['rayleigh'].value = params.skyRayleigh
        skyUniforms['mieCoefficient'].value = params.skyMieCoefficient
        skyUniforms['mieDirectionalG'].value = params.skyMieDirectionalG
      }
      if (cloudsDome) {
        cloudsDome.receiveShadow = false
        cloudsDome.castShadow = false
      }
      
      const maxRadius = computeMaxRadius()

      // Ensure the sun is placed far enough outside the bounding box
      const sunDistance = Math.max(10000, maxRadius * 4)
      const sunPosition = new THREE.Vector3()
      sunPosition.setFromSphericalCoords(sunDistance, phi, theta)
      sky.material.uniforms['sunPosition'].value.copy(sunPosition)
      
      // We don't set rDir position here because we will update it in the render loop to follow the camera
      rDir.userData.sunOffset = sunPosition.clone()
      
      cloudMat.uniforms.sunPosition.value.copy(sunPosition)

      const shadowsOn = params.shadowsEnabled !== false
      world.renderer.three.shadowMap.enabled = shadowsOn
      world.renderer.three.shadowMap.type = params.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
      world.renderer.three.shadowMap.autoUpdate = true
      rDir.castShadow = shadowsOn
      if (rDir.shadow.mapSize.width !== params.shadowMapSize) {
        rDir.shadow.mapSize.setScalar(params.shadowMapSize)
        // The map is allocated at the old size, so it has to go before the new one takes
        rDir.shadow.map?.dispose()
        rDir.shadow.map = null as any
      }
      world.renderer.three.toneMapping = TONE_MAPPINGS[params.toneMapping] ?? THREE.ACESFilmicToneMapping
      world.renderer.three.toneMappingExposure = params.exposure
      
      if (params.iblEnabled !== false) {
        world.scene.three.environment = envTexture
        if (params.envIntensity !== undefined) world.scene.three.environmentIntensity = params.envIntensity
        if (params.syncIblWithSun) {
          world.scene.three.environmentRotation.y = azimuthRad
        } else if (params.envRotation !== undefined) {
          world.scene.three.environmentRotation.y = params.envRotation
        }
      } else {
        world.scene.three.environment = null
      }
      
      // Dynamic Shadow Camera Scaling
      // We restrict the shadow camera coverage area to keep shadows crisp near the camera
      // while still accommodating the maximum radius of the scene for the depth planes.
      const SHADOW_COVERAGE = Math.min(maxRadius, 1500)
      rDir.shadow.camera.left = -SHADOW_COVERAGE
      rDir.shadow.camera.right = SHADOW_COVERAGE
      rDir.shadow.camera.top = SHADOW_COVERAGE
      rDir.shadow.camera.bottom = -SHADOW_COVERAGE
      rDir.shadow.camera.near = 1
      // Far plane must extend past the target by at least the radius of the scene
      rDir.shadow.camera.far = sunDistance + (maxRadius * 2)
      // Dynamically scale shadow bias to prevent acne on large scenes
      rDir.shadow.bias = -0.0005 * Math.max(1.0, maxRadius / 10000)
      rDir.shadow.camera.updateProjectionMatrix()
      
      // Add Atmospheric Fog (matches the hazy horizon)
      if (params.fogEnabled === false) {
        world.scene.three.fog = null
      } else {
        fog.color.set(params.fogColor)
        fog.density = params.fogDensity
        world.scene.three.fog = fog
      }

      if (bloomPass) {
        bloomPass.enabled = params.bloomEnabled !== false
        bloomPass.strength = params.bloomStrength
        bloomPass.radius = params.bloomRadius
        bloomPass.threshold = params.bloomThreshold
      }
      
      realisticGroup.visible = true
      if (liteDirLight.parent) liteDirLight.removeFromParent()
      rDir.intensity = params.lightIntensity
      rAmbient.intensity = params.ambientIntensity
      if (rDir.target.parent !== world.scene.three) {
        world.scene.three.add(rDir.target)
      }

      world.scene.three.traverse((child: any) => {
        if ((child.isDirectionalLight || child.isAmbientLight) && child.parent !== realisticGroup) {
          child.visible = false
        }
      })

      if (ssaoPass) {
        ssaoPass.enabled = params.realisticMode && params.ambientOcclusion !== false
        renderPass.enabled = !ssaoPass.enabled
        if (params.aoRadius !== undefined) ssaoPass.configuration.aoRadius = params.aoRadius
        if (params.aoIntensity !== undefined) ssaoPass.configuration.intensity = params.aoIntensity
      }

    } else if (params.renderLite) {
      // ── Render Lite ──────────────────────────────────────────────────────
      // Clean BIM quality: shadows + tone mapping + AO + edges + gradient bg.
      // PCFShadowMap is the standard in Three.js 169+ (PCFSoftShadowMap is deprecated).
      // We achieve softness by adjusting the shadow.radius on the light itself.
      const newShadowType = THREE.PCFShadowMap
      const shadowTypeChanged = world.renderer.three.shadowMap.type !== newShadowType
      if (shadowTypeChanged) {
        world.renderer.three.shadowMap.enabled = false
        world.renderer.three.shadowMap.type = newShadowType
        world.renderer.three.shadowMap.enabled = params.shadowsEnabled !== false
        world.renderer.three.shadowMap.needsUpdate = true
      } else {
        world.renderer.three.shadowMap.enabled = params.shadowsEnabled !== false
        if (params.shadowsEnabled !== false) world.renderer.three.shadowMap.needsUpdate = true
      }
      world.renderer.three.toneMapping = THREE.NoToneMapping
      world.renderer.three.toneMappingExposure = 1.0
      world.scene.three.environment = null
      world.scene.three.fog = null

      if (params.gradientSkyEnabled === false) {
        world.scene.three.background = null
      }

      sky.visible = false
      cloudsDome.visible = false
      if (bloomPass) bloomPass.enabled = false
      if (godRayPass) godRayPass.enabled = false
      if (ssrPass) ssrPass.enabled = false
      if (bokehPass) bokehPass.enabled = false
      if (colorGradePass) colorGradePass.enabled = false
      if (cloudShadowPass) cloudShadowPass.enabled = false

      if (ssaoPass) {
        const aoOn = params.ambientOcclusion !== false
        savedAoEnabled = aoOn
        ssaoPass.enabled = !cameraMoving && aoOn
        renderPass.enabled = !ssaoPass.enabled
        ssaoPass.configuration.aoRadius = 50.0
        ssaoPass.configuration.intensity = 1.0
      }

      // Edge outlines
      if (edgePass) {
        const edgeOn = params.outlineEdges !== false
        savedEdgeEnabled = edgeOn
        edgePass.enabled = !cameraMoving && edgeOn
      }

      realisticGroup.visible = false

      if (liteDirLight.parent !== world.scene.three) {
        world.scene.three.add(liteDirLight)
      }
      liteDirLight.visible = true
      liteDirLight.castShadow = params.shadowsEnabled !== false

      if (liteDirLight.castShadow) {
        // Use PCFShadowMap unconditionally, adjust radius for softness
        const newShadowType = THREE.PCFShadowMap
        if (world.renderer.three.shadowMap.type !== newShadowType) {
          world.renderer.three.shadowMap.enabled = false
          world.renderer.three.shadowMap.type = newShadowType
        }
        
        const maxRadius = computeMaxRadius()

        // Dynamically scale the shadow camera to cover the scene
        const SHADOW_COVERAGE = Math.min(maxRadius, 1500)
        liteDirLight.shadow.camera.left = -SHADOW_COVERAGE
        liteDirLight.shadow.camera.right = SHADOW_COVERAGE
        liteDirLight.shadow.camera.top = SHADOW_COVERAGE
        liteDirLight.shadow.camera.bottom = -SHADOW_COVERAGE
        liteDirLight.shadow.camera.near = 1
        liteDirLight.shadow.camera.far = 1000 + (maxRadius * 2)
        liteDirLight.shadow.bias = -0.0005 * Math.max(1.0, maxRadius / 10000)
        liteDirLight.shadow.radius = params.softShadows ? 4 : 1
        liteDirLight.shadow.camera.updateProjectionMatrix()
        
        world.renderer.three.shadowMap.enabled = true
        world.renderer.three.shadowMap.needsUpdate = true
        // Ensure all loaded meshes cast and receive shadows
        world.scene.three.traverse((child: any) => {
          if (child.isMesh && child.name !== 'ShadowCatcherPlane') {
            child.castShadow = true
            child.receiveShadow = true
          }
        })
      } else {
        world.renderer.three.shadowMap.enabled = false
      }

      world.scene.three.traverse((child: any) => {
        if ((child.isAmbientLight || child.isHemisphereLight) && child.parent !== realisticGroup) {
          child.visible = true
        }
      })
    } else {
      if (liteDirLight.parent) liteDirLight.removeFromParent()
      world.renderer.three.shadowMap.enabled = false
      world.renderer.three.toneMapping = THREE.NoToneMapping
      world.renderer.three.toneMappingExposure = 1.0
      world.scene.three.environment = null
      world.scene.three.fog = null
      
      if (bloomPass) bloomPass.enabled = false
      if (godRayPass) godRayPass.enabled = false
      if (edgePass) edgePass.enabled = false
      
      realisticGroup.visible = false

      world.scene.three.traverse((child: any) => {
        if ((child.isDirectionalLight || child.isAmbientLight) && child.parent !== realisticGroup) {
          child.visible = true
        }
      })
    }

    world.scene.three.traverse((child: any) => {
      if (child.isMesh && child.material) {
        child.material.needsUpdate = true
      }
    })
  }

  setLightingParams(RENDER_DEFAULTS)

  world.camera = new OBC.SimpleCamera(components)

  if (world.camera.three instanceof THREE.PerspectiveCamera || world.camera.three instanceof THREE.OrthographicCamera) {
    world.camera.three.near = 0.1
    world.camera.three.far = 200000
    world.camera.three.updateProjectionMatrix()
  }

  if (world.camera.controls) {
    world.camera.controls.maxDistance = Infinity
    world.camera.controls.minDistance = 2
    world.camera.controls.dollySpeed = 2
    world.camera.controls.truckSpeed = 2
    world.camera.controls.infinityDolly = true
  }

  world.camera.controls.setLookAt(50, 30, 50, 0, 0, 0)

  // Postprocessing (SMAA)
  const composer = new EffectComposer(world.renderer.three)
  
  composer.renderTarget1.depthTexture = new THREE.DepthTexture(window.innerWidth, window.innerHeight)
  composer.renderTarget1.depthBuffer = true
  composer.renderTarget2.depthTexture = new THREE.DepthTexture(window.innerWidth, window.innerHeight)
  composer.renderTarget2.depthBuffer = true
  
  renderPass = new RenderPass(world.scene.three, world.camera.three)
  composer.addPass(renderPass)

  // Ambient Occlusion (N8AO)
  ssaoPass = new N8AOPass(world.scene.three, world.camera.three, window.innerWidth, window.innerHeight)
  ssaoPass.configuration.aoRadius = 16.0        // Tight — just at corners/crevices (in pixels since screenSpaceRadius is true)
  ssaoPass.configuration.intensity = 0.5         // Very subtle
  ssaoPass.configuration.aoSamples = 16          // Lower samples = better FPS
  ssaoPass.configuration.denoiseSamples = 4
  ssaoPass.configuration.denoiseRadius = 8
  ssaoPass.configuration.distanceFalloff = 1.0
  ssaoPass.configuration.screenSpaceRadius = true // Radius in screen pixels
  ssaoPass.configuration.halfRes = false // Disabled halfRes to fix ANGLE washout bug on Windows
  if (ssaoPass.configuration.gammaCorrection !== undefined) ssaoPass.configuration.gammaCorrection = false
  ssaoPass.enabled = false
  renderPass.enabled = !ssaoPass.enabled
  composer.addPass(ssaoPass)

  // Bloom Pass
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.15,  // strength
    0.4,   // radius
    1.5    // threshold
  )
  bloomPass.enabled = false
  composer.addPass(bloomPass)

  // Cloud Shadow Post-Processing Pass
  cloudShadowPass = new ShaderPass(CloudShadowShader)
  cloudShadowPass.enabled = false
  composer.addPass(cloudShadowPass)

  ssrPass = new SSRPass({
    renderer: world.renderer.three,
    scene: world.scene.three,
    camera: world.camera.three,
    width: window.innerWidth,
    height: window.innerHeight,
    groundReflector: null,
    selects: null
  })
  ssrPass.enabled = false
  ssrPass.maxDistance = 10000
  ssrPass.opacity = 0.8
  ssrPass.thickness = 100
  composer.addPass(ssrPass)

  // God Rays
  godRayPass = new ShaderPass(GodRayShader)
  godRayPass.enabled = false

  // Unified Scene Depth RT for post-processing
  const sceneDepthW = window.innerWidth
  const sceneDepthH = window.innerHeight
  sceneDepthRT = new THREE.WebGLRenderTarget(sceneDepthW, sceneDepthH)
  sceneDepthRT.depthBuffer = true
  sceneDepthRT.depthTexture = new THREE.DepthTexture(sceneDepthW, sceneDepthH)
  sceneDepthRT.depthTexture.format = THREE.DepthFormat
  sceneDepthRT.depthTexture.type = THREE.UnsignedIntType // Upgraded to 32-bit to fix grazing angle pixelation
  
  godRayPass.uniforms.tDepth.value = sceneDepthRT.depthTexture
  composer.addPass(godRayPass)

  colorGradePass = new ShaderPass(ColorGradeShader)
  colorGradePass.enabled = false
  composer.addPass(colorGradePass)

  // Custom Edge Outline Pass
  edgePass = new ShaderPass(CustomEdgeShader)
  edgePass.enabled = false
  edgePass.uniforms.tDepth.value = sceneDepthRT.depthTexture
  edgePass.uniforms.resolution.value.set(window.innerWidth * window.devicePixelRatio, window.innerHeight * window.devicePixelRatio)
  composer.addPass(edgePass)

  // SMAA Pass
  smaaPass = new SMAAPass()
  smaaPass.setSize(window.innerWidth * window.devicePixelRatio, window.innerHeight * window.devicePixelRatio)
  composer.addPass(smaaPass)

  const outputPass = new OutputPass()
  composer.addPass(outputPass)
  
  bokehPass = new BokehPass(world.scene.three, world.camera.three, {
    focus: 2000.0,
    aperture: 0.0001,
    maxblur: 0.01
  })
  bokehPass.enabled = false
  composer.addPass(bokehPass)

  // Which passes are live is the first thing to check when a frame comes out wrong,
  // and the composer is a closure otherwise. Never attached in a production build.
  if (import.meta.env.DEV) {
    ;(world as any).__passes = () => (templateComposer ?? composer).passes
  }

  const clock = new THREE.Clock()
  const depthMaterial = new THREE.MeshDepthMaterial()
  const defaultUpdate = world.renderer.update.bind(world.renderer)
  world.renderer.update = () => {
    const delta = clock.getDelta()

    // A template renders through its own chain and touches none of the studio's
    if (activeTemplate && templateComposer) {
      if (!world.renderer.enabled || !world.renderer.currentWorld) return

      const scene = world.scene.three
      const camera = world.camera.three
      // The camera object is swapped when the projection changes, and the passes
      // each hold their own reference to it
      if (templateRenderPass) {
        templateRenderPass.scene = scene
        templateRenderPass.camera = camera
      }
      if (templateAoPass) templateAoPass.camera = camera
      templateInkPass?.view(scene, camera)

      if (tSun.userData.sunOffset && world.camera.controls) {
        const target = new THREE.Vector3()
        world.camera.controls.getTarget(target)
        tSun.target.position.copy(target)
        tSun.position.copy(target).add(tSun.userData.sunOffset)
      }

      world.renderer.needsUpdate = false
      world.renderer.onBeforeUpdate.trigger(world.renderer)
      templateComposer.render()
      world.renderer.onAfterUpdate.trigger(world.renderer)
      return
    }

    if (isRealistic || isRenderLite) {
      if (!world.renderer.enabled || !world.renderer.currentWorld) return

      cloudMat.uniforms.time.value += delta * currentCloudSpeed

      if (cloudShadowPass && cloudShadowPass.enabled) {
        cloudShadowPass.uniforms.tDepth.value = sceneDepthRT.depthTexture
        cloudShadowPass.uniforms.time.value = cloudMat.uniforms.time.value
        cloudShadowPass.uniforms.sunPosition.value = cloudMat.uniforms.sunPosition.value
        cloudShadowPass.uniforms.cameraNear.value = world.camera.three.near
        cloudShadowPass.uniforms.cameraFar.value = world.camera.three.far
        cloudShadowPass.uniforms.projectionMatrixInverse.value.copy(world.camera.three.projectionMatrixInverse)
        cloudShadowPass.uniforms.viewMatrixInverse.value.copy(world.camera.three.matrixWorld)
      }
      
      if (godRayPass && godRayPass.enabled && rDir.userData.sunOffset) {
        const sunWorld = new THREE.Vector3().copy(rDir.userData.sunOffset).normalize().multiplyScalar(1000)
        const sunClip  = sunWorld.clone().project(world.camera.three)
        godRayPass.uniforms.sunPositionScreen.value.set(
          (sunClip.x + 1) * 0.5,
          (sunClip.y + 1) * 0.5
        )
        const sunDir = new THREE.Vector3().copy(rDir.userData.sunOffset).normalize()
        godRayPass.uniforms.sunElevation.value = sunDir.y
      }
      
      if (edgePass && edgePass.enabled) {
         edgePass.uniforms.cameraNear.value = world.camera.three.near
         edgePass.uniforms.cameraFar.value = world.camera.three.far
      }
      
      // Auto-focus
      if (autoFocusEnabled && bokehPass && bokehPass.enabled && world.camera.controls) {
        const focusTarget = new THREE.Vector3()
        world.camera.controls.getTarget(focusTarget)
        const dist = world.camera.three.position.distanceTo(focusTarget)
        bokehPass.uniforms['focus'].value = THREE.MathUtils.lerp(
          bokehPass.uniforms['focus'].value as number,
          dist,
          Math.min(delta * 3.0, 1.0)
        )
      }
      
      const activeDirLight = isRenderLite ? liteDirLight : rDir
      if (activeDirLight.userData.sunOffset && world.camera.controls) {
        const target = new THREE.Vector3()
        world.camera.controls.getTarget(target)
        activeDirLight.target.position.copy(target)
        activeDirLight.position.copy(target).add(activeDirLight.userData.sunOffset)
        activeDirLight.shadow.camera.updateProjectionMatrix()
      }
      
      const needsDepth = (godRayPass && godRayPass.enabled) || (edgePass && edgePass.enabled) || (cloudShadowPass && cloudShadowPass.enabled)
      if (needsDepth) {
        const skyVisible = sky.visible
        const cloudsVisible = cloudsDome.visible
        sky.visible = false
        cloudsDome.visible = false

        // Hide transparent/invisible proxy meshes (like collision boxes) so they don't get outlined or receive shadows
        const hiddenMeshes: THREE.Mesh[] = []
        world.scene.three.traverse((child: any) => {
          if (child.isMesh && child.visible && child.material) {
            let isInvisible = false
            if (child.name === 'ShadowCatcherPlane') {
              isInvisible = true
            } else {
              const checkMat = (m: any) => {
                if (m.transparent && m.opacity < 0.05) return true
                if (m.colorWrite === false) return true
                return false
              }
              if (Array.isArray(child.material)) {
                isInvisible = child.material.length > 0 && child.material.every(checkMat)
              } else {
                isInvisible = checkMat(child.material)
              }
            }
            if (isInvisible) {
              child.visible = false
              hiddenMeshes.push(child)
            }
          }
        })

        // The depth material ignores lighting, so the shadow map cannot affect this pass
        const shadowAutoUpdate = world.renderer.three.shadowMap.autoUpdate
        world.renderer.three.shadowMap.autoUpdate = false
        world.scene.three.overrideMaterial = depthMaterial
        world.renderer.three.setRenderTarget(sceneDepthRT)
        world.renderer.three.clear()
        world.renderer.three.render(world.scene.three, world.camera.three)
        world.renderer.three.setRenderTarget(null)
        world.scene.three.overrideMaterial = null
        world.renderer.three.shadowMap.autoUpdate = shadowAutoUpdate

        sky.visible = skyVisible
        cloudsDome.visible = cloudsVisible
        hiddenMeshes.forEach(m => { m.visible = true })
      }

      world.renderer.needsUpdate = false
      world.renderer.onBeforeUpdate.trigger(world.renderer)
      composer.render()
      world.renderer.onAfterUpdate.trigger(world.renderer)
    } else {
      defaultUpdate()
    }
  }

  world.renderer.onResize.add((size: THREE.Vector2) => {
    if (world.camera.three instanceof THREE.PerspectiveCamera) {
      world.camera.three.aspect = size.x / size.y
      world.camera.three.updateProjectionMatrix()
    }
    composer.setSize(size.x, size.y)
    templateComposer?.setSize(size.x, size.y)
    smaaPass.setSize(size.x * window.devicePixelRatio, size.y * window.devicePixelRatio)
    if (ssaoPass && typeof ssaoPass.setSize === 'function') ssaoPass.setSize(size.x, size.y)
    if (bloomPass) bloomPass.setSize(size.x, size.y)
    if (edgePass) edgePass.uniforms.resolution.value.set(size.x * window.devicePixelRatio, size.y * window.devicePixelRatio)
    if (sceneDepthRT) sceneDepthRT.setSize(size.x, size.y)
  })

  components.init()


  const grids = components.get(OBC.Grids)
  grid = grids.create(world)
  grid.visible = RENDER_DEFAULTS.gridVisible

  //shadow plane  
  const shadowPlaneGeo = new THREE.PlaneGeometry(10000, 10000)
  const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.3, depthWrite: false })
  const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat)
  shadowPlane.name = 'ShadowCatcherPlane'
  shadowPlane.rotation.x = -Math.PI / 2
  shadowPlane.position.y = -0.01 // Slightly below 0 to avoid z-fighting with floors
  shadowPlane.receiveShadow = true
  world.scene.three.add(shadowPlane)

  const fragments = new FRAGS.FragmentsModels()

  world.camera.controls.addEventListener('update', () => fragments.update())

  // Progressive Rendering
  world.camera.controls.addEventListener('controlstart', () => {
    if (!progressiveRenderingEnabled) return
    cameraMoving = true
    if (progressiveRestoreTimer) { clearTimeout(progressiveRestoreTimer); progressiveRestoreTimer = null }
    // A template's occlusion and drawn lines are part of its picture, not a
    // sharpening step laid over it, and they live on a chain of their own. Only
    // the studio's passes are paused for the drag.
    if (!activeTemplate) {
      if (ssaoPass && ssaoPass.enabled) { savedAoEnabled = true; ssaoPass.enabled = false; renderPass.enabled = true }
      if (edgePass && edgePass.enabled) { savedEdgeEnabled = true; edgePass.enabled = false }
    }
    world.renderer.three.shadowMap.autoUpdate = false
  })

  world.camera.controls.addEventListener('controlend', () => {
    cameraMoving = false
    if (!progressiveRenderingEnabled) return
    if (progressiveRestoreTimer) clearTimeout(progressiveRestoreTimer)
    progressiveRestoreTimer = setTimeout(() => {
      if (savedAoEnabled && ssaoPass) { ssaoPass.enabled = true; renderPass.enabled = false }
      if (savedEdgeEnabled && edgePass) { edgePass.enabled = true }
      world.renderer.three.shadowMap.autoUpdate = true
      world.renderer.three.shadowMap.needsUpdate = true
      progressiveRestoreTimer = null
    }, 150)
  })

  fragments.models.materials.list.onItemSet.add(({ value: material }: any) => {
    if (!('isLodMaterial' in material && material.isLodMaterial)) {
      material.polygonOffset = true
      material.polygonOffsetUnits = 1
      material.polygonOffsetFactor = Math.random()
    }
    // Materials are made as tiles arrive, so the template has to be put on each
    // one as it appears, not only when the template changes
    if (activeTemplate) {
      dressMaterial(material, activeTemplate.surfaces, templateEnv, templateBase)
    }
  })
  
  fragments.models.list.onItemSet.add(async ({ value: model }: any) => {
    model.traverse?.((child: any) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    // A model arriving under a template has to be pinned to full geometry like the
    // ones already in, and stripped of the items a template does not draw
    if (activeTemplate) {
      setTemplateStreaming(true)
      void hideNonPhysical(model.modelId)
    }
    
    // Async compute PBR mapping
    model.userData = model.userData || {};
    model.userData.pbrMaterialMap = new Map<string, any>();
    
    if (typeof model.getCategories === 'function' && typeof model.getItemsByQuery === 'function') {
      setTimeout(async () => {
        try {
          const categories = await model.getCategories();
          for (const mapping of PBR_MATERIAL_MAPPINGS) {
            const matchingCats = categories.filter((c: string) => c.match(mapping.category));
            if (matchingCats.length > 0) {
              const regexCats = matchingCats.map((c: string) => new RegExp(`^${c}$`));
              const items = await model.getItemsByQuery({ categories: regexCats });
              if (items && items.length > 0 && typeof model.getFragmentMap === 'function') {
                const fragMap = model.getFragmentMap(items);
                for (const fragId in fragMap) {
                   if (!model.userData.pbrMaterialMap.has(fragId)) {
                     model.userData.pbrMaterialMap.set(fragId, mapping);
                   }
                }
              }
            }
          }
          
          if (isRealistic) {
             model.traverse?.((child: any) => {
                if (child.isMesh && child.material) {
                    const map = model.userData.pbrMaterialMap;
                    let mapping: any = null;
                    if (map.has(child.uuid)) mapping = map.get(child.uuid);
                    else if (map.has(child.id?.toString())) mapping = map.get(child.id?.toString());
                    
                    const convert = (mat: any) => {
                       if (!isPbrEnabled) {
                          if (mat.userData.isUpgraded && mat.userData.originalMaterial) return mat.userData.originalMaterial;
                          return mat;
                       }
                       
                       if ((mat.isMeshLambertMaterial || mat.isMeshBasicMaterial || mat.isMeshPhongMaterial) && !mat.userData.isUpgraded) {
                          let newMat;
                          if (mapping) {
                            if (mapping.isPhysical) {
                              newMat = new THREE.MeshPhysicalMaterial({
                                color: mapping.color,
                                roughness: mapping.roughness,
                                metalness: mapping.metalness,
                                transmission: mapping.transmission || 0,
                                transparent: mapping.transparent || false,
                                opacity: mapping.opacity !== undefined ? mapping.opacity : 1.0,
                                side: mat.side,
                                map: mat.map || null
                              });
                            } else {
                              newMat = new THREE.MeshStandardMaterial({
                                color: mapping.color,
                                roughness: mapping.roughness,
                                metalness: mapping.metalness,
                                side: mat.side,
                                transparent: mat.transparent || (mapping.opacity !== undefined && mapping.opacity < 1.0),
                                opacity: mapping.opacity !== undefined ? mapping.opacity : (mat.opacity || 1.0),
                                map: mat.map || null
                              });
                            }
                          } else {
                            newMat = new THREE.MeshStandardMaterial({
                              color: mat.color,
                              roughness: 0.8,
                              metalness: 0.1,
                              side: mat.side,
                              transparent: mat.transparent,
                              opacity: mat.opacity,
                              map: mat.map || null
                            });
                          }
                          newMat.userData.isUpgraded = true;
                          newMat.userData.originalMaterial = mat;
                          return newMat;
                       }
                       return mat;
                    };
                    if (Array.isArray(child.material)) child.material = child.material.map(convert);
                    else child.material = convert(child.material);
                }
             });
          }
        } catch (err: any) {
          if (!err.message?.includes('Model not found')) {
            console.warn('Could not compute PBR map for model', err);
          }
        }
      }, 2000) // 2s delay allows worker to fully initialize the model first
    }
  })

  const dispose = async () => {
    const ids = [...fragments.models.list.values()].map((m: any) => m.modelId)
    await Promise.all(ids.map((id: string) => fragments.disposeModel(id)))
    depthMaterial.dispose()
    templateSky?.dispose()
    templateEnv?.dispose()
    disposeTemplateComposer()
    components.dispose()
  }

  return { fragments, world, components, dispose, setLightingParams }
}
