import { get, set, del, keys, createStore } from 'idb-keyval'
import type JSZip from 'jszip'
import { ASSETS_VERSION, buildTextureAsset, collectGarbage, TEXTURES_DIR } from '@/lib/textureAssets'
import { assetFileName, collectMapGarbage, MAP_ASSETS_DIR } from '@/lib/mapAssets'
import { hasMap, pruneMapConfig } from '@/lib/mapConfig'
import type { MapAsset, ProjectMeta, ProjectModel, RecentProjectCard, TextureAsset } from '@/types'

// Only used to CACHE folder handles for "recent projects" — no actual data stored here
const handleStore = createStore('ifcviewer-handles', 'folder-handles')

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FolderProject {
  meta: ProjectMeta
  handle: FileSystemDirectoryHandle
}

// ─── Handle Cache (recent projects) ──────────────────────────────────────────

export function cardFromMeta(meta: ProjectMeta, thumbnail?: string): RecentProjectCard {
  return {
    projectId: meta.projectId,
    name: meta.name,
    modelCount: meta.models.length,
    updatedAt: meta.updatedAt,
    isFinProject: meta.isFinProject,
    hasMap: hasMap(meta),
    thumbnail: thumbnail ?? meta.thumbnail,
  }
}

export async function cacheHandle(projectId: string, handle: FileSystemDirectoryHandle, meta: ProjectMeta, thumbnail?: string) {
  await set(projectId, { handle, card: cardFromMeta(meta, thumbnail) }, handleStore)
}

export async function getCachedHandles(): Promise<{ projectId: string; handle: FileSystemDirectoryHandle; card?: RecentProjectCard }[]> {
  const allKeys = await keys(handleStore)
  const results: { projectId: string; handle: FileSystemDirectoryHandle; card?: RecentProjectCard }[] = []
  for (const key of allKeys) {
    const val = await get<any>(key, handleStore)
    if (!val) continue
    if (val.kind === 'directory') {
      // legacy format: just the handle
      results.push({ projectId: String(key), handle: val })
    } else if (val.card) {
      results.push({ projectId: String(key), handle: val.handle, card: val.card })
    } else if (val.handle && val.meta) {
      // legacy format: the whole meta, which is what made this store enormous
      const card = cardFromMeta(val.meta, val.thumbnail)
      await set(key, { handle: val.handle, card }, handleStore)
      results.push({ projectId: String(key), handle: val.handle, card })
    } else if (val.handle) {
      results.push({ projectId: String(key), handle: val.handle })
    }
  }
  return results
}

export async function removeCachedHandle(projectId: string) {
  await del(projectId, handleStore)
}

export async function verifyHandlePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const state = await (handle as any).queryPermission({ mode: 'readwrite' })
    if (state === 'granted') return true
    const requested = await (handle as any).requestPermission({ mode: 'readwrite' })
    return requested === 'granted'
  } catch {
    return false
  }
}

// ─── File System Operations ───────────────────────────────────────────────────

