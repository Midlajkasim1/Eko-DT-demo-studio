import { create } from 'zustand'
import type { ProjectMeta, ProjectModelEntry, LoadedModel, RecentProjectCard } from '@/types'
import {
  createProjectInFolder,
  openProjectFolder,
  loadProjectFromHandle,
  loadModelsFromProject,
  saveProjectMeta,
  saveModelToProject,
  deleteModelFromProject,
  saveThumbnailToProject,
  exportProjectAsZip,
  getCachedHandles,
  verifyHandlePermission,
  removeCachedHandle,
  cacheHandle,
  cardFromMeta,
  writeJson,
} from '@/lib/projectDb'
import { apiConfigFor } from '@/lib/finSettings'
import { ASSETS_VERSION } from '@/lib/textureAssets'
import { collectMapGarbage, deleteMapAsset, storeMapImage } from '@/lib/mapAssets'
import { pickRenderSettings } from '@/constants/renderSettings'
import { useAppStore } from '@/store/useAppStore'

interface RecentProject {
  card: RecentProjectCard
  handle: FileSystemDirectoryHandle
}

const refreshCard = (recent: RecentProject[], meta: ProjectMeta): RecentProject[] =>
  recent.map(r => (r.card.projectId === meta.projectId ? { ...r, card: cardFromMeta(meta) } : r))

const PROJECT_COUNT_KEY = 'eko:recent-project-count'
/** Never counted before (fresh install / cleared storage) — assume none rather than
 *  inventing placeholder cards that flash before the "No recent projects" empty state. */
const FALLBACK_PROJECT_COUNT = 0

function readKnownProjectCount(): number {
  try {
    const n = parseInt(localStorage.getItem(PROJECT_COUNT_KEY) ?? '', 10)
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 24) : FALLBACK_PROJECT_COUNT
  } catch {
    return FALLBACK_PROJECT_COUNT
  }
}

function writeKnownProjectCount(n: number) {
  try {
    localStorage.setItem(PROJECT_COUNT_KEY, String(n))
  } catch { /* private mode / quota — the fallback covers it */ }
}

interface ProjectState {
  currentProject: ProjectMeta | null
  folderHandle: FileSystemDirectoryHandle | null
  recentProjects: RecentProject[]
  isDirty: boolean
  isLoading: boolean
  /** How many projects we expect — drives the loading skeleton's card count */
  knownProjectCount: number

  // Actions
  loadRecentProjects: () => Promise<void>
  createProject: (name: string, isFinProject?: boolean) => Promise<ProjectMeta | null>
  openProject: () => Promise<ProjectMeta | null>
  openRecentProject: (handle: FileSystemDirectoryHandle) => Promise<ProjectMeta | null>
  closeProject: () => void
  saveProject: () => Promise<void>
  deleteRecentProject: (projectId: string) => Promise<void>
  exportAsZip: () => Promise<void>
  exportFinProjectAsZip: () => Promise<void>

  // Model management within project
  addModelEntry: (model: LoadedModel) => Promise<ProjectModelEntry | null>
  removeModelEntry: (modelId: string) => Promise<void>
  updateModelTransform: (modelId: string, transform: { position?: [number, number, number], rotation?: [number, number, number], scale?: [number, number, number] }) => Promise<void>
  updateThumbnail: (dataUrl: string) => Promise<void>
  saveViewAndSettings: (camera: import('@/types').ProjectCamera, renderSettings: import('@/types').ProjectRenderSettings) => Promise<void>
  saveMapConfig: (mapConfig: import('@/types').MapConfig) => Promise<void>
  addMapImage: (file: Blob) => Promise<import('@/types').MapAsset | null>
  addTextureAsset: (asset: import('@/types').TextureAsset) => Promise<void>
  /** Dashboard Settings → Save Settings. Writes project.json (and api-config.json for a FIN
   *  project) into this project's folder, then makes it the open project's configuration.
   *  Throws when anything is not written, so the caller never reports a save that did not happen. */
  saveApiSettings: (apiSettings: import('@/types').ProjectApiSettings) => Promise<ProjectMeta>
  setMaterialOverride: (modelId: string, override: import('@/types').MaterialOverride) => Promise<void>
  removeMaterialOverride: (modelId: string, overrideId: string) => Promise<void>
  setDirty: (dirty: boolean) => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProject: null,
  folderHandle: null,
  recentProjects: [],
  isDirty: false,
  isLoading: false,
  knownProjectCount: readKnownProjectCount(),

