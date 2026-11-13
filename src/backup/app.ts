// SPDX-License-Identifier: AGPL-3.0-or-later
// The app's wiring for backup: the author's own server at /dav/, and this device's state.
import { deviceDb } from '@/storage/device-db'
import { WebDavStore } from '@/storage/remote/webdav-store'
import { regenerateOutlines } from '@/storage/outline-actions'
import type { WorkspaceSession } from '@/storage/session'
import { BackupEngine } from './engine'
import { BackupStore } from './state'

/** The author's own server: same address as the app, so no CORS and the Access login goes along. */
export const server = new WebDavStore()
export const backupState = new BackupStore(deviceDb)

/** The backup engine of an open workspace. It reads the session's saved files and nothing else. */
export const openBackup = (session: WorkspaceSession) =>
  BackupEngine.open({
    source: {
      id: session.data.workspace.id,
      name: () => session.data.workspace.name,
      adapter: session.adapter,
      flush: () => session.flush(),
      blocked: () => session.view().readOnly, // read-only, or settling after a tab took over
      subscribe: (fn) => session.subscribe(fn),
      apply: (changes) => session.applyRemote(changes),
      regenerate: () => regenerateOutlines(session),
    },
    store: server,
    state: backupState,
  })