export async function writeJson(dir: FileSystemDirectoryHandle, filename: string, data: object) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const fh = await dir.getFileHandle(filename, { create: true })
      const writable = await fh.createWritable()
      await writable.write(JSON.stringify(data, null, 2))
      await writable.close()
      return;
    } catch (err: any) {
      lastErr = err;
      if (err?.message?.includes('state cached in an interface object')) {
        await new Promise(r => setTimeout(r, 250));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function readJson<T>(dir: FileSystemDirectoryHandle, filename: string): Promise<T | null> {
  try {
    const fh = await dir.getFileHandle(filename)
    const file = await fh.getFile()
    return JSON.parse(await file.text()) as T
  } catch {
    return null
  }
}

export async function writeBinary(dir: FileSystemDirectoryHandle, filename: string, data: ArrayBuffer | Uint8Array) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const fh = await dir.getFileHandle(filename, { create: true })
      const writable = await fh.createWritable()
      await writable.write(new Blob([data as unknown as BlobPart]))
      await writable.close()
      return;
    } catch (err: any) {
      lastErr = err;
      if (err?.message?.includes('state cached in an interface object')) {
        await new Promise(r => setTimeout(r, 250));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function readBinary(dir: FileSystemDirectoryHandle, filename: string): Promise<ArrayBuffer | null> {
  try {
    const fh = await dir.getFileHandle(filename)
    const file = await fh.getFile()
    return await file.arrayBuffer()
  } catch {
    return null
  }
}

export async function readBinaryStreaming(
  dir: FileSystemDirectoryHandle,
  filename: string,
  onBytes?: (bytesRead: number, totalBytes: number) => void
): Promise<ArrayBuffer | null> {
  try {
    const fh = await dir.getFileHandle(filename)
    const file = await fh.getFile()
    const reader = file.stream().getReader()
    const buf = new Uint8Array(file.size)
    let offset = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf.set(value, offset)
      offset += value.length
      onBytes?.(offset, file.size)
    }
    return buf.buffer
  } catch {
    return null
  }
}

export async function deleteFile(dir: FileSystemDirectoryHandle, filename: string) {
  try {
    await dir.removeEntry(filename)
  } catch { /* ignore */ }
}

// ─── Project Operations ───────────────────────────────────────────────────────

/** Pick a parent folder and create a new project subfolder inside it */
export async function createProjectInFolder(name: string, isFinProject?: boolean): Promise<FolderProject | null> {
  try {
    // 1. User picks a workspace/parent folder
    const parentHandle = await (window as any).showDirectoryPicker({ 
      mode: 'readwrite',
      id: 'eko-projects'
    })
    
    // 2. Create a subfolder for this specific project
    const safeName = name.replace(/[^a-z0-9 _-]/gi, '_').trim() || 'Untitled_Project'
    const handle = await parentHandle.getDirectoryHandle(safeName, { create: true })

    // 3. Create the models directory inside the new project folder
    await handle.getDirectoryHandle('models', { create: true })

    const projectId = `proj-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`
    const meta: ProjectMeta = {
      version: 1,
      projectId,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      models: [],
      geolocation: null,
      isFinProject,
    }

    await writeJson(handle, 'project.json', meta)
    await cacheHandle(projectId, handle, meta)

    return { meta, handle }
  } catch (e: any) {
    if (e?.name === 'AbortError') return null // user cancelled
    throw e
  }
}

/** Pick an existing project folder */
export async function openProjectFolder(): Promise<FolderProject | null> {
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
    const meta = await readJson<ProjectMeta>(handle, 'project.json')
    if (!meta) throw new Error('No project.json found in this folder')

    // Read thumbnail if available to cache it
    let thumbnail: string | undefined
    try {
      const fh = await handle.getFileHandle('thumbnail.webp')
      const file = await fh.getFile()
      const buf = await file.arrayBuffer()
      const b64 = btoa(new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), ''))
      thumbnail = `data:image/webp;base64,${b64}`
      ;(meta as any).thumbnail = thumbnail
    } catch { /* missing thumbnail, ok */ }

    await cacheHandle(meta.projectId, handle, meta, thumbnail)
    return { meta, handle }
  } catch (e: any) {
    if (e?.name === 'AbortError') return null
    throw e
  }
}

/** Load project from a cached handle, including thumbnail */
export async function loadProjectFromHandle(handle: FileSystemDirectoryHandle): Promise<ProjectMeta | null> {
  const meta = await readJson<ProjectMeta>(handle, 'project.json')
  if (!meta) return null

  // Read thumbnail.webp from disk and attach as data URL
  try {
    const fh = await handle.getFileHandle('thumbnail.webp')
    const file = await fh.getFile()
    if (file.size > 0) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      });
      (meta as any).thumbnail = dataUrl
    }
  } catch {
    // No thumbnail yet, that's fine
  }

  return meta
}

/** Save updated project.json */
export async function saveProjectMeta(handle: FileSystemDirectoryHandle, meta: ProjectMeta) {
  await writeJson(handle, 'project.json', { ...meta, updatedAt: Date.now() })
}

