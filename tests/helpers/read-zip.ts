// SPDX-License-Identifier: AGPL-3.0-or-later
import { crc32 } from '../../src/storage/zip'

/** Read a stored zip back: names, bytes and whether each CRC matches. */
export function readZip(buf: Uint8Array) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const count = view.getUint16(buf.length - 22 + 10, true)
  let at = view.getUint32(buf.length - 22 + 16, true)
  const out: { path: string; text: string; crcOk: boolean }[] = []
  for (let i = 0; i < count; i++) {
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 20, true)
    const nameLen = view.getUint16(at + 28, true)
    const local = view.getUint32(at + 42, true)
    const path = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen))
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = buf.subarray(start, start + size)
    out.push({ path, text: new TextDecoder().decode(data), crcOk: crc32(data) === crc })
    at += 46 + nameLen
  }
  return out
}
