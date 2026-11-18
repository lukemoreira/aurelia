// SPDX-License-Identifier: AGPL-3.0-or-later
// Each workspace's chat with the assistant, kept on this device so a reload does not lose it. Device
// state (ADR-0003), never part of the workspace folder and never sent anywhere: only the turns' words,
// tool labels and errors. It lives in the device database's key-value store beside the backup state,
// so no database upgrade is needed (an older tab could not open the database after one).
import { BACKUP, deviceDb, run } from '@/storage/device-db'

export interface ChatTurn {
  role: 'author' | 'assistant'
  text: string
  /** The assistant's activity, one line per tool call ("Read 6.3 The Customs House"). */
  tools: string[]
  error?: string
  /** The answer was still arriving: restored after a reload, it reads as stopped. */
  pending?: boolean
}

/** How many turns are kept; the oldest go first. */
export const CHAT_KEPT = 50
export const STOPPED = 'Stopped: the page was reloaded before the answer finished.'

const key = (workspaceId: string) => `chat:${workspaceId}`

export class ChatStore {
  /** Workspaces deleted from this device: an answer still arriving must not write their chat back. */
  private deleted = new Set<string>()
  constructor(private db: () => Promise<IDBDatabase>) {}

  /** Opening a workspace (one restored with a deleted one's ID too) lets its chat be kept again. */
  async load(workspaceId: string): Promise<ChatTurn[]> {
    this.deleted.delete(workspaceId)
    const found = (await run(await this.db(), BACKUP, 'readonly', (s) =>
      s.get(key(workspaceId)),
    )) as { turns?: ChatTurn[] } | undefined
    return (found?.turns ?? []).map(({ pending, ...t }) =>
      pending ? { ...t, error: t.error ?? STOPPED } : t,
    )
  }

  /** Plain copies: a Vue proxy cannot be stored. */
  async save(workspaceId: string, turns: ChatTurn[]): Promise<void> {
    if (this.deleted.has(workspaceId)) return
    const kept = turns.slice(-CHAT_KEPT).map((t) => ({ ...t, tools: [...t.tools] }))
    await run(await this.db(), BACKUP, 'readwrite', (s) =>
      s.put({ key: key(workspaceId), turns: kept }),
    )
  }

  async clear(workspaceId: string): Promise<void> {
    await run(await this.db(), BACKUP, 'readwrite', (s) => s.delete(key(workspaceId)))
  }

  /** Every workspace's chat on this device (signing out of Claude Code). */
  async clearAll(): Promise<void> {
    await run(await this.db(), BACKUP, 'readwrite', (s) =>
      s.delete(IDBKeyRange.bound('chat:', 'chat:\uffff')),
    )
  }

  /** The workspace is deleted from this device (or taken off the list): its chat goes, and nothing writes it again. */
  async forget(workspaceId: string): Promise<void> {
    this.deleted.add(workspaceId)
    await this.clear(workspaceId)
  }
}

/** The one the app uses. Tests build their own. */
export const chatStore = new ChatStore(deviceDb)
