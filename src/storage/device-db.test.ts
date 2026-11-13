// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
})
