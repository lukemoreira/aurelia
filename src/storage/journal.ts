// SPDX-License-Identifier: AGPL-3.0-or-later
import { JOURNAL, run } from './device-db'

/**
 * An edit that has not reached its file yet. Written BEFORE the file write and removed only
 * once the write is confirmed, so a killed tab or a failed disk never costs the author words.
 */
export interface JournalEntry {
  workspaceId: string
  path: string
  /** The whole file as it should be. */
  content: string
  /** Hash of the file on disk when the edit started; null when the file did not exist. */
  baseHash: string | null
  time: number
}

export interface Journal {
  put(entry: JournalEntry): Promise<void>
  remove(workspaceId: string, path: string): Promise<void>
  list(workspaceId: string): Promise<JournalEntry[]>
}

export class IdbJournal implements Journal {
  constructor(private db: () => Promise<IDBDatabase>) {}

  async put(entry: JournalEntry) {
    await run(await this.db(), JOURNAL, 'readwrite', (s) => s.put(entry))
  }

  async remove(workspaceId: string, path: string) {
    await run(await this.db(), JOURNAL, 'readwrite', (s) => s.delete([workspaceId, path]))
  }

  async list(workspaceId: string) {
    const all = await run(await this.db(), JOURNAL, 'readonly', (s) => s.getAll())
    return (all as JournalEntry[]).filter((e) => e.workspaceId === workspaceId)
  }
}
