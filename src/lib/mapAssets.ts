import { encodeCapped, sha256Prefix } from '@/lib/textureAssets'
import { BUILTIN_PREFIX, BUILTIN_RENDERS_DIR } from '@/data/regions'
import type { MapAsset, ProjectMeta } from '@/types'

export const MAP_ASSETS_DIR = 'mapassets'
/** Image sources are one untiled, un-mipmapped GPU texture each — add pyramid levels, not pixels */
export const MAX_MAP_IMAGE_SIZE = 4096
const MAP_WEBP_QUALITY = 0.9

const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export async function buildMapImageAsset(source: Blob): Promise<{ asset: MapAsset; blob: Blob }> {
  const { blob, width, height, sourceWidth, sourceHeight } =
    await encodeCapped(source, MAX_MAP_IMAGE_SIZE, MAP_WEBP_QUALITY)
  const bytes = await blob.arrayBuffer()
  const hash = await sha256Prefix(bytes)
  const mime = blob.type || 'image/webp'

  return {
    blob,
    asset: {
      kind: 'image',
      hash,
      src: `${MAP_ASSETS_DIR}/${hash}.${EXTENSIONS[mime] ?? 'bin'}`,
      mime,
      bytes: bytes.byteLength,
      width,
      height,
      sourceWidth,
      sourceHeight,
    },
  }
}

const assetsDir = (handle: FileSystemDirectoryHandle, create: boolean) =>
  handle.getDirectoryHandle(MAP_ASSETS_DIR, { create })

export const assetFileName = (asset: MapAsset) => asset.src.slice(MAP_ASSETS_DIR.length + 1)

export async function storeMapImage(handle: FileSystemDirectoryHandle, source: Blob): Promise<MapAsset> {
  const { asset, blob } = await buildMapImageAsset(source)
  const dir = await assetsDir(handle, true)
  const file = await dir.getFileHandle(assetFileName(asset), { create: true })
  const writable = await file.createWritable()
  await writable.write(blob)
  await writable.close()
  return asset
}

/** Map renders are megabytes each, so an orphan is worth deleting rather than leaving for export GC */
export async function deleteMapAsset(handle: FileSystemDirectoryHandle, asset: MapAsset) {
  try {
    const dir = await assetsDir(handle, false)
    await dir.removeEntry(assetFileName(asset))
  } catch { /* already gone */ }
}

/** Rooted on overlays and basemap packs — the two places a map asset can be referenced */
export function collectMapGarbage(meta: ProjectMeta): Record<string, MapAsset> {
  const referenced = new Set<string>()
  for (const overlay of meta.mapConfig?.overlays ?? []) referenced.add(overlay.hash)
  const basemap = meta.mapConfig?.basemap
  if (basemap && (basemap.kind === 'image' || basemap.kind === 'pack')) referenced.add(basemap.hash)

  return Object.fromEntries(
    Object.entries(meta.mapAssets ?? {}).filter(([hash]) => referenced.has(hash))
  )
}

export type AssetHandle =
  | { url: string }
  | { image: ImageBitmap; release: () => void }

export type AssetResolver = (hash: string) => Promise<AssetHandle | null>

/** The exported viewer reads over HTTP; the studio owns the folder and has no server.
 *  Both go through here so the two paths cannot drift. */
export function createAssetResolver(
  meta: ProjectMeta,
  handle: FileSystemDirectoryHandle | null,
  base = './'
): AssetResolver {
  return async (hash: string) => {
    // Built-in renders ship with the app, so they resolve over HTTP even in the studio
    if (hash.startsWith(BUILTIN_PREFIX)) {
      const name = hash.slice(BUILTIN_PREFIX.length)
      return { url: `${base}${BUILTIN_RENDERS_DIR}/${name}.webp` }
    }
    const asset = meta.mapAssets?.[hash]
    if (!asset) return null
    if (!handle) return { url: base + asset.src }
    const dir = await assetsDir(handle, false)
    const file = await (await dir.getFileHandle(assetFileName(asset))).getFile()
    const image = await createImageBitmap(file)
    return { image, release: () => image.close() }
  }
}