  loadRecentProjects: async () => {
    set({ isLoading: true })
    const cached = await getCachedHandles()
    const valid: RecentProject[] = []
    const seenIds = new Set<string>()

    for (const { projectId, handle, card: cachedCard } of cached) {
      // The oldest cache shape stored a bare handle, so its card has to be
      // recovered from disk once before the list can render it
      let card = cachedCard
      if (!card) {
        const meta = await loadProjectFromHandle(handle)
        if (!meta) {
          await removeCachedHandle(projectId)
          continue
        }
        card = cardFromMeta(meta)
        await cacheHandle(meta.projectId, handle, meta, meta.thumbnail)
      }

      if (seenIds.has(card.projectId) || card.projectId !== projectId) {
        await removeCachedHandle(projectId)
      }
      if (!seenIds.has(card.projectId)) {
        seenIds.add(card.projectId)
        valid.push({ card, handle })
      }
    }
    valid.sort((a, b) => b.card.updatedAt - a.card.updatedAt)
    writeKnownProjectCount(valid.length)
    set({ recentProjects: valid, isLoading: false, knownProjectCount: valid.length })
  },

  createProject: async (name: string, isFinProject?: boolean) => {
    const result = await createProjectInFolder(name, isFinProject)
    if (!result) return null
    const { meta, handle } = result

    // Refresh recent list
    const recent = [{ card: cardFromMeta(meta), handle }, ...get().recentProjects]
    writeKnownProjectCount(recent.length)
    set({
      currentProject: meta,
      folderHandle: handle,
      isDirty: false,
      recentProjects: recent,
      knownProjectCount: recent.length,
    })
    return meta
  },

  openProject: async () => {
    const result = await openProjectFolder()
    if (!result) return null
    const { meta, handle } = result

    const recent = [
      { card: cardFromMeta(meta), handle },
      ...get().recentProjects.filter(r => r.card.projectId !== meta.projectId),
    ]
    writeKnownProjectCount(recent.length)
    set({
      currentProject: meta,
      folderHandle: handle,
      isDirty: false,
      recentProjects: recent,
      knownProjectCount: recent.length,
    })
    return meta
  },

  openRecentProject: async (handle: FileSystemDirectoryHandle) => {
    const ok = await verifyHandlePermission(handle)
    if (!ok) {
      alert("Permission to read this project folder was denied. Grant access and try again.")
      return null
    }
    const meta = await loadProjectFromHandle(handle)
    if (!meta) {
      alert("Could not read project.json in this folder. It may have been moved, renamed or deleted.")
      return null
    }

    await cacheHandle(meta.projectId, handle, meta, meta.thumbnail)

    const recent = get().recentProjects.filter(r => r.card.projectId !== meta.projectId)
    set({
      currentProject: meta,
      folderHandle: handle,
      isDirty: false,
      recentProjects: [{ card: cardFromMeta(meta), handle }, ...recent],
    })
    return meta
  },

  closeProject: () => {
    set({ currentProject: null, folderHandle: null, isDirty: false })
  },

  saveProject: async () => {
    const { currentProject, folderHandle } = get()
    if (!currentProject || !folderHandle) return
    const updated = { ...currentProject, updatedAt: Date.now() }
    
    try {
      await saveProjectMeta(folderHandle, updated)
      await cacheHandle(updated.projectId, folderHandle, updated, updated.thumbnail)
    } catch (err: any) {
      console.error("Save Error Details:", err);
      if (err?.message?.includes('state cached in an interface object')) {
        alert("The project files were modified externally. Please close and re-open the project folder.");
      } else {
        alert("Failed to save changes: " + err?.message);
      }
      return;
    }

    const recent = refreshCard(get().recentProjects, updated)
    set({ currentProject: updated, isDirty: false, recentProjects: recent })
  },

  deleteRecentProject: async (projectId: string) => {
    await removeCachedHandle(projectId)
    const recent = get().recentProjects.filter(r => r.card.projectId !== projectId)
    writeKnownProjectCount(recent.length)
    set({ recentProjects: recent, knownProjectCount: recent.length })
  },

