// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { moveFile } from './adapter'

describe('moveFile', () => {
  it('moves a file with a byte order mark byte for byte', async () => {
    const adapter = new MemoryAdapter()
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]) as Uint8Array<ArrayBuffer>
    adapter.putBytes('a.md', bytes)
    await moveFile(adapter, 'a.md', 'b.md')
    expect(await adapter.readBytes('a.md')).toBeNull()
    expect([...(await adapter.readBytes('b.md'))!]).toEqual([...bytes])
  })

  it('moves bytes that are not text (an image) byte for byte', async () => {
    const adapter = new MemoryAdapter()
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x80]) as Uint8Array<ArrayBuffer>
    adapter.putBytes('media/med_a.png', bytes)
    await moveFile(adapter, 'media/med_a.png', 'trash/media/med_a.png')
    expect(await adapter.readBytes('media/med_a.png')).toBeNull()
    expect([...(await adapter.readBytes('trash/media/med_a.png'))!]).toEqual([...bytes])
  })

  it('keeps the original when the copy does not read back the same (a disk that corrupts)', async () => {
    const adapter = new MemoryAdapter({ 'a.md': 'the words' })
    const write = adapter.writeBytes.bind(adapter)
    adapter.writeBytes = (path, bytes) =>
      write(path, path === 'b.md' ? new Uint8Array([...bytes, 1]) : bytes)
    await expect(moveFile(adapter, 'a.md', 'b.md')).rejects.toMatchObject({ code: 'other' })
    expect((await adapter.read('a.md'))!.text).toBe('the words') // the original is untouched
  })
})
