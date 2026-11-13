// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { FakeDirectory } from '../../tests/helpers/fake-directory'
import { reconnect, reopen } from './app'
import type { RecentWorkspace } from './recents'

const folder = (dir: FakeDirectory): RecentWorkspace => ({
  key: 'wsp_aaaaaaaaaa',
  name: 'Winter 1709',
  kind: 'folder',
  label: 'the folder “History”',
  lastOpened: 1,
  handle: dir.asHandle(),
})

describe('reopening a recent workspace', () => {
  it('opens a folder the browser still trusts, without asking the author', async () => {
    expect(await reopen(folder(new FakeDirectory()))).toHaveProperty('adapter')
  })

  it('says a folder needs the author’s OK after a reload, then reconnects on a click', async () => {
    const dir = new FakeDirectory()
    dir.permission = 'prompt'
    expect(await reopen(folder(dir))).toEqual({ needsAccess: true })
    expect(await reconnect(folder(dir))).not.toBeNull()
    expect(await reopen(folder(dir))).toHaveProperty('adapter')
  })

  it('does not reconnect a folder the author refuses', async () => {
    const dir = new FakeDirectory()
    dir.permission = 'prompt'
    dir.refuse = true
    expect(await reconnect(folder(dir))).toBeNull()
  })

  it('treats a recent with no folder handle, or browser storage that was cleared, as gone', async () => {
    expect(await reopen({ ...folder(new FakeDirectory()), handle: undefined })).toEqual({
      gone: true,
    })
    expect(await reopen({ ...folder(new FakeDirectory()), kind: 'browser' })).toEqual({
      gone: true,
    })
  })
})
