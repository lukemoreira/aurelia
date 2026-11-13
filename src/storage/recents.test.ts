// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openDeviceDb } from './device-db'
import { Recents, type RecentWorkspace } from './recents'

const entry = (key: string, lastOpened: number): RecentWorkspace => ({
  key,
  name: key,
  kind: 'browser',
  label: 'this browser',
  lastOpened,
})

describe('recent workspaces', () => {
  it('lists the newest first, replaces one opened again, and forgets one', async () => {
    const db = openDeviceDb(new IDBFactory())
    const recents = new Recents(() => db)
    await recents.put(entry('wsp_a', 1))
    await recents.put(entry('wsp_b', 3))
    await recents.put(entry('wsp_c', 2))
    expect((await recents.list()).map((r) => r.key)).toEqual(['wsp_b', 'wsp_c', 'wsp_a'])
    await recents.put({ ...entry('wsp_a', 9), name: 'Renamed' })
    expect((await recents.list())[0]).toMatchObject({ key: 'wsp_a', name: 'Renamed' })
    expect(await recents.get('wsp_c')).toMatchObject({ lastOpened: 2 })
    await recents.remove('wsp_a')
    expect(await recents.get('wsp_a')).toBeUndefined()
  })
})