  exportAsZip: async () => {
    const { currentProject, folderHandle } = get()
    if (!currentProject || !folderHandle) return

    // Always bake the current live render settings into the export so the
    // viewer renders exactly as it looks on screen — no need to save first.
    const liveRenderSettings = pickRenderSettings(useAppStore.getState())
    const metaToExport: ProjectMeta = { ...currentProject, renderSettings: liveRenderSettings }

    let blob: Blob
    try {
      blob = await exportProjectAsZip(folderHandle, metaToExport)
    } catch (err) {
      alert('Export failed: ' + (err instanceof Error ? err.message : err))
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentProject.name.replace(/[^a-z0-9]/gi, '_')}_project.zip`
    a.click()
    URL.revokeObjectURL(url)
  },

  exportFinProjectAsZip: async () => {
    const { currentProject, folderHandle } = get()
    if (!currentProject || !folderHandle) return

    // Always bake the current live render settings into the export
    const liveRenderSettings = pickRenderSettings(useAppStore.getState())
    const metaToExport: ProjectMeta = { ...currentProject, renderSettings: liveRenderSettings }

    const { exportFinProjectAsZip } = await import('@/lib/projectDb')
    let blob: Blob
    try {
      blob = await exportFinProjectAsZip(folderHandle, metaToExport)
    } catch (err) {
      alert('Export failed: ' + (err instanceof Error ? err.message : err))
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentProject.name.replace(/[^a-z0-9]/gi, '_')}_FIN_viewer.zip`
    a.click()
    URL.revokeObjectURL(url)
  },

  addModelEntry: async (model: LoadedModel) => {
    const { currentProject, folderHandle } = get()
    if (!currentProject || !folderHandle) return null

    const bytesCopy = new ArrayBuffer(model.fragBytes.byteLength)
    new Uint8Array(bytesCopy).set(new Uint8Array(model.fragBytes))

    const entry: import('@/types').ProjectModelEntry = {
      modelId: model.modelId,
      originalFileName: model.originalFileName,
      originalFileSizeBytes: model.originalFileSizeBytes,
      convertedFileSizeBytes: model.convertedFileSizeBytes,
      conversionTimeMs: model.conversionTimeMs,
      fragFile: `models/${model.modelId}.${model.type === 'glb' ? 'glb' : 'frag'}`,
      addedAt: Date.now(),
      type: model.type,
    }

    const updated: ProjectMeta = {
      ...currentProject,
      models: [...currentProject.models, entry],
      updatedAt: Date.now(),
    }
    
    try {
      await saveModelToProject(folderHandle, { ...entry, fragBytes: bytesCopy })
      await saveProjectMeta(folderHandle, updated)
      await cacheHandle(updated.projectId, folderHandle, updated, updated.thumbnail)
    } catch (err: any) {
      console.error("Save Error Details:", err);
      if (err?.message?.includes('state cached in an interface object')) {
        alert("The project files were modified externally. Please close and re-open the project folder.");
      } else {
        alert("Failed to save changes: " + err?.message);
      }
      throw err; // rethrow so the caller (like useIfcConverter) knows it failed
    }

    const recent = refreshCard(get().recentProjects, updated)
    set({ currentProject: updated, isDirty: false, recentProjects: recent })

    return entry
  },

  removeModelEntry: async (modelId: string) => {
    const { currentProject, folderHandle } = get()
    if (!currentProject || !folderHandle) return

    // Overrides for the removed model are quarantined rather than dropped, so
    // re-adding the model restores its materials
    const orphanedAt = Date.now()
    const overrides = Object.fromEntries(
      Object.entries(currentProject.materialOverrides || {}).map(([id, o]) =>
        o.modelId === modelId && !o.orphanedAt ? [id, { ...o, orphanedAt }] : [id, o]
      )
    )

    const updated: ProjectMeta = {
      ...currentProject,
      models: currentProject.models.filter(m => m.modelId !== modelId),
      ...(currentProject.materialOverrides ? { materialOverrides: overrides } : {}),
      updatedAt: Date.now(),
    }

    try {
      await deleteModelFromProject(folderHandle, modelId)
      await saveProjectMeta(folderHandle, updated)
      await cacheHandle(updated.projectId, folderHandle, updated, updated.thumbnail)
    } catch (err: any) {
      console.error("Save Error Details:", err);
      if (err?.message?.includes('state cached in an interface object')) {
        alert("The project files were modified externally. Please close and re-open the project folder.");
      } else {
        alert("Failed to save changes: " + err?.message);
      }
      return;
    }

    const recent = refreshCard(get().recentProjects, updated)
    set({ currentProject: updated, isDirty: false, recentProjects: recent })
  },