/** Save a .frag model binary to project/models/ */
export async function saveModelToProject(
  handle: FileSystemDirectoryHandle,
  model: ProjectModel
): Promise<string> {
  const modelsDir = await handle.getDirectoryHandle('models', { create: true })
  const ext = model.type === 'glb' ? 'glb' : 'frag'
  const fileName = `${model.modelId}.${ext}`
  await writeBinary(modelsDir, fileName, model.fragBytes)
  return `models/${fileName}`
}

/** Load all model binaries listed in project.json */
export async function loadModelsFromProject(
  handle: FileSystemDirectoryHandle,
  meta: ProjectMeta,
  onModel?: (model: ProjectModel, readMs: number) => void,
  onBytes?: (modelId: string, bytesRead: number, totalBytes: number) => void,
  onMissing?: (modelId: string) => void
): Promise<ProjectModel[]> {
  const modelsDir = await handle.getDirectoryHandle('models', { create: true })
  const results: ProjectModel[] = []

  for (const entry of meta.models) {
    const ext = entry.type === 'glb' ? 'glb' : 'frag'
    const fileName = `${entry.modelId}.${ext}`
    const readStart = performance.now()
    const bytes = await readBinaryStreaming(modelsDir, fileName, (read, total) => onBytes?.(entry.modelId, read, total))
    if (bytes) {
      const model = { ...entry, fragBytes: bytes }
      results.push(model)
      // Hand each model over as soon as its bytes land so callers can show it
      // immediately instead of waiting for the whole (potentially GB-sized) set
      onModel?.(model, performance.now() - readStart)
    } else {
      onMissing?.(entry.modelId)
    }
  }

  return results
}

/** Delete a model's .frag from disk */
export async function deleteModelFromProject(
  handle: FileSystemDirectoryHandle,
  modelId: string
) {
  try {
    const modelsDir = await handle.getDirectoryHandle('models')
    await modelsDir.removeEntry(`${modelId}.frag`)
  } catch { /* ignore if not found */ }
  try {
    const modelsDir = await handle.getDirectoryHandle('models')
    await modelsDir.removeEntry(`${modelId}.glb`)
  } catch { /* ignore if not found */ }
}

/** Save canvas thumbnail as webp */
export async function saveThumbnailToProject(handle: FileSystemDirectoryHandle, dataUrl: string) {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const buf = await blob.arrayBuffer()
  await writeBinary(handle, 'thumbnail.webp', buf)
}

// .frag, .glb and .webp are already compressed; deflating them again is seconds of pako for ~9%
const STORED = { compression: 'STORE' } as const

/** Read every model listed in `meta` that still has a file on disk */
async function readBundledModels(handle: FileSystemDirectoryHandle, meta: ProjectMeta) {
  const modelsDir = await handle.getDirectoryHandle('models', { create: true })
  const bundled: { modelId: string; fileName: string; bytes: ArrayBuffer }[] = []
  for (const entry of meta.models) {
    const ext = entry.type === 'glb' ? 'glb' : 'frag'
    const fileName = `${entry.modelId}.${ext}`
    const bytes = await readBinary(modelsDir, fileName)
    if (bytes) bundled.push({ modelId: entry.modelId, fileName, bytes })
  }
  return bundled
}

/** Narrow a meta to the models that were actually bundled, so the export never
 *  declares a model it does not ship or carries a texture for one */
function metaForBundledModels(meta: ProjectMeta, bundled: Set<string>): ProjectMeta {
  const droppedModels = meta.models.filter(m => !bundled.has(m.modelId)).map(m => m.modelId)
  if (droppedModels.length) {
    console.warn(`[export] omitting ${droppedModels.length} model(s) with no file on disk: ${droppedModels.join(', ')}`)
  }

  const narrowed: ProjectMeta = { ...meta, models: meta.models.filter(m => bundled.has(m.modelId)) }

  if (meta.materialOverrides) {
    const kept = Object.entries(meta.materialOverrides)
      .filter(([, o]) => bundled.has(o.modelId) && !o.orphanedAt)
    const droppedCount = Object.keys(meta.materialOverrides).length - kept.length
    if (droppedCount) {
      console.warn(`[export] omitting ${droppedCount} material override(s) that are orphaned or target omitted models`)
    }
    narrowed.materialOverrides = Object.fromEntries(kept)
  }

  if (meta.mapConfig) {
    narrowed.mapConfig = pruneMapConfig(meta.mapConfig, bundled)
    narrowed.mapAssets = collectMapGarbage(narrowed)
  }

  if (meta.textures) narrowed.textures = collectGarbage(narrowed)

  return narrowed
}

