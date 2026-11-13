// SPDX-License-Identifier: AGPL-3.0-or-later
import { BACKUP, run } from '@/storage/device-db'

/** What this device remembers about backing up one workspace. Device state, never in a workspace. */
export interface BackupState {
  key: string
  enabled: boolean
  /** The server folder (`Aurelia/Name (wsp_…)`); fixed once chosen. */
  folder: string | null
  /** The last revision of `backup.json` this device wrote. */
  revision: number
  /** Hash of each file as it is in `current/`: what still has to go is what differs from the disk. */
  uploaded: Record<string, string>
  /** `backup.json` was claimed (`complete: false`) and not yet closed: look at the server again even if no file changed. */
  claimOpen?: boolean
  lastBackup: number | null
  lastVersion: number | null
  /** A version is owed: why. `hourly` has no mark in its name. */
  versionDue: string | null
}

export interface Device {
  id: string
  name: string
}

const emptyState = (workspaceId: string): BackupState => ({
  key: `ws:${workspaceId}`,
  enabled: false,
  folder: null,
  revision: 0,
  uploaded: {},
  lastBackup: null,
  lastVersion: null,
  versionDue: null,
})

/** "Chrome on macOS": enough for the author to tell their devices apart. */
export function deviceNameFrom(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser'
  const os = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'a device'
  return `${browser} on ${os}`
}

export class BackupStore {
  constructor(
    private db: () => Promise<IDBDatabase>,
    private userAgent = () => navigator.userAgent,
  ) {}

  /** This browser's identity, made on first use. */
  async device(): Promise<Device> {
    const db = await this.db()
    const found = (await run(db, BACKUP, 'readonly', (s) => s.get('device'))) as
      (Device & { key: string }) | undefined
    if (found) return { id: found.id, name: found.name }
    const made = { key: 'device', id: crypto.randomUUID(), name: deviceNameFrom(this.userAgent()) }
    await run(db, BACKUP, 'readwrite', (s) => s.put(made))
    return { id: made.id, name: made.name }
  }

  async load(workspaceId: string): Promise<BackupState> {
    const found = (await run(await this.db(), BACKUP, 'readonly', (s) =>
      s.get(`ws:${workspaceId}`),
    )) as BackupState | undefined
    return found ?? emptyState(workspaceId)
  }

  /** Forget a workspace's backup state: it starts again with backup off. */
  async clear(workspaceId: string): Promise<void> {
    await run(await this.db(), BACKUP, 'readwrite', (s) => s.delete(`ws:${workspaceId}`))
  }

  async save(state: BackupState): Promise<void> {
    await run(await this.db(), BACKUP, 'readwrite', (s) => s.put(state))
  }
}
