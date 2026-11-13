// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { wordsFor } from './errors'
import { openDeviceDb } from './device-db'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('the device database', () => {
  it('does not remember a failed open: the next call tries again', async () => {
    vi.resetModules()
    vi.stubGlobal('indexedDB', undefined) // no IndexedDB at all
    const { deviceDb } = await import('./device-db')
    await expect(deviceDb()).rejects.toThrow()
    vi.stubGlobal('indexedDB', new IDBFactory())
    await expect(deviceDb()).resolves.toBeDefined()
  })

  /** An old tab: version 1 of the database, held open. */
  const oldTab = (factory: IDBFactory) =>
    new Promise<IDBDatabase>((resolve) => {
      const request = factory.open('aurelia-device', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('journal', { keyPath: 'k' })
      request.onsuccess = () => resolve(request.result)
    })

  it('an upgrade that an old tab holds up says so, instead of hanging', async () => {
    const factory = new IDBFactory()
    const old = await oldTab(factory) // never lets go
    const error = await openDeviceDb(factory).then(
      () => null,
      (e) => e,
    )
    expect(wordsFor(error)).toBe('Close your other Aurelia tabs and try again.')
    old.close()
  })

  it('lets go of the database when another tab needs to upgrade it, and says it did', async () => {
    const factory = new IDBFactory()
    const onClosed = vi.fn()
    const db = await openDeviceDb(factory, onClosed)
    const newer = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('aurelia-device', 3) // a newer Aurelia
      request.onsuccess = () => resolve(request.result)
      request.onblocked = () => reject(new Error('blocked: the old connection held on'))
    })
    expect(onClosed).toHaveBeenCalledOnce()
    expect(() => db.transaction('journal')).toThrow() // closed
    newer.close()
  })
})