/** Ship every map image the pruned config still references. A missing file also disables
 *  the overlay that wanted it, so the export never declares imagery it does not carry. */
async function addMapAssetsToZip(
  handle: FileSystemDirectoryHandle,
  meta: ProjectMeta,
  zip: JSZip,
  prefix: string
): Promise<ProjectMeta> {
  if (!meta.mapConfig || !meta.mapAssets || !Object.keys(meta.mapAssets).length) return meta

  const dir = await handle.getDirectoryHandle(MAP_ASSETS_DIR, { create: true })
  const shipped: Record<string, MapAsset> = {}
  const missing: string[] = []

  for (const asset of Object.values(meta.mapAssets)) {
    const bytes = await readBinary(dir, assetFileName(asset))
    if (bytes) {
      zip.file(`${prefix}${asset.src}`, bytes, STORED)
      shipped[asset.hash] = asset
    } else {
      missing.push(asset.src)
    }
  }
  if (missing.length) {
    console.warn(`[export] omitting ${missing.length} map asset(s) missing from disk: ${missing.join(', ')}`)
  }

  const basemap = meta.mapConfig.basemap
  const mapConfig = {
    ...meta.mapConfig,
    overlays: (meta.mapConfig.overlays ?? []).filter(o => shipped[o.hash]),
    basemap:
      (basemap.kind === 'image' || basemap.kind === 'pack') && !shipped[basemap.hash]
        ? ({ kind: 'void' } as const)
        : basemap,
  }

  return { ...meta, mapConfig, mapAssets: shipped }
}

/** Ship every referenced texture as a sidecar file, converting any that the project
 *  still stores inline. The project on disk is not touched — only the bundle. */
async function addTexturesToZip(
  handle: FileSystemDirectoryHandle,
  meta: ProjectMeta,
  zip: JSZip,
  prefix: string
): Promise<ProjectMeta> {
  const textures = { ...(meta.textures || {}) }
  const overrides = { ...(meta.materialOverrides || {}) }

  // Overrides commonly share one image, and re-encoding is by far the slowest part
  // of an export, so each distinct data URL is converted once
  const encoded = new Map<string, TextureAsset>()
  for (const [id, override] of Object.entries(overrides)) {
    if (!override.textureDataUrl) continue
    let asset = encoded.get(override.textureDataUrl)
    if (!asset) {
      const source = await (await fetch(override.textureDataUrl)).blob()
      const built = await buildTextureAsset(source)
      asset = built.asset
      encoded.set(override.textureDataUrl, asset)
      if (!textures[asset.hash]) {
        textures[asset.hash] = asset
        zip.file(`${prefix}${asset.src}`, await built.blob.arrayBuffer(), STORED)
      }
    }
    const hashed = { ...override, textureHash: asset.hash }
    delete hashed.textureDataUrl
    overrides[id] = hashed
  }
  if (encoded.size) {
    console.info(`[export] encoded ${encoded.size} distinct texture(s) into ${TEXTURES_DIR}/`)
  }

  // Textures the project already keeps as sidecars are copied straight across
  const dir = await handle.getDirectoryHandle(TEXTURES_DIR, { create: true })
  for (const asset of Object.values(textures)) {
    if (zip.file(`${prefix}${asset.src}`)) continue
    const bytes = await readBinary(dir, asset.src.slice(TEXTURES_DIR.length + 1))
    if (bytes) zip.file(`${prefix}${asset.src}`, bytes, STORED)
    else console.warn(`[export] texture ${asset.src} is missing from disk`)
  }

  return { ...meta, assetsVersion: ASSETS_VERSION, textures, materialOverrides: overrides }
}