  updateThumbnail: async (dataUrl: string) => {
    const { folderHandle, currentProject, recentProjects } = get()
    if (!folderHandle || !currentProject) return
    await saveThumbnailToProject(folderHandle, dataUrl)
    const updated = { ...currentProject, thumbnail: dataUrl }
    
    const updatedRecent = refreshCard(recentProjects, updated)
    
    set({ currentProject: updated, recentProjects: updatedRecent })
  },

  saveMapConfig: async (mapConfig) => {
    const { folderHandle, currentProject, recentProjects } = get()
    if (!folderHandle || !currentProject) return
    const updated: ProjectMeta = { ...currentProject, mapConfig, updatedAt: Date.now() }
    updated.mapAssets = collectMapGarbage(updated)

    try {
      await saveProjectMeta(folderHandle, updated)
      await cacheHandle(updated.projectId, folderHandle, updated, updated.thumbnail)
    } catch (err: any) {
      console.error("Save Error Details:", err);
      if (err?.message?.includes('state cached in an interface object')) {
        alert("The project files were modified externally. Please close and re-open the project folder.");
      } else {
        alert("Failed to save changes: " + err?.message);
      }
      return;
    }

    // Renders are megabytes each, so dropped ones are deleted rather than left for export GC
    for (const [hash, asset] of Object.entries(currentProject.mapAssets ?? {})) {
      if (!updated.mapAssets?.[hash]) await deleteMapAsset(folderHandle, asset)
    }

    set({ currentProject: updated, isDirty: false, recentProjects: refreshCard(recentProjects, updated) })
  },

  addMapImage: async (file) => {
    const { folderHandle, currentProject } = get()
    if (!folderHandle || !currentProject) return null

    const asset = await storeMapImage(folderHandle, file)
    const updated: ProjectMeta = {
      ...currentProject,
      mapAssets: { ...(currentProject.mapAssets ?? {}), [asset.hash]: asset },
    }
    // Written to disk immediately; project.json catches up when the map is saved
    set({ currentProject: updated })
    return asset
  },

  saveViewAndSettings: async (camera, renderSettings) => {
    const { folderHandle, currentProject, recentProjects } = get()
    if (!folderHandle || !currentProject) return
    const updated = { ...currentProject, camera, renderSettings }
    
    try {
      await saveProjectMeta(folderHandle, updated)
      await cacheHandle(updated.projectId, folderHandle, updated, updated.thumbnail)
    } catch (err: any) {
      console.error("Save Error Details:", err);
      if (err?.message?.includes('state cached in an interface object')) {
        alert("The project files were modified externally. Please close and re-open the project folder.");
      } else {
        alert("Failed to save changes: " + err?.message);
      }
      return;
    }
    
    const updatedRecent = refreshCard(recentProjects, updated)
    
    set({ currentProject: updated, recentProjects: updatedRecent })
  },

  updateModelTransform: async (modelId: string, transform: { position?: [number, number, number], rotation?: [number, number, number], scale?: [number, number, number] }) => {
    const { currentProject, folderHandle } = get()
    if (!currentProject || !folderHandle) return

    const updated: ProjectMeta = {
      ...currentProject,
      models: currentProject.models.map(m =>
        m.modelId === modelId ? { ...m, ...transform } : m
      ),
      updatedAt: Date.now(),
    }
    
    try {
      await saveProjectMeta(folderHandle, updated)
      await cacheHandle(updated.projectId, folderHandle, updated, updated.thumbnail)
    } catch (err: any) {
      console.error("Save Error Details:", err);
      if (err?.message?.includes('state cached in an interface object')) {
        alert("The project files were modified externally. Please close and re-open the project folder.");
      } else {
        alert("Failed to save changes: " + err?.message);
      }
      return;
    }

    const recent = refreshCard(get().recentProjects, updated)
    set({ currentProject: updated, isDirty: false, recentProjects: recent })
  },

