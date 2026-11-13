// SPDX-License-Identifier: AGPL-3.0-or-later
// This device's IndexedDB: the recovery journal and the list of recent workspaces. Device
// state, never part of a workspace folder (ADR-0003), so two devices never fight over it.

export const JOURNAL = 'journal'
export const RECENT = 'recent'

export function openDeviceDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('aurelia-device', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(JOURNAL, { keyPath: ['workspaceId', 'path'] })
      request.result.createObjectStore(RECENT, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is not available.'))
  })
}

let shared: Promise<IDBDatabase> | undefined
/**
 * The one database the app uses. Tests build their own with `openDeviceDb`. A failed open is
 * not remembered: the next call tries again (a blocked profile may allow it later).
 */
export const deviceDb = () =>
  (shared ??= Promise.resolve()
    .then(() => openDeviceDb())
    .catch((e) => {
      shared = undefined
      throw e
    }))

/** Run one request in its own transaction and wait for it to be stored. */
export function run<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const request = op(tx.objectStore(store))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write failed.'))
  })
}
