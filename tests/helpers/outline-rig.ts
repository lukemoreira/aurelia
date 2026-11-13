// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { openDeviceDb } from '@/storage/device-db'
import { createWorkspace } from '@/storage/create'
import { IdbJournal } from '@/storage/journal'
import { WorkspaceSession } from '@/storage/session'
import { MemoryAdapter } from './memory-adapter'

/** A workspace of one book in memory, an empty journal, and a way to open it again as a new session. */
export async function outlineRig() {
  const adapter = new MemoryAdapter()
  const db = openDeviceDb(new IDBFactory())
  const journal = new IdbJournal(() => db)
  await createWorkspace(adapter, 'My Book')
  const open = () => WorkspaceSession.open(adapter, { journal, debounceMs: 1e9 })
  return { adapter, journal, open, session: await open() }
}

/** Every file with its text. */
export async function snapshot(adapter: MemoryAdapter) {
  const files = new Map<string, string>()
  for (const path of await adapter.list()) files.set(path, (await adapter.read(path))!.text)
  return files
}

/** What changed between two snapshots, as paths with the folder up to the book left off. */
export function changes(before: Map<string, string>, after: Map<string, string>) {
  const short = (p: string) => p.replace(/^universes\/unv_\w+\//, '')
  const names = (list: string[]) => list.map(short).sort()
  return {
    changed: names(
      [...after].filter(([p, t]) => before.has(p) && before.get(p) !== t).map(([p]) => p),
    ),
    added: names([...after.keys()].filter((p) => !before.has(p))),
    removed: names([...before.keys()].filter((p) => !after.has(p))),
  }
}
