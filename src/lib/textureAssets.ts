import type { MaterialOverride, ProjectMeta, TextureAsset } from '@/types'

export const ASSETS_VERSION = 2
export const MAX_TEXTURE_SIZE = 2048
export const TEXTURES_DIR = 'textures'

const WEBP_QUALITY = 0.82

const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export async function sha256Prefix(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

/** Re-encode to WebP under the size cap. Falls back to the original bytes when that
 *  would be larger, or when the browser cannot encode WebP. */
export async function encodeCapped(
  source: Blob,
  maxSize = MAX_TEXTURE_SIZE,
  quality = WEBP_QUALITY
): Promise<{ blob: Blob; width: number; height: number; sourceWidth: number; sourceHeight: number }> {
  const bitmap = await createImageBitmap(source)
  const sourceWidth = bitmap.width
  const sourceHeight = bitmap.height
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return { blob: source, width: sourceWidth, height: sourceHeight, sourceWidth, sourceHeight }
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const encoded = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/webp', quality)
  )
  if (!encoded || encoded.type !== 'image/webp' || (encoded.size >= source.size && scale === 1)) {
    return { blob: source, width: sourceWidth, height: sourceHeight, sourceWidth, sourceHeight }
  }
  return { blob: encoded, width, height, sourceWidth, sourceHeight }
}

async function texturesDir(handle: FileSystemDirectoryHandle, create: boolean) {
  return handle.getDirectoryHandle(TEXTURES_DIR, { create })
}

/** Encode and hash an image without writing it anywhere. */
export async function buildTextureAsset(source: Blob): Promise<{ asset: TextureAsset; blob: Blob }> {
  const { blob, width, height, sourceWidth, sourceHeight } = await encodeCapped(source)
  const bytes = await blob.arrayBuffer()
  const hash = await sha256Prefix(bytes)
  const mime = blob.type || 'image/webp'
  const name = `${hash}.${EXTENSIONS[mime] ?? 'bin'}`

  return {
    blob,
    asset: {
      hash,
      src: `${TEXTURES_DIR}/${name}`,
      mime,
      width,
      height,
      sourceWidth,
      sourceHeight,
      bytes: bytes.byteLength,
    },
  }
}

/** Write an image into the project's textures/ folder, keyed by content hash. */
export async function storeTexture(handle: FileSystemDirectoryHandle, source: Blob): Promise<TextureAsset> {
  const { asset, blob } = await buildTextureAsset(source)

  const dir = await texturesDir(handle, true)
  const file = await dir.getFileHandle(asset.src.slice(TEXTURES_DIR.length + 1), { create: true })
  const writable = await file.createWritable()
  await writable.write(blob)
  await writable.close()

  return asset
}

/** Resolve a texture to something THREE.TextureLoader can fetch.
 *
 *  The exported viewer has no directory handle and reads textures over HTTP; the studio
 *  owns the folder and has no server, so it reads through the handle. Both paths go
 *  through here so they cannot drift.
 */
export async function resolveTextureUrl(
  meta: ProjectMeta,
  override: MaterialOverride,
  handle: FileSystemDirectoryHandle | null
): Promise<{ url: string; revoke: boolean } | null> {
  if (override.textureHash) {
    const asset = meta.textures?.[override.textureHash]
    if (!asset) return null
    if (!handle) return { url: asset.src, revoke: false }
    const dir = await texturesDir(handle, false)
    const file = await dir.getFileHandle(asset.src.slice(TEXTURES_DIR.length + 1))
    return { url: URL.createObjectURL(await file.getFile()), revoke: true }
  }
  if (override.textureDataUrl) return { url: override.textureDataUrl, revoke: false }
  return null
}

/** Drop textures no override references any more. */
export function collectGarbage(meta: ProjectMeta): Record<string, TextureAsset> {
  const referenced = new Set(
    Object.values(meta.materialOverrides || {})
      .map(o => o.textureHash)
      .filter((h): h is string => !!h)
  )
  return Object.fromEntries(
    Object.entries(meta.textures || {}).filter(([hash]) => referenced.has(hash))
  )
}
