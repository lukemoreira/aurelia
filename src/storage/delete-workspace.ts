// SPDX-License-Identifier: AGPL-3.0-or-later
// Deleting a workspace from this device. A browser workspace is removed from the browser's storage;
// a folder workspace is only taken off the list, and its folder is never touched.
import type { StorageAdapter } from './adapter'
import { StorageError } from './errors'
import { zipWorkspace } from './export-copy'
import { hashText } from './hash'
import type { IdbJournal } from './journal'
import { loadWorkspace } from './load'
import type { RecentWorkspace, Recents } from './recents'
import { copyPathFor } from './paths'
import { workspaceLockName, type SessionView } from './session'

export interface DeleteDeps {
  recents: Pick<Recents, 'get' | 'remove'>
  journal: Pick<IdbJournal, 'clear' | 'list'>
  /** This device's backup state for the workspace (never the backup on the server). */
  backup: { clear(workspaceId: string): Promise<void> }
  /** Remove the browser-storage directory of this workspace ID, recursively. */
  removeDirectory(id: string): Promise<void>
  /** `navigator.locks`; missing where the browser has none, and then there is nothing to check. */
  locks?: LockManager
  /** Let this tab's open session of the workspace go (and refuse when it holds unsaved work). */
  release?(id: string): Promise<void>
  /** The workspace is gone: drop what points at it (the "reopen last" pointer). */
  forget?(id: string): void
}

export const closeOtherTab = (name: string) =>
  `Close the other tab that has ${name} open, then try again.`

/** Why a workspace open in this tab cannot be deleted yet, in plain words; null when it can. */
export function releaseBlock(view: SessionView): string | null {
  if (view.otherTab) return closeOtherTab(view.name)
  if (view.save.kind !== 'saved' || view.conflicts.length || view.journalFailed || view.settling)
    return `${view.name} has changes that are not saved yet. Open it, let it finish saving or settle the conflict, then try again.`
  return null
}

/**
 * Words that only the recovery journal holds, as files to put in a copy (path → text). Judged as the
 * save pipeline's `recover()` judges them: a file that already has the words needs nothing, a file
 * still as the journal found it takes them, and a file that changed meanwhile stays as it is while the
 * journal's words go beside it in an "Aurelia copy" file, so neither version is lost.
 */
export async function unsavedWords(
  journal: Pick<IdbJournal, 'list'>,
  adapter: StorageAdapter,
  id: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const e of await journal.list(id)) {
    const diskHash = (await adapter.read(e.path))?.hash ?? null
    if (diskHash !== null && diskHash === (await hashText(e.content))) continue // it did get written
    if (diskHash === e.baseHash) out.set(e.path, e.content)
    else {
      let n = 1
      while (out.has(copyPathFor(e.path, n)) || (await adapter.read(copyPathFor(e.path, n)))) n++
      out.set(copyPathFor(e.path, n), e.content)
    }
  }
  return out
}

/** A zip of a workspace that is not open: its files, with what only the journal holds put in. */
export async function copyOfStored(
  adapter: StorageAdapter,
  recent: RecentWorkspace,
  journal: Pick<IdbJournal, 'list'>,
) {
  return zipWorkspace(adapter, recent.name, await unsavedWords(journal, adapter, recent.key))
}

/** The list the row came from may be old: refuse unless the stored entry is still the same kind. */
async function assertSameKind(recent: RecentWorkspace, deps: DeleteDeps) {
  if ((await deps.recents.get(recent.key))?.kind !== recent.kind)
    throw new StorageError('other', `${recent.name} changed since this list was shown. Try again.`)
}

/** What helps tell two workspaces of one name apart. */
export interface Glance {
  books: number
  words: number
}

/** Read a workspace and count it, writing nothing; null when it cannot be read. */
export async function glanceAt(adapter: StorageAdapter): Promise<Glance | null> {
  try {
    const { data } = await loadWorkspace(adapter)
    return { books: data.books.length, words: data.scenes.reduce((n, s) => n + s.words, 0) }
  } catch {
    return null
  }
}

/** Run `work` only while no other tab holds the workspace's lock; refuse otherwise. */
async function whileUnlocked(
  locks: LockManager | undefined,
  recent: RecentWorkspace,
  work: () => Promise<void>,
) {
  if (!locks) return work()
  let started = false
  const run = async (lock: Lock | null) => {
    if (!lock) return
    started = true
    await work()
  }
  try {
    await locks.request(workspaceLockName(recent.key), { ifAvailable: true }, run)
  } catch (e) {
    if (started) throw e
    return work() // the lock manager itself failed: go on, as opening a workspace does
  }
  if (!started) throw new StorageError('other', closeOtherTab(recent.name))
}

/**
 * Delete a workspace kept in this browser. Refuses (changing nothing) when another tab has it open
 * or this tab holds unsaved work in it. Order matters: the directory goes first, so a failure
 * there leaves the journal, the backup state and the list entry in place to try again.
 */
export async function deleteBrowserWorkspace(recent: RecentWorkspace, deps: DeleteDeps) {
  if (recent.kind !== 'browser')
    throw new StorageError('other', 'Only a workspace kept in this browser can be deleted.')
  await assertSameKind(recent, deps) // before this tab's session is closed for a row that is out of date
  await deps.release?.(recent.key)
  await whileUnlocked(deps.locks, recent, async () => {
    await assertSameKind(recent, deps)
    try {
      await deps.removeDirectory(recent.key)
    } catch (e) {
      if (!(e instanceof Error && e.name === 'NotFoundError')) throw e // already gone: clean up the rest
    }
    await deps.journal.clear(recent.key)
    await deps.backup.clear(recent.key)
    await deps.recents.remove(recent.key)
  })
  deps.forget?.(recent.key)
}

/** Take a folder workspace off the list. The folder and every file in it are left alone. */
export async function removeFolderFromList(recent: RecentWorkspace, deps: DeleteDeps) {
  if (recent.kind !== 'folder')
    throw new StorageError('other', 'Only a folder workspace is taken off the list.')
  await assertSameKind(recent, deps)
  await deps.recents.remove(recent.key)
  deps.forget?.(recent.key)
}
