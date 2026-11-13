// SPDX-License-Identifier: AGPL-3.0-or-later
// The app's wiring: the real journal, the recent list and the browser's storage, in one place.
import type { StorageAdapter } from './adapter'
import { browserAdapter, browserDirectory, isPersisted, requestPersistence } from './browser'
import { deviceDb } from './device-db'
import { HandleAdapter } from './handle-adapter'
import { IdbJournal } from './journal'
import { WORKSPACE_FILE } from './paths'
import { Recents, type RecentWorkspace } from './recents'
import { WorkspaceSession } from './session'

export const recents = new Recents(deviceDb)
const journal = new IdbJournal(deviceDb)

/** Open a workspace for real: read it, finish what the journal holds, and remember it as recent. */
export async function openSession(adapter: StorageAdapter): Promise<WorkspaceSession> {
  const session = await WorkspaceSession.open(adapter, {
    journal,
    persist: requestPersistence,
    isPersisted,
    locks: navigator.locks, // undefined where the browser has none: every tab may write, as before
  })
  const view = session.view()
  await recents
    .put({
      key: view.workspaceId,
      name: view.name,
      kind: adapter.kind === 'folder' ? 'folder' : 'browser',
      label: adapter.label,
      lastOpened: Date.now(),
      ...(adapter instanceof HandleAdapter && adapter.kind === 'folder'
        ? { handle: adapter.root }
        : {}),
    })
    .catch(() => undefined) // no recent list is no reason to refuse the workspace
  return session
}

/** The ID in a workspace's `aurelia.json`, or null when it cannot be read. */
export async function workspaceIdOf(adapter: StorageAdapter): Promise<string | null> {
  try {
    const found = await adapter.read(WORKSPACE_FILE)
    const id: unknown = found && JSON.parse(found.text).id
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

export type Reopened = { adapter: StorageAdapter } | { needsAccess: true } | { gone: true }

/** A recent workspace as an adapter, without asking the author for anything. */
export async function reopen(recent: RecentWorkspace): Promise<Reopened> {
  if (recent.kind === 'browser') {
    try {
      return { adapter: browserAdapter(await browserDirectory(recent.key, false)) }
    } catch {
      return { gone: true }
    }
  }
  const handle = recent.handle
  if (!handle) return { gone: true }
  const adapter = new HandleAdapter(handle, 'folder', recent.label)
  return (await adapter.access()) === 'granted' ? { adapter } : { needsAccess: true }
}

/** The author clicked "Reconnect folder": ask the browser to trust the folder again. */
export async function reconnect(recent: RecentWorkspace): Promise<StorageAdapter | null> {
  if (!recent.handle) return null
  const adapter = new HandleAdapter(recent.handle, 'folder', recent.label)
  return (await adapter.requestAccess()) ? adapter : null
}
