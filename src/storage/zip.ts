// SPDX-License-Identifier: AGPL-3.0-or-later
import { StorageError } from './errors'

export interface ZipFile {
  path: string
  data: Uint8Array<ArrayBuffer>
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** MS-DOS date and time, which is what zip stores (2-second steps, years from 1980). */
function dosStamp(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * A zip of these files, stored without compression. Plain text compresses well, but a stored
 * zip is valid everywhere, needs no library and is simple enough to check by eye; a workspace
 * is small. File names are UTF-8 (flag bit 11).
 */
export function zipFiles(files: ZipFile[], now = new Date()): Blob {
  if (files.length > 0xffff) throw new Error('Too many files for one zip.')
  const { time, date } = dosStamp(now)
  const names = files.map((f) => new TextEncoder().encode(f.path))
  const parts: BlobPart[] = []
  const central: BlobPart[] = []
  let offset = 0

  files.forEach((file, i) => {
    const name = names[i]!
    const crc = crc32(file.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, file.data.length, true)
    local.setUint32(22, file.data.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    parts.push(local.buffer, name, file.data)

    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true) // made by
    entry.setUint16(6, 20, true) // version needed
    entry.setUint16(8, 0x0800, true)
    entry.setUint16(10, 0, true)
    entry.setUint16(12, time, true)
    entry.setUint16(14, date, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, file.data.length, true)
    entry.setUint32(24, file.data.length, true)
    entry.setUint16(28, name.length, true)
    entry.setUint32(42, offset, true)
    central.push(entry.buffer, name)

    offset += 30 + name.length + file.data.length
  })

  const centralSize = central.reduce<number>(
    (n, p) => n + (p instanceof ArrayBuffer ? p.byteLength : (p as Uint8Array).length),
    0,
  )
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' })
}

export interface ZipEntry {
  path: string
  data: Uint8Array<ArrayBuffer>
  /** The stored CRC-32 matches the bytes: false means the file is damaged. */
  crcOk: boolean
}

/** Read back a zip made by `zipFiles` (stored, not compressed). Anything else is refused. */
export function readZip(buf: Uint8Array): ZipEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const unreadable = () => new StorageError('unreadable', 'That version is not a zip Aurelia made.')
  try {
    let end = buf.length - 22
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
    if (end < 0) throw unreadable()
    const count = view.getUint16(end + 10, true)
    let at = view.getUint32(end + 16, true)
    const out: ZipEntry[] = []
    for (let i = 0; i < count; i++) {
      if (view.getUint32(at, true) !== 0x02014b50 || view.getUint16(at + 10, true) !== 0)
        throw unreadable()
      const crc = view.getUint32(at + 16, true)
      const size = view.getUint32(at + 20, true)
      const nameLength = view.getUint16(at + 28, true)
      const local = view.getUint32(at + 42, true)
      const path = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLength))
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const data = buf.slice(start, start + size) as Uint8Array<ArrayBuffer>
      if (data.length !== size) throw unreadable()
      out.push({ path, data, crcOk: crc32(data) === crc })
      at += 46 + nameLength
    }
    return out
  } catch (e) {
    throw e instanceof StorageError ? e : unreadable()
  }
}
