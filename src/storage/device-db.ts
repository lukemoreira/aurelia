// SPDX-License-Identifier: AGPL-3.0-or-later
// This device's IndexedDB: the recovery journal and the list of recent workspaces. Device
// state, never part of a workspace folder (ADR-0003), so two devices never fight over it.
import { StorageError } from './errors'

export const JOURNAL = 'journal'
export const RECENT = 'recent'
/** Backup state per workspace, and this device's identity (ADR-0009). */
export const BACKUP = 'backup'

/** An upgrade waits for every older tab to let go of the database: say so, instead of hanging. */
const BLOCKED = 'Close your other Aurelia tabs and try again.'

/**
 * `onClosed` runs when another tab needs to upgrade the database: this connection lets go of it
 * (so that tab is never held up by this one) and the caller drops what it cached.
 */
export function openDeviceDb(
  factory: IDBFactory = indexedDB,
  onClosed?: () => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('aurelia-device', 2)
    let failed = false
    request.onupgradeneeded = (event) => {
      const db = request.result
      if (event.oldVersion < 1) {
        db.createObjectStore(JOURNAL, { keyPath: ['workspaceId', 'path'] })
        db.createObjectStore(RECENT, { keyPath: 'key' })
      }
      if (event.oldVersion < 2) db.createObjectStore(BACKUP, { keyPath: 'key' })
    }
    request.onblocked = () => {
      failed = true
      reject(new StorageError('other', BLOCKED))
    }
    request.onsuccess = () => {
      const db = request.result
      if (failed) return db.close() // the other tab let go later: nobody is waiting for this one
      db.onversionchange = () => {
        db.close()
        onClosed?.()
      }
      resolve(db)
    }
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
    .then(() => openDeviceDb(indexedDB, () => (shared = undefined)))
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
