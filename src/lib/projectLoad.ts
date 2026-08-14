import { loadModelsFromProject } from '@/lib/projectDb'
import { unloadAllModels } from '@/lib/sceneTeardown'
import { useModelStore } from '@/store/useModelStore'
import { useLoadingProgressStore } from '@/store/useLoadingProgressStore'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import type { ProjectMeta } from '@/types'

/** Narrow a project to one location's models, keeping the project's own model order so
 *  the anchor model is the same every time this location is opened. */
export function metaForModelIds(meta: ProjectMeta, modelIds: string[] | undefined): ProjectMeta {
  if (!modelIds?.length) return { ...meta, models: [] }
  const wanted = new Set(modelIds)
  return { ...meta, models: meta.models.filter(m => wanted.has(m.modelId)) }
}

/** Read every model in `meta` off disk, adding each to the store the moment its bytes land */
export async function streamProjectModels(
  handle: FileSystemDirectoryHandle,
  meta: ProjectMeta
): Promise<void> {
  const { beginSession, updateEntry } = useLoadingProgressStore.getState()
  const addModel = useModelStore.getState().addModel

  beginSession(meta.models.map(m => ({
    modelId: m.modelId,
    name: m.originalFileName,
    sizeBytes: m.convertedFileSizeBytes || m.originalFileSizeBytes || 0,
  })), 'disk')

  await loadModelsFromProject(handle, meta, (pm, readMs) => {
    updateEntry(pm.modelId, { phase: 'pending', readMs, bytesRead: pm.fragBytes.byteLength, sizeBytes: pm.fragBytes.byteLength })
    addModel({
      modelId: pm.modelId,
      originalFileName: pm.originalFileName,
      originalFileSizeBytes: pm.originalFileSizeBytes,
      convertedFileSizeBytes: pm.convertedFileSizeBytes,
      conversionTimeMs: pm.conversionTimeMs,
      fragBytes: pm.fragBytes,
      type: pm.type,
      position: pm.position,
      rotation: pm.rotation,
      scale: pm.scale,
    })
  }, (modelId, bytesRead, totalBytes) => {
    updateEntry(modelId, { phase: 'reading', bytesRead, sizeBytes: totalBytes })
  }, (modelId) => {
    updateEntry(modelId, { phase: 'error', error: 'model file not found on disk' })
  })
}

/** Close whatever is open and load only this set. Ending the progress session first stops
 *  the previous session's delayed teardown from closing the new one. */
export async function loadModelSet(
  engine: FragmentsEngine | null,
  handle: FileSystemDirectoryHandle,
  meta: ProjectMeta,
  modelIds: string[] | undefined
): Promise<void> {
  useLoadingProgressStore.getState().endSession()
  await unloadAllModels(engine)
  useModelStore.getState().clearModels()
  useModelStore.getState().setActiveModelId(null)
  await streamProjectModels(handle, metaForModelIds(meta, modelIds))
}
