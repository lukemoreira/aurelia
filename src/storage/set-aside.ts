// SPDX-License-Identifier: AGPL-3.0-or-later
// Files Aurelia puts out of the way and never deletes: a deleted item waits in `.aurelia/trash/`
// until it is restored, and the file not kept in a duplicate-ID choice goes to `.aurelia/conflicts/`.
// Every step moves a file by copying it, checking the copy reads back the same, and only then
// removing the original (`moveFile`), so a stop at any point loses nothing and leaves a state the
// app can show: the file is in its place, in the trash, or (for an instant) in both.
import { z } from 'zod'
import { moveFile, type StorageAdapter } from './adapter'
import { StorageError } from './errors'
import { TRASH_DIR, bookPath, classify, conflictsPathFor, stampOf, trashPathFor } from './paths'
import type { WorkspaceSession } from './session'

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  /** What the author sees in "Recently deleted": "Chapter 3 · The Gate". */
  label: z.string(),
  /** scene, chapter, part, book or record. */
  kind: z.string(),
  deletedAt: z.string(),
  /** Every file the delete meant to move, by its path in the workspace. */
  files: z.array(z.string()),
})
type Manifest = z.infer<typeof manifestSchema>

export interface TrashEntry extends Manifest {
  stamp: string
  /** Of `files`, the ones that are in the trash now (a stop half way leaves the rest in place). */
  waiting: string[]
}

const KIND_WORD: Record<string, string> = {
  scene: 'Scene',
  chapter: 'Chapter',
  part: 'Part',
  book: 'Book',
  record: 'Record',
}

/** What a deleted thing was, in the author's words: "Chapter · 3 scenes" (never how many files). */
export function describeEntry(entry: Pick<TrashEntry, 'kind' | 'waiting'>): string {
  const count = (folder: string) => entry.waiting.filter((p) => p.includes(`/${folder}/`)).length
  const many = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const parts = [KIND_WORD[entry.kind] ?? 'Item']
  if (entry.kind === 'book' && count('chapters')) parts.push(many(count('chapters'), 'chapter'))
  if ((entry.kind === 'book' || entry.kind === 'chapter') && count('scenes'))
    parts.push(many(count('scenes'), 'scene'))
  return parts.join(' · ')
}

const manifestPath = (stamp: string) => `${TRASH_DIR}/${stamp}/manifest.json`

/**
 * Move files to the trash, after the unsaved words in them are saved. The manifest goes in
 * first, so even a stop half way is a delete the app can list and restore. Returns its stamp.
 */
export async function moveToTrash(
  s: WorkspaceSession,
  item: { label: string; kind: string; paths: string[] },
): Promise<string> {
  await s.flushPaths(item.paths)
  if (item.paths.some((p) => s.pipeline.isBusy(p)))
    throw new StorageError('other', 'Aurelia is still saving that. Try again in a moment.')
  let stamp = stampOf(new Date())
  for (let n = 2; await s.adapter.readBytes(manifestPath(stamp)); n++)
    stamp = `${stampOf(new Date())}-${n}`
  const manifest: Manifest = {
    schemaVersion: 1,
    label: item.label,
    kind: item.kind,
    deletedAt: new Date().toISOString(),
    files: item.paths,
  }
  await s.adapter.write(manifestPath(stamp), `${JSON.stringify(manifest, null, 2)}\n`)
  // Words typed while the files move are not lost: nothing is written to the old places meanwhile,
  // and what was typed goes into the trashed copy, so a restore brings it back.
  s.pipeline.hold(item.paths)
  try {
    for (const path of item.paths) await moveFile(s.adapter, path, trashPathFor(path, stamp))
    for (const path of item.paths) {
      const typed = s.pipeline.pendingText(path)
      if (typed === undefined) continue
      await s.adapter.write(trashPathFor(path, stamp), typed)
      s.pipeline.discard(path)
    }
    s.forget(item.paths)
  } finally {
    s.pipeline.release(item.paths)
  }
  return stamp
}

/** What is waiting in the trash, newest first. A delete that stopped before moving anything is not listed. */
export async function listTrash(adapter: StorageAdapter): Promise<TrashEntry[]> {
  const all = await adapter.list()
  const inTrash = new Set(all.filter((p) => p.startsWith(`${TRASH_DIR}/`)))
  const entries: TrashEntry[] = []
  for (const path of inTrash) {
    const stamp = /^\.aurelia\/trash\/([^/]+)\/manifest\.json$/.exec(path)?.[1]
    if (!stamp) continue
    try {
      const found = await adapter.read(path)
      const manifest = manifestSchema.parse(JSON.parse(found?.text ?? ''))
      const waiting = manifest.files.filter((f) => inTrash.has(trashPathFor(f, stamp)))
      if (waiting.length) entries.push({ ...manifest, stamp, waiting })
    } catch {
      // A manifest that does not read is left alone, never deleted.
    }
  }
  return entries.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0))
}

/**
 * Put a deleted item back where it was. A file whose place has been taken is left in the trash
 * (and named), never written over. Returns what came back and what stayed.
 */
export async function moveBack(
  s: WorkspaceSession,
  stamp: string,
): Promise<{ restored: string[]; skipped: string[] }> {
  const entry = (await listTrash(s.adapter)).find((e) => e.stamp === stamp)
  if (!entry) throw new StorageError('other', 'That is no longer in the trash.')
  // A chapter or scene needs its book: with the book still in the trash it would come back shown nowhere.
  for (const path of entry.waiting) {
    const kind = classify(path)
    if (!('book' in kind) || kind.kind === 'book' || kind.kind === 'outline') continue
    const book = bookPath(kind.universe, kind.book)
    if (!entry.waiting.includes(book) && !(await s.adapter.readBytes(book)))
      throw new StorageError(
        'other',
        'Its book is in Recently deleted too. Put the book back first, then this.',
      )
  }
  const restored: string[] = []
  const skipped: string[] = []
  for (const path of entry.waiting) {
    if (await s.adapter.readBytes(path)) skipped.push(path)
    else {
      await moveFile(s.adapter, trashPathFor(path, stamp), path)
      restored.push(path)
    }
  }
  if (!skipped.length) await s.adapter.remove(manifestPath(stamp))
  return { restored, skipped }
}

/**
 * Two or more files carry one ID and the author chose to keep `keepPath`: the others go to
 * `.aurelia/conflicts/`, never deleted. Returns where they went.
 */
export async function keepOne(
  s: WorkspaceSession,
  id: string,
  keepPath: string,
): Promise<string[]> {
  const found = s.view().duplicates.find((d) => d.id === id)
  if (!found?.files.some((f) => f.path === keepPath))
    throw new StorageError('other', 'Those files have already been sorted out.')
  const others = found.files.map((f) => f.path).filter((p) => p !== keepPath)
  await s.flushPaths(others)
  if (others.some((p) => s.pipeline.isBusy(p)))
    throw new StorageError('other', 'Aurelia is still saving one of them. Try again in a moment.')
  const now = new Date()
  const moved: string[] = []
  for (const path of others) {
    const to = conflictsPathFor(path, now)
    await moveFile(s.adapter, path, to)
    moved.push(to)
  }
  await s.refresh()
  return moved
}
