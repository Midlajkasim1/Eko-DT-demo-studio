import * as THREE from 'three'
import { useModelStore } from '@/store/useModelStore'
import { useProjectStore } from '@/store/useProjectStore'
import { useAppStore } from '@/store/useAppStore'
import { useMapStore } from '@/store/useMapStore'
import { unloadAllModels } from '@/lib/sceneTeardown'
import { useLoadingProgressStore } from '@/store/useLoadingProgressStore'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'

/** Dev-only handle for driving the scene from an automated browser. Never attached in a
 *  production build, so it cannot become a supported surface by accident. */
export function attachDevBridge(engineRef: React.MutableRefObject<FragmentsEngine | null>) {
  if (!import.meta.env.DEV) return

  const box = new THREE.Box3()
  const center = new THREE.Vector3()

  ;(window as any).__twin = {
    get engine() { return engineRef.current },
    stores: { model: useModelStore, project: useProjectStore, app: useAppStore, map: useMapStore },

    loadedModelIds() {
      const engine = engineRef.current
      return engine ? [...engine.fragments.models.list.keys()] : []
    },

    sceneModelIds() {
      const engine = engineRef.current
      if (!engine) return []
      return engine.world.scene.three.children
        .filter((c: any) => c.userData?.modelId)
        .map((c: any) => c.userData.modelId)
    },

    baseCoordinates() {
      return engineRef.current?.fragments.baseCoordinates ?? null
    },

    /** World-space centre of one model, rounded to millimetres */
    modelCenter(modelId: string) {
      const engine = engineRef.current
      if (!engine) return null
      const model: any = engine.fragments.models.list.get(modelId)
      const object = model?.object ?? engine.world.scene.three.children
        .find((c: any) => c.userData?.modelId === modelId)
      if (!object) return null
      box.setFromObject(object)
      if (box.isEmpty()) return null
      box.getCenter(center)
      return [center.x, center.y, center.z].map(v => Math.round(v * 1000) / 1000)
    },

    /** Open a project on the map without a directory handle, so map assets resolve over HTTP */
    openMap(meta: unknown) {
      useProjectStore.setState({ currentProject: meta as never, folderHandle: null })
      useAppStore.getState().setStep('map')
    },

    async unloadAll() {
      useLoadingProgressStore.getState().endSession()
      await unloadAllModels(engineRef.current)
      useModelStore.getState().clearModels()
      await settle()
    },

    /** The same sequence loadModelSet runs, over HTTP so a browser test can drive it */
    async loadSet(entries: { modelId: string; fragFile: string; type?: 'frag' | 'glb' }[]) {
      useLoadingProgressStore.getState().endSession()
      await unloadAllModels(engineRef.current)
      useModelStore.getState().clearModels()
      useModelStore.getState().setActiveModelId(null)
      await settle()

      for (const entry of entries) {
        const fragBytes = await (await fetch(entry.fragFile)).arrayBuffer()
        useModelStore.getState().addModel({
          modelId: entry.modelId,
          originalFileName: entry.modelId,
          originalFileSizeBytes: fragBytes.byteLength,
          convertedFileSizeBytes: fragBytes.byteLength,
          conversionTimeMs: 0,
          fragBytes,
          type: entry.type ?? 'frag',
        })
      }

      const wanted = entries.length
      for (let i = 0; i < 900; i++) {
        const engine = engineRef.current
        if (engine && engine.fragments.models.list.size === wanted) break
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      await new Promise(resolve => setTimeout(resolve, 600))
    },
  }
}

/** Let the store effect observe the empty list and reset its own load bookkeeping */
function settle() {
  return new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)))
  )
}