/** Export entire project as a ZIP blob */
export async function exportProjectAsZip(handle: FileSystemDirectoryHandle, meta: ProjectMeta): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  // Models — placed inside backend/models/ so FastAPI /models/{filename} route serves them
  const models = await readBundledModels(handle, meta)
  const bundledMeta = metaForBundledModels(meta, new Set(models.map(m => m.modelId)))

  const texturedMeta = await addTexturesToZip(handle, bundledMeta, zip, 'backend/')
  const exportedMeta = await addMapAssetsToZip(handle, texturedMeta, zip, 'backend/')

  // Project metadata and models go inside backend/ so FastAPI can serve them.
  // Force finDirectMode off — this bundle ships the FastAPI backend, so the viewer
  // must proxy through it instead of calling FIN straight from the browser.
  const backendMeta = { ...exportedMeta, apiSettings: { ...(exportedMeta.apiSettings || {}), finDirectMode: false } }
  zip.file('backend/project.json', JSON.stringify(backendMeta, null, 2))

  // Thumbnail
  try {
    const thumbFh = await handle.getFileHandle('thumbnail.webp')
    const thumbFile = await thumbFh.getFile()
    zip.file('backend/thumbnail.webp', await thumbFile.arrayBuffer(), STORED)
  } catch { /* no thumbnail yet */ }

  const backendModelsFolder = zip.folder('backend/models')!
  for (const model of models) {
    backendModelsFolder.file(model.fileName, model.bytes, STORED)
  }


  // Include Built Viewer App + Backend
  const res = await fetch('/viewer-assets.json?t=' + Date.now(), { cache: 'no-store' })
  if (!res.ok) {
    throw new Error('Viewer assets not bundled. Run `npm run build` in the studio first.')
  }
  const files: { path: string, content: string }[] = await res.json()
  for (const f of files) {
    if (f.path === 'index.html') continue // Skip the studio app entry
    // Place all viewer static assets inside backend/static/ so FastAPI can serve them
    zip.file(`backend/static/${f.path}`, f.content, { base64: true })
  }

  // Served by a dev-server middleware only, so a studio running from dist/ cannot reach them
  const backendFiles = [
    { name: 'main.py', url: '/backend/main.py' },
    { name: 'fin_client.py', url: '/backend/fin_client.py' },
    { name: 'start_viewer.py', url: '/backend/start_viewer.py' },
    { name: 'requirements.txt', url: '/backend/requirements.txt' },
    { name: 'login.html', url: '/backend/login.html' },
  ]
  for (const bf of backendFiles) {
    const r = await fetch(bf.url + '?t=' + Date.now(), { cache: 'no-store' })
    if (!r.ok) {
      throw new Error(`Could not read ${bf.url} (HTTP ${r.status}). Export the project from \`npm run dev\`.`)
    }
    zip.file(`backend/${bf.name}`, await r.text())
  }

  // config.json — start from the repo file and overlay only the connection fields
  // the settings modal owns. Point maps are deliberately left alone: config.json
  // holds equipment_classes / meter_profile / realtime_endpoints and an audited
  // live_point_ids set that the modal does not model, so overwriting them from
  // apiSettings would drop backend-only mappings and revive retired point IDs.
  try {
    const r = await fetch('/backend/config.json?t=' + Date.now(), { cache: 'no-store' })
    if (r.ok) {
      const cfg = await r.json()
      const s = meta.apiSettings || {}
      if (s.finProjectName) cfg.project_name = s.finProjectName
      if (s.finBaseUrl) cfg.fin_server_url = s.finBaseUrl
      if (s.finInterval) cfg.polling = { ...(cfg.polling || {}), live_ms: s.finInterval }
      zip.file('backend/config.json', JSON.stringify(cfg, null, 2))
    }
  } catch { /* skip if not available */ }

  // Launch script: installs deps and starts the FastAPI backend (serves viewer + API)
  const winBat = [
    '@echo off',
    'echo ============================================',
    'echo   EKO Digital Twin Viewer + FIN Backend',
    'echo ============================================',
    'echo.',
    'echo Checking Python...',
    'python --version >nul 2>&1 || (echo Python not found. Please install Python 3.10+ && pause && exit /b 1)',
    'echo.',
    'echo Installing backend dependencies...',
    'cd /d "%~dp0backend"',
    'pip install -r requirements.txt --quiet',
    'echo.',
    'echo Starting server on port 8000.',
    'echo   This device:    http://127.0.0.1:8000/',
    'echo   Other devices:  http://[this-machine-ip]:8000/',
    'echo.',
    'echo Sign in when the page opens. Press Ctrl+C to stop.',
    'echo.',
    'python start_viewer.py',
    'pause',
  ].join('\r\n')

  zip.file('Start_Viewer_Windows.bat', winBat)

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } })
}

