// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { FakeDirectory } from '../../tests/helpers/fake-directory'
import { ADAPTER_CONTRACT } from './contract'
import { HandleAdapter } from './handle-adapter'

const adapterOver = (dir = new FakeDirectory()) =>
  new HandleAdapter(dir.asHandle(), 'folder', 'the folder')

// The same contract the in-memory adapter passes; Playwright runs it again on real OPFS.
describe('adapter contract: directory handle', () => {
  for (const c of ADAPTER_CONTRACT)
    it(c.name, async () => {
      await c.run(async () => adapterOver())
    })
})

describe('HandleAdapter on a folder', () => {
  it('refuses text that is not UTF-8 instead of showing it', async () => {
    const dir = new FakeDirectory()
    dir.seed('bad.md', '')
    const file = await dir.getFileHandle('bad.md')
    const w = await file.createWritable()
    await w.write(new Uint8Array([0xff, 0xfe, 0x41]))
    await w.close()
    await expect(adapterOver(dir).read('bad.md')).rejects.toMatchObject({ code: 'unreadable' })
  })

  it('maps a lost permission to a "permission" error on read and write, and back again', async () => {
    const dir = new FakeDirectory()
    const adapter = adapterOver(dir)
    await adapter.write('a.md', 'x')
    dir.permission = 'prompt'
    expect(await adapter.access()).toBe('prompt')
    await expect(adapter.read('a.md')).rejects.toMatchObject({ code: 'permission' })
    await expect(adapter.write('a.md', 'y')).rejects.toMatchObject({ code: 'permission' })
    expect(await adapter.requestAccess()).toBe(true)
    expect((await adapter.read('a.md'))?.text).toBe('x')
  })

  it('does not take the permission back when the author refuses it', async () => {
    const dir = new FakeDirectory()
    dir.permission = 'prompt'
    dir.refuse = true
    expect(await adapterOver(dir).requestAccess()).toBe(false)
  })

  it('a write that fails before close leaves the old file whole', async () => {
    const dir = new FakeDirectory()
    const adapter = adapterOver(dir)
    await adapter.write('a.md', 'old')
    const file = await dir.getFileHandle('a.md')
    const w = await file.createWritable()
    await w.write(new TextEncoder().encode('half of the new'))
    await w.abort() // the tab died before the swap
    expect((await adapter.read('a.md'))?.text).toBe('old')
  })
})
