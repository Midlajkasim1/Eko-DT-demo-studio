import type { FragmentsEngine } from '@/lib/fragmentsEngine'

function disposeObject(root: any) {
  root.traverse?.((o: any) => {
    o.geometry?.dispose?.()
    const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const material of materials) {
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) {
        material[slot]?.dispose?.()
      }
      material.dispose?.()
    }
  })
}

/** Empty the scene of every loaded model and reset the state that outlives them.
 *
 *  Disposal is awaited: FragmentsModels anchors `baseCoordinates` on the first model to
 *  parse and only clears it once its list empties, so a model still being disposed when
 *  the next set starts parsing would offset that set by the previous origin.
 */
export async function unloadAllModels(engine: FragmentsEngine | null) {
  if (!engine) return
  const scene = engine.world.scene.three

  const fragmentIds = new Set(engine.fragments.models.list.keys())
  await Promise.all([...fragmentIds].map(id => engine.fragments.disposeModel(id).catch(() => {})))

  for (const child of [...scene.children]) {
    const modelId = child.userData?.modelId
    if (!modelId) continue
    scene.remove(child)
    // Fragment models tag their object the same way, but the engine already owns and
    // disposed those — freeing them again corrupts its next load
    if (!fragmentIds.has(modelId)) disposeObject(child)
  }

  engine.fragments.baseCoordinates = null
  scene.userData.maxRadius = undefined
  scene.userData.cachedModelCount = undefined
}
