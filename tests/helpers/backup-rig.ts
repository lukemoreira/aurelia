// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { newId } from '@/domain/ids'
import { BackupEngine, type BackupSource } from '@/backup/engine'
import { BackupStore } from '@/backup/state'
import { createWorkspace } from '@/storage/create'
import { openDeviceDb } from '@/storage/device-db'
import { WebDavStore } from '@/storage/remote/webdav-store'
import { FakeDav, davFetch } from './fake-dav'
import { MemoryAdapter } from './memory-adapter'

/** A workspace, a fake server and a backup engine wired together, as the app wires them. */
export async function backupRig(opts: { userAgent?: string; workspaceName?: string } = {}) {
  const id = newId('wsp')
  const dav = new FakeDav()
  const adapter = new MemoryAdapter()
  await createWorkspace(adapter, opts.workspaceName ?? 'My Book', id)
  let blocked = false
  let flushing: () => Promise<void> = async () => undefined
  const listeners = new Set<() => void>()
  const source: BackupSource = {
    id,
    name: () => opts.workspaceName ?? 'My Book',
    adapter,
    flush: () => flushing(),
    blocked: () => blocked,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  const db = openDeviceDb(new IDBFactory())
  const state = new BackupStore(
    () => db,
    () => opts.userAgent ?? 'Chrome/130 Macintosh; Mac OS X',
  )
  let clock = Date.UTC(2026, 10, 12, 18, 30, 0)
  /** Fetch that lets a test step in before a request reaches the server. */
  let before: ((method: string, path: string) => void) | undefined
  const fetchImpl = davFetch(dav)
  const store = new WebDavStore('/dav/', (input, init) => {
    before?.(init?.method ?? 'GET', decodeURIComponent(new URL(input, 'http://app.test').pathname))
    return fetchImpl(input, init)
  })
  const open = (extra: { debounceMs?: number; retryMs?: number[] } = {}) =>
    BackupEngine.open({
      source,
      store,
      state,
      now: () => clock,
      debounceMs: 5,
      retryMs: [5, 5, 5],
      ...extra,
    })
  return {
    dav,
    adapter,
    source,
    store,
    state,
    open,
    /** What a change in the workspace tells the engine (the session's own notification). */
    notify: () => listeners.forEach((fn) => fn()),
    setBlocked: (b: boolean) => (blocked = b),
    /** What the session's `flush()` does: a test can hold it, as a save in flight would. */
    onFlush: (fn: () => Promise<void>) => (flushing = fn),
    advance: (ms: number) => (clock += ms),
    interceptRequests: (fn: typeof before) => (before = fn),
    scenePath: async () => (await adapter.list()).find((p) => /\/scenes\/scn_\w+\.md$/.test(p))!,
    id,
    folder: `Aurelia/${opts.workspaceName ?? 'My Book'} (${id})`,
  }
}
