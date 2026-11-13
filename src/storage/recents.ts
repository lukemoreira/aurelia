// SPDX-License-Identifier: AGPL-3.0-or-later
import { RECENT, run } from './device-db'

/** A workspace this device has opened. A folder keeps its handle so it can be reopened. */
export interface RecentWorkspace {
  /** The workspace ID (`wsp_…`). Also the directory name for browser storage. */
  key: string
  name: string
  kind: 'folder' | 'browser'
  /** Where it lives, in words. */
  label: string
  lastOpened: number
  handle?: FileSystemDirectoryHandle
}

export class Recents {
  constructor(private db: () => Promise<IDBDatabase>) {}

  /** Newest first. */
  async list(): Promise<RecentWorkspace[]> {
    const all = (await run(await this.db(), RECENT, 'readonly', (s) =>
      s.getAll(),
    )) as RecentWorkspace[]
    return all.sort((a, b) => b.lastOpened - a.lastOpened)
  }

  async get(key: string): Promise<RecentWorkspace | undefined> {
    return (await run(await this.db(), RECENT, 'readonly', (s) => s.get(key))) as
      RecentWorkspace | undefined
  }

  async put(entry: RecentWorkspace) {
    await run(await this.db(), RECENT, 'readwrite', (s) => s.put(entry))
  }

  async remove(key: string) {
    await run(await this.db(), RECENT, 'readwrite', (s) => s.delete(key))
  }
}
