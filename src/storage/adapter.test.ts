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

  it('leaves a file that is not UTF-8 where it is', async () => {
    const adapter = new MemoryAdapter()
    adapter.putBytes('a.md', new Uint8Array([0xff, 0xfe, 0x41]) as Uint8Array<ArrayBuffer>)
    await expect(moveFile(adapter, 'a.md', 'b.md')).rejects.toMatchObject({ code: 'unreadable' })
    expect(await adapter.readBytes('a.md')).not.toBeNull()
    expect(await adapter.readBytes('b.md')).toBeNull()
  })

  it('keeps the original when the copy does not read back the same (a disk that corrupts)', async () => {
    const adapter = new MemoryAdapter({ 'a.md': 'the words' })
    const write = adapter.write.bind(adapter)
    adapter.write = (path, text) =>
      write(path, path === 'b.md' ? `${text} and a flipped bit` : text)
    await expect(moveFile(adapter, 'a.md', 'b.md')).rejects.toMatchObject({ code: 'other' })
    expect((await adapter.read('a.md'))!.text).toBe('the words') // the original is untouched
  })
})
