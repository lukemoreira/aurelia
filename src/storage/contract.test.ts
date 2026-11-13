// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { ADAPTER_CONTRACT } from './contract'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'

describe('adapter contract: memory', () => {
  for (const c of ADAPTER_CONTRACT)
    it(c.name, async () => {
      await c.run(async () => new MemoryAdapter())
    })

  it('refuses text that is not UTF-8 instead of showing it, so it is never rewritten', async () => {
    const a = new MemoryAdapter()
    a.putBytes('bad.md', new Uint8Array([0xff, 0xfe, 0x41]))
    await expect(a.read('bad.md')).rejects.toMatchObject({ code: 'unreadable' })
    expect(await a.readBytes('bad.md')).toEqual(new Uint8Array([0xff, 0xfe, 0x41]))
  })
})
