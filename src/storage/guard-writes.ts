// SPDX-License-Identifier: AGPL-3.0-or-later
import type { StorageAdapter } from './adapter'
import { StorageError } from './errors'

/**
 * The same adapter, except that every write and removal is refused while `isReadOnly()`.
 * A workspace from a newer Aurelia is opened through this, so no code path — a save, a copy,
 * a reconcile — can write to it, whatever the screen above forgot to check (ADR-0003 rule 5).
 */
export function guardWrites(adapter: StorageAdapter, isReadOnly: () => boolean): StorageAdapter {
  const refuse = () => {
    throw new StorageError('read-only', 'This workspace is read-only, so nothing was changed.')
  }
  return {
    get kind() {
      return adapter.kind
    },
    get label() {
      return adapter.label
    },
    list: (opts) => adapter.list(opts),
    read: (path) => adapter.read(path),
    readBytes: (path) => adapter.readBytes(path),
    write: async (path, text) => {
      if (isReadOnly()) refuse()
      return adapter.write(path, text)
    },
    remove: async (path) => {
      if (isReadOnly()) refuse()
      return adapter.remove(path)
    },
    access: () => adapter.access(),
    requestAccess: () => adapter.requestAccess(),
  }
}
