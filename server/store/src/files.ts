// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import { open } from 'node:fs/promises'
import { extname } from 'node:path'

const TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
}

/** Only these are shown by a browser that opens the link; everything else (SVG, HTML, ...) downloads. */
const INLINE_TYPES = new Set([
  'text/markdown; charset=utf-8',
  'text/plain; charset=utf-8',
  'application/json',
  'application/zip',
])
export const isInlineType = (type: string) => INLINE_TYPES.has(type)

export const FOLDER_TYPE = 'httpd/unix-directory'
export const contentTypeOf = (name: string) =>
  TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'

/** A strong ETag: the SHA-256 of the content, in quotes. */
export const etagOf = (hex: string) => `"${hex}"`

/** A folder's ETag follows its own mtime (it changes when entries are added, removed or renamed). */
export const folderEtag = (mtimeMs: number, ino: number) =>
  etagOf(createHash('sha256').update(`dir:${ino}:${mtimeMs}`).digest('hex'))

/** Hashes a whole open file. Reads by position, so the same handle can be read again. */
export async function hashHandle(fh: FileHandle): Promise<{ etag: string; size: number }> {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of fh.createReadStream({ start: 0, autoClose: false })) {
    hash.update(chunk as Buffer)
    size += (chunk as Buffer).length
  }
  return { etag: etagOf(hash.digest('hex')), size }
}

/** How many files were read in full to hash them (tests watch this). */
export const hashStats = { reads: 0 }
const CACHE_MAX = 4096
/** Content ETags by (dev, ino, size, mtimeMs). A replace is a rename, so it is a new inode and a new key. */
const etagCache = new Map<string, { etag: string; size: number }>()

export async function fileEtag(real: string): Promise<{ etag: string; size: number }> {
  const fh = await open(real, 'r')
  try {
    // Key from the open handle, so the hash and the key describe the same file.
    const st = await fh.stat()
    const key = `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`
    const hit = etagCache.get(key)
    if (hit) {
      etagCache.delete(key) // keep it newest (LRU)
      etagCache.set(key, hit)
      return hit
    }
    hashStats.reads++
    const res = await hashHandle(fh)
    // A file written moments ago may be written again within the file system's mtime tick (some round to 1-2 s): same key, new content.
    if (res.size === st.size && Date.now() - st.mtimeMs >= 2000) {
      etagCache.set(key, res)
      if (etagCache.size > CACHE_MAX) etagCache.delete(etagCache.keys().next().value!)
    }
    return res
  } finally {
    await fh.close()
  }
}

/** Does an If-Match / If-None-Match value name this ETag? `*` matches anything that exists. */
export function listHas(header: string, etag: string): boolean {
  return header.split(',').some((t) => t.trim() === '*' || t.trim() === etag)
}
