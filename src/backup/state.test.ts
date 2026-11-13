// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { JOURNAL, RECENT, openDeviceDb } from '@/storage/device-db'
import { IdbJournal } from '@/storage/journal'
import { BackupStore, deviceNameFrom } from './state'

describe('backup state', () => {
  it('gives this browser one identity and remembers it', async () => {
    const db = openDeviceDb(new IDBFactory())
    const a = new BackupStore(
      () => db,
      () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130 Safari/537',
    )
    const first = await a.device()
    expect(first.name).toBe('Chrome on macOS')
    expect(await new BackupStore(() => db).device()).toEqual(first)
  })

  it('names devices in a way their author can tell apart', () => {
    expect(deviceNameFrom('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Edg/130')).toBe(
      'Edge on Windows',
    )
    expect(deviceNameFrom('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Firefox/130')).toBe(
      'Firefox on Linux',
    )
    expect(deviceNameFrom('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604')).toBe(
      'Safari on iOS',
    )
    expect(deviceNameFrom('')).toBe('Browser on a device')
  })

  it('keeps each workspace’s state apart, and starts every one switched off', async () => {
    const db = openDeviceDb(new IDBFactory())
    const store = new BackupStore(() => db)
    const fresh = await store.load('wsp_a')
    expect(fresh).toMatchObject({ enabled: false, folder: null, revision: 0, uploaded: {} })
    await store.save({
      ...fresh,
      enabled: true,
      folder: 'Aurelia/A (wsp_a)',
      uploaded: { 'a.md': 'h' },
    })
    expect((await store.load('wsp_a')).uploaded).toEqual({ 'a.md': 'h' })
    expect((await store.load('wsp_b')).enabled).toBe(false)
  })

  it('upgrading the device database from the first version keeps the journal and the recent list', async () => {
    const factory = new IDBFactory()
    // The database as M2 made it: version 1, no backup store.
    const v1 = await new Promise<IDBDatabase>((resolve) => {
      const r = factory.open('aurelia-device', 1)
      r.onupgradeneeded = () => {
        r.result.createObjectStore(JOURNAL, { keyPath: ['workspaceId', 'path'] })
        r.result.createObjectStore(RECENT, { keyPath: 'key' })
      }
      r.onsuccess = () => resolve(r.result)
    })
    await new IdbJournal(async () => v1).put({
      workspaceId: 'wsp_a',
      path: 'a.md',
      content: 'unsaved words',
      baseHash: null,
      time: 1,
    })
    v1.close()
    const db = openDeviceDb(factory)
    expect(await new IdbJournal(() => db).list('wsp_a')).toHaveLength(1)
    expect((await new BackupStore(() => db).load('wsp_a')).enabled).toBe(false)
  })

  it('forgets a workspace’s state on request, and only that workspace’s', async () => {
    const db = openDeviceDb(new IDBFactory())
    const store = new BackupStore(() => db)
    for (const id of ['wsp_a', 'wsp_b'])
      await store.save({ ...(await store.load(id)), enabled: true, folder: `Aurelia/${id}` })
    await store.clear('wsp_a')
    expect(await store.load('wsp_a')).toMatchObject({ enabled: false, folder: null })
    expect((await store.load('wsp_b')).enabled).toBe(true)
  })
})
