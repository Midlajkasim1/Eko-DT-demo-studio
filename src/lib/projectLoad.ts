import { loadModelsFromProject } from '@/lib/projectDb'
import { unloadAllModels } from '@/lib/sceneTeardown'
import { useModelStore } from '@/store/useModelStore'
import { useLoadingProgressStore } from '@/store/useLoadingProgressStore'
import type { FragmentsEngine } from '@/lib/fragmentsEngine'
import type { LoadedModel, ProjectMeta } from '@/types'

// Bounds both the concurrent downloads and the model buffers held in memory
const MODEL_FETCH_CONCURRENCY = 2

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

async function readBodyWithProgress(
  res: Response,
  onBytes: (bytesRead: number, totalBytes: number) => void
): Promise<ArrayBuffer> {
  if (!res.body) return res.arrayBuffer()
  const declaredLength = Number(res.headers.get('content-length'))
  // A bogus header must not become a bogus allocation
  const total = Number.isSafeInteger(declaredLength) && declaredLength > 0 ? declaredLength : 0
  const reader = res.body.getReader()
  // Anything content-length did not account for spills into chunks
  const declared = total > 0 ? new Uint8Array(total) : null
  const spill: Uint8Array[] = []
  let filled = 0
  let read = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (declared && spill.length === 0 && filled + value.length <= total) {
      declared.set(value, filled)
      filled += value.length
    } else {
      spill.push(value)
    }
    read += value.length
    onBytes(read, total)
  }

  if (declared && spill.length === 0) {
    return read === total ? declared.buffer : declared.buffer.slice(0, read)
  }

  const out = new Uint8Array(read)
  if (declared) out.set(declared.subarray(0, filled))
  let offset = filled
  for (const c of spill) {
    out.set(c, offset)
    offset += c.length
  }
  return out.buffer
}

/** Same stream as the disk path, over HTTP — used by the exported viewer (no folder handle). */
export async function streamHttpModels(
  meta: ProjectMeta,
  options?: { isCancelled?: () => boolean }
): Promise<void> {
  const { beginSession, updateEntry } = useLoadingProgressStore.getState()
  const addModel = useModelStore.getState().addModel
  const queued = meta.models.filter(m => m.fragFile)
  const isCancelled = options?.isCancelled ?? (() => false)

  beginSession(queued.map(m => ({
    modelId: m.modelId,
    name: m.originalFileName,
    sizeBytes: m.convertedFileSizeBytes || m.originalFileSizeBytes || 0,
  })), 'server')

  const fetchModel = async (m: (typeof queued)[number]): Promise<LoadedModel | null> => {
    try {
      const readStart = performance.now()
      updateEntry(m.modelId, { phase: 'reading' })
      // Cacheable on purpose — model bytes never change for a given
      // modelId, so revisits revalidate via ETag instead of re-downloading
      const modelRes = await fetch(m.fragFile)
      if (!modelRes.ok) {
        console.warn(`Failed to fetch model ${m.fragFile}: ${modelRes.status}`)
        updateEntry(m.modelId, { phase: 'error', error: `HTTP ${modelRes.status}` })
        return null
      }
      const buffer = await readBodyWithProgress(modelRes, (bytesRead, totalBytes) => {
        updateEntry(m.modelId, totalBytes ? { bytesRead, sizeBytes: totalBytes } : { bytesRead })
      })
      updateEntry(m.modelId, {
        phase: 'pending',
        readMs: performance.now() - readStart,
        bytesRead: buffer.byteLength,
        sizeBytes: buffer.byteLength,
      })
      return {
        modelId: m.modelId,
        originalFileName: m.originalFileName,
        originalFileSizeBytes: m.originalFileSizeBytes,
        convertedFileSizeBytes: buffer.byteLength,
        conversionTimeMs: m.conversionTimeMs,
        fragBytes: buffer,
        type: m.type,
        position: m.position,
        rotation: m.rotation,
        scale: m.scale,
      }
    } catch (modelErr: any) {
      console.warn(`Could not load model ${m.fragFile}:`, modelErr)
      updateEntry(m.modelId, { phase: 'error', error: modelErr?.message ?? 'fetch failed' })
      return null
    }
  }

  for (let i = 0; i < queued.length; i += MODEL_FETCH_CONCURRENCY) {
    if (isCancelled()) return
    const group = await Promise.all(
      queued.slice(i, i + MODEL_FETCH_CONCURRENCY).map(fetchModel)
    )
    if (isCancelled()) return
    for (const model of group) {
      if (model) addModel(model)
    }
  }
}

/** Close whatever is open and load only this set, fetching each model over HTTP. */
export async function loadHttpModelSet(
  engine: FragmentsEngine | null,
  meta: ProjectMeta,
  modelIds: string[] | undefined
): Promise<void> {
  useLoadingProgressStore.getState().endSession()
  await unloadAllModels(engine)
  useModelStore.getState().clearModels()
  useModelStore.getState().setActiveModelId(null)
  await streamHttpModels(metaForModelIds(meta, modelIds))
}
