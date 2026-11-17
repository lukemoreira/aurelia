// SPDX-License-Identifier: AGPL-3.0-or-later
import { deflateRawSync } from 'node:zlib'
import { crc32 } from '../../src/storage/zip'

export interface MadeEntry {
  path: string
  data: string | Uint8Array
  /** Deflate it the way other tools do (the default), or store it. */
  method?: 'deflate' | 'store'
  /** Bit 0 of the flags: a password protected entry. */
  encrypted?: boolean
  /** What the entry says its size is, when it should not be true. */
  claimSize?: number
  /** Flip a byte of the data after the CRC is taken. */
  damage?: boolean
}

/** A zip the way other tools make one: deflated entries (or stored ones), a central directory, real CRCs. */
export function makeZip(entries: MadeEntry[]): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const raw = typeof e.data === 'string' ? new TextEncoder().encode(e.data) : e.data
    const packed = e.method === 'store' ? raw : new Uint8Array(deflateRawSync(raw))
    if (e.damage) {
      const at = Math.floor(packed.length / 2)
      packed[at] = packed[at]! ^ 0xff
    }
    const name = new TextEncoder().encode(e.path)
    const method = e.method === 'store' ? 0 : 8
    const flags = 0x0800 | (e.encrypted ? 1 : 0)
    const size = e.claimSize ?? raw.length
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, flags, true)
    local.setUint16(8, method, true)
    local.setUint32(14, crc32(raw), true)
    local.setUint32(18, packed.length, true)
    local.setUint32(22, size, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, packed)
    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, flags, true)
    entry.setUint16(10, method, true)
    entry.setUint32(16, crc32(raw), true)
    entry.setUint32(20, packed.length, true)
    entry.setUint32(24, size, true)
    entry.setUint16(28, name.length, true)
    entry.setUint32(42, offset, true)
    central.push(new Uint8Array(entry.buffer), name)
    offset += 30 + name.length + packed.length
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}
