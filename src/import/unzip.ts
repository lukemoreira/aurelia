// SPDX-License-Identifier: AGPL-3.0-or-later
// Read a zip made by any tool (ADR-0014). Other tools deflate their entries; the browser inflates them
// itself (`DecompressionStream('deflate-raw')`), so there is no library. Nothing is trusted: sizes are
// checked before and while inflating (a zip that says "small" and inflates huge is stopped), a
// name that leaves its folder is not read, and the CRC of every file is checked.
import { crc32 } from '@/storage/zip'
import { hiddenPart, isNoise, isReadable } from './files'
import { ImportError, ImportLimit, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, mb } from './limits'

export interface ZipItem {
  path: string
  /** The size it says it has once read. */
  size: number
  read: () => Promise<Uint8Array<ArrayBuffer>>
}

export interface ZipListing {
  items: ZipItem[]
  /** Entries that cannot be read, with the reason. */
  skipped: { path: string; reason: string }[]
}

const notZip = () => new ImportError('That is not a zip file Aurelia can read.')

/** Inflate raw deflate data, giving up as soon as it passes `limit` bytes. */
async function inflate(
  data: Uint8Array<ArrayBuffer>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      throw new ImportError(`it is larger than ${mb(MAX_FILE_BYTES)}`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** A name inside a zip as a safe relative path: `/` between folders, nothing that climbs out. Null: not safe. */
function safePath(name: string): string | null {
  const parts = name.replace(/\\/g, '/').split('/')
  if (parts.some((p) => p === '..') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null
  return parts.filter((p) => p && p !== '.').join('/')
}

/** The entries of a zip. Throws an `ImportError` for what is not a zip, or is too big to read. */
export function listZip(buf: Uint8Array): ZipListing {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let end = buf.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0) throw notZip()
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  if (count === 0xffff || at === 0xffffffff)
    throw new ImportLimit('That zip is too large for Aurelia to read (it uses the zip64 form).')
  const items: ZipItem[] = []
  const skipped: ZipListing['skipped'] = []
  let readable = 0
  // Only what an import would read counts toward the limits: not the objects of a hidden folder, not the images.
  let total = 0
  const decoder = new TextDecoder('utf-8')
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || view.getUint32(at, true) !== 0x02014b50) throw notZip()
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const crc = view.getUint32(at + 16, true)
    const packed = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const next =
      at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const raw = decoder.decode(buf.subarray(at + 46, at + 46 + nameLength))
    at = next
    if (raw.endsWith('/')) continue // a folder
    const path = safePath(raw)
    if (!path) {
      skipped.push({ path: raw, reason: 'its name leads outside the zip' })
      continue
    }
    if (flags & 1) {
      skipped.push({ path, reason: 'it is password protected' })
      continue
    }
    if (method !== 0 && method !== 8) {
      skipped.push({ path, reason: 'it is compressed in a way Aurelia cannot read' })
      continue
    }
    const counted = !isNoise(path) && !hiddenPart(path) && isReadable(path)
    if (counted && ++readable > MAX_FILES)
      throw new ImportLimit(
        `That zip holds more than ${MAX_FILES} files, more than Aurelia reads at once.`,
      )
    if (counted) total += size
    if (total > MAX_TOTAL_BYTES)
      throw new ImportLimit(
        `That zip holds more than ${mb(MAX_TOTAL_BYTES)} of files, more than Aurelia reads at once.`,
      )
    const read = async (): Promise<Uint8Array<ArrayBuffer>> => {
      if (local + 30 > buf.length || view.getUint32(local, true) !== 0x04034b50)
        throw new ImportError('it is damaged')
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const packedBytes = buf.slice(start, start + packed) as Uint8Array<ArrayBuffer>
      if (packedBytes.length !== packed) throw new ImportError('it is cut short')
      const data =
        method === 0
          ? (packedBytes.slice() as Uint8Array<ArrayBuffer>)
          : await inflate(packedBytes, Math.min(size, MAX_FILE_BYTES) + 1).catch((e) => {
              throw e instanceof ImportError ? e : new ImportError('it is damaged')
            })
      if (data.length !== size || crc32(data) !== crc) throw new ImportError('it is damaged')
      return data
    }
    items.push({ path, size, read })
  }
  return { items, skipped }
}