/** Export FIN Project as a lightweight static viewer ZIP */
export async function exportFinProjectAsZip(handle: FileSystemDirectoryHandle, meta: ProjectMeta): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  // 1. Add project config and models at the root
  const models = await readBundledModels(handle, meta)
  const bundledMeta = metaForBundledModels(meta, new Set(models.map(m => m.modelId)))

  const texturedMeta = await addTexturesToZip(handle, bundledMeta, zip, '')
  const exportedMeta = await addMapAssetsToZip(handle, texturedMeta, zip, '')

  // Force finDirectMode to true for the FIN standalone viewer since there is no backend
  const finMeta = { ...exportedMeta, apiSettings: { ...(exportedMeta.apiSettings || {}), finDirectMode: true } }
  zip.file('project.json', JSON.stringify(finMeta, null, 2))

  // Also include api-config.json for standalone FIN dashboard (direct API mode)
  const apiSettings = meta.apiSettings || {}
  const apiConfig = {
    project_name: apiSettings.finProjectName || meta.name,
    fin_server_url: apiSettings.finBaseUrl || 'https://localhost',
    direct_mode: true, // Always true for FIN standalone viewer
    polling_interval: apiSettings.finInterval || 5000,
    live_point_ids: apiSettings.finLivePoints || {},
    power_endpoints: apiSettings.finEndpoints || {},
    weather: {
      lat: apiSettings.weatherLat ?? 24.469,
      lon: apiSettings.weatherLon ?? 54.358,
      apiKey: apiSettings.weatherApiKey || '88214bff7aa566e9f6ff1ba5db38f65f',
    },
    navButtons: apiSettings.navButtons,
    leftCards: apiSettings.leftCards,
    rightCards: apiSettings.rightCards,
    sideButtons: apiSettings.sideButtons,
  }
  zip.file('api-config.json', JSON.stringify(apiConfig, null, 2))

  const zipModelsFolder = zip.folder('models')!
  for (const model of models) {
    zipModelsFolder.file(model.fileName, model.bytes, STORED)
  }


  try {
    const thumbFh = await handle.getFileHandle('thumbnail.webp')
    const thumbFile = await thumbFh.getFile()
    zip.file('thumbnail.webp', await thumbFile.arrayBuffer(), STORED)
  } catch { /* no thumbnail yet */ }

  // 2. Add static Viewer App directly to root structure (No backend)
  try {
    const res = await fetch('/viewer-assets.json?t=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) {
      throw new Error("Viewer assets not bundled. You must run `npm run build` in the studio first.")
    }

    const files: { path: string, content: string }[] = await res.json()
    for (const f of files) {
      if (f.path === 'index.html') continue // Skip main studio app
      
      if (f.path === 'viewer.html') {
        // Rename viewer.html to index.html and fix paths to be relative for static serving
        let htmlContent = atob(f.content)
        htmlContent = htmlContent.replace(/(href|src)="\/assets\//g, '$1="assets/')
        htmlContent = htmlContent.replace(/(href|src)="\/vite\.svg"/g, '$1="vite.svg"')
        zip.file('index.html', htmlContent)
      } else {
        // e.g. assets/viewer-123.js
        zip.file(f.path, f.content, { base64: true })
      }
    }
  } catch (err) {
    console.error("Failed to include viewer assets in FIN zip", err)
    throw new Error("Failed to bundle static viewer assets. Check console.")
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } })
}