  addTextureAsset: async (asset: import('@/types').TextureAsset) => {
    const { currentProject, folderHandle } = get()
    if (!currentProject || !folderHandle) return
    if (currentProject.textures?.[asset.hash]) return

    const updated: ProjectMeta = {
      ...currentProject,
      assetsVersion: ASSETS_VERSION,
      textures: { ...(currentProject.textures || {}), [asset.hash]: asset },
      updatedAt: Date.now(),
    }
    await saveProjectMeta(folderHandle, updated)
    await cacheHandle(updated.projectId, folderHandle, updated, updated.thumbnail)
    set({ currentProject: updated, recentProjects: refreshCard(get().recentProjects, updated) })
  },

  saveApiSettings: async (apiSettings) => {
    const { currentProject, folderHandle } = get()
    if (!currentProject || !folderHandle) throw new Error('No project is open.')
    const projectId = currentProject.projectId
    const updated: ProjectMeta = { ...currentProject, apiSettings, updatedAt: Date.now() }

    // project.json is the source of truth: nothing changes in the app unless it was written
    await writeJson(folderHandle, 'project.json', updated)
    // Written to the folder that was open when Save was pressed. If another project was opened
    // meanwhile, that one stays on screen: this project's settings must not replace it.
    const stillOpen = () => get().currentProject?.projectId === projectId && get().folderHandle === folderHandle
    if (stillOpen()) {
      set({ currentProject: { ...get().currentProject!, apiSettings, updatedAt: updated.updatedAt } })
    }
    try { await cacheHandle(projectId, folderHandle, updated, updated.thumbnail) } catch { /* recent-list card only */ }
    set({ recentProjects: refreshCard(get().recentProjects, updated) })

    // The standalone FIN viewer reads this copy; a failure is reported, project.json already holds the save
    if (updated.isFinProject) {
      const failed = await writeJson(folderHandle, 'api-config.json', apiConfigFor(apiSettings, updated.name))
        .then(() => null, (err: unknown) => (err instanceof Error ? err.message : String(err)))
      if (failed) throw new Error(`Settings were saved to project.json, but api-config.json could not be written: ${failed}`)
    }
    return updated
  },

  setMaterialOverride: async (modelId: string, override: import('@/types').MaterialOverride) => {
    const { currentProject, folderHandle } = get()
    if (!currentProject || !folderHandle) return

    const materialOverrides = { ...(currentProject.materialOverrides || {}) }
    materialOverrides[override.id] = override

    const updated: ProjectMeta = {
      ...currentProject,
      materialOverrides,
      updatedAt: Date.now(),
    }
    
    try {
      await saveProjectMeta(folderHandle, updated)
      await cacheHandle(updated.projectId, folderHandle, updated, updated.thumbnail)
    } catch (err: any) {
      console.error("Save Error Details:", err);
      if (err?.message?.includes('state cached in an interface object')) {
        alert("The project files were modified by another program (e.g., Unreal Engine). Please close and re-open the project folder to save your changes.");
      } else {
        alert("Failed to save changes: " + err?.message);
      }
      return;
    }

    const recent = refreshCard(get().recentProjects, updated)
    set({ currentProject: updated, isDirty: false, recentProjects: recent })
  },

  removeMaterialOverride: async (modelId: string, overrideId: string) => {
    const { currentProject, folderHandle } = get()
    if (!currentProject || !folderHandle) return

    const materialOverrides = { ...(currentProject.materialOverrides || {}) }
    delete materialOverrides[overrideId]

    const updated: ProjectMeta = {
      ...currentProject,
      materialOverrides,
      updatedAt: Date.now(),
    }
    
    try {
      await saveProjectMeta(folderHandle, updated)
      await cacheHandle(updated.projectId, folderHandle, updated, updated.thumbnail)
    } catch (err: any) {
      console.error("Save Error Details:", err);
      if (err?.message?.includes('state cached in an interface object')) {
        alert("The project files were modified by another program (e.g., Unreal Engine). Please close and re-open the project folder to save your changes.");
      } else {
        alert("Failed to save changes: " + err?.message);
      }
      return;
    }

    const recent = refreshCard(get().recentProjects, updated)
    set({ currentProject: updated, isDirty: false, recentProjects: recent })
  },

  setDirty: (dirty) => set({ isDirty: dirty }),
}))
