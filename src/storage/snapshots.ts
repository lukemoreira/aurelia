// SPDX-License-Identifier: AGPL-3.0-or-later
// Snapshots (ADR-0013): a scene or a whole book as it was at one moment, kept as plain files in
// `.aurelia/snapshots/snp_…/`. A snapshot is never changed after it is made, so it never conflicts
// in a sync, and is never written over: its folder is new every time.
import { z } from 'zod'
import { newId } from '@/domain/ids'
import { StorageError } from './errors'
import { encode, hashBytes } from './hash'
import { SNAPSHOTS_DIR, classify, snapshotFilePath, snapshotManifestPath } from './paths'
import type { StorageAdapter } from './adapter'
import type { WorkspaceSession } from './session'

/** Why a snapshot was made. `before-restore` is the one a restore takes first; `before-assistant` the one Accept of a suggestion takes (ADR-0015). */
export type SnapshotReason = 'manual' | 'before-restore' | 'before-assistant'

/** A path of a book's file inside the workspace: under that book's folder, no `..`, no leading slash. */
const inBook = (path: string, universe: string, book: string) =>
  path.startsWith(`universes/${universe}/books/${book}/`) &&
  !path.includes('\\') &&
  path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^snp_[a-z0-9]+$/),
    kind: z.enum(['scene', 'book']),
    /** The scene, or the book, it was made from. */
    target: z.string(),
    universe: z.string().regex(/^unv_\w+$/),
    book: z.string().regex(/^bok_\w+$/),
    /** The scene's or the book's title when it was made: what the list shows. */
    title: z.string(),
    name: z.string().optional(),
    /** `manual` or `before-restore`; a later version may add its own, which this one still lists. */
    reason: z.string(),
    at: z.string(),
    /** Every copied file, by its path in the workspace, with the hash of its bytes. */
    files: z.array(z.object({ path: z.string(), hash: z.string() })),
  })
  // A manifest that names a path outside its own book is not a snapshot: a restore writes to these paths.
  .refine((m) => m.files.every((f) => inBook(f.path, m.universe, m.book)))

export interface Snapshot extends z.infer<typeof manifestSchema> {
  /** Every listed file is here. A snapshot still arriving from another device is not complete yet. */
  complete: boolean
}

export type SnapshotTarget = { kind: 'scene' | 'book'; id: string }

const NAME_MAX = 80
/** A name as typed: one line, no control characters, not longer than the list can show. */
export const cleanName = (raw: string | undefined) =>
  raw
    // eslint-disable-next-line no-control-regex
    ?.replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, NAME_MAX) || undefined

/** The files a book snapshot keeps: the book's own file, its parts, chapters and scenes. Records belong to the world, not to one book's text. */
async function bookFiles(adapter: StorageAdapter, universe: string, book: string) {
  const prefix = `universes/${universe}/books/${book}/`
  return (await adapter.list())
    .filter((p) => p.startsWith(prefix))
    .filter((p) => {
      const k = classify(p)
      return k.kind === 'book' || k.kind === 'part' || k.kind === 'chapter' || k.kind === 'scene'
    })
    .sort()
}

/** Write a copy and read it back: a copy that does not read back the same is a failure, not a snapshot. */
async function writeChecked(
  adapter: StorageAdapter,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
  hash: string,
) {
  await adapter.writeBytes(path, bytes)
  const copy = await adapter.readBytes(path)
  if (!copy || (await hashBytes(copy)) !== hash)
    throw new StorageError('other', 'Aurelia could not make the snapshot, so none was made.')
}

/** The file as the author has it: words still waiting to be saved first, else the bytes on disk. */
async function bytesNow(s: WorkspaceSession, path: string) {
  const typed = s.pipeline.pendingText(path)
  return typed !== undefined ? encode(typed) : await s.adapter.readBytes(path)
}

/**
 * Write a snapshot of the target as it is now (inside an action already holding the session).
 * Each file is written and read back before the next; `snapshot.json`, which is what lists the
 * snapshot, goes last, so a stop leaves files nobody lists, never a listing with nothing behind it.
 */
export async function writeSnapshot(
  s: WorkspaceSession,
  target: SnapshotTarget,
  opts: { name?: string; reason?: SnapshotReason; now?: Date } = {},
): Promise<Snapshot> {
  const own = s.pathOf(target.id)
  const home = own ? classify(own) : undefined
  const owner = own && home && 'book' in home ? home : undefined
  if (!own || !owner || (target.kind === 'scene') !== (home?.kind === 'scene'))
    throw new StorageError('other', 'That is no longer in the workspace.')
  const title =
    target.kind === 'scene'
      ? s.data.scenes.find((x) => x.meta.id === target.id)?.meta.title
      : s.data.books.find((b) => b.id === target.id)?.title
  const paths =
    target.kind === 'scene' ? [own] : await bookFiles(s.adapter, owner.universe, owner.book)

  let id = newId('snp')
  for (let tries = 0; (await s.adapter.readBytes(snapshotManifestPath(id))) && tries < 10; tries++)
    id = newId('snp')
  if (await s.adapter.readBytes(snapshotManifestPath(id)))
    throw new StorageError('other', 'Aurelia could not make a new snapshot.')

  const files: { path: string; hash: string }[] = []
  const written: string[] = []
  try {
    for (const path of paths) {
      const bytes = await bytesNow(s, path)
      if (!bytes || !isText(bytes)) continue // gone since it was listed, or not text Aurelia reads (it is not loaded either)
      const hash = await hashBytes(bytes)
      written.push(snapshotFilePath(id, path))
      await writeChecked(s.adapter, snapshotFilePath(id, path), bytes, hash)
      files.push({ path, hash })
    }
    if (!files.length)
      throw new StorageError('other', 'There is nothing in that to take a snapshot of.')
    return await listed(s, id, target, owner, title, files, opts)
  } catch (e) {
    // The copies this call wrote are only copies, and nothing lists them: take them away, so they are not synced for ever.
    for (const path of [...written, snapshotManifestPath(id)])
      await s.adapter.remove(path).catch(() => undefined)
    throw e
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true })
const isText = (bytes: Uint8Array<ArrayBuffer>) => {
  try {
    utf8.decode(bytes)
    return true
  } catch {
    return false
  }
}

/** Write `snapshot.json`: what lists the snapshot, so it goes last. */
async function listed(
  s: WorkspaceSession,
  id: string,
  target: SnapshotTarget,
  owner: { universe: string; book: string },
  title: string | undefined,
  files: { path: string; hash: string }[],
  opts: { name?: string; reason?: SnapshotReason; now?: Date },
): Promise<Snapshot> {
  const name = cleanName(opts.name)
  const manifest = {
    schemaVersion: 1 as const,
    id,
    kind: target.kind,
    target: target.id,
    universe: owner.universe,
    book: owner.book,
    title: title ?? '',
    ...(name ? { name } : {}),
    reason: opts.reason ?? 'manual',
    at: (opts.now ?? new Date()).toISOString(),
    files,
  }
  await s.adapter.write(snapshotManifestPath(id), `${JSON.stringify(manifest, null, 2)}\n`)
  return { ...manifest, complete: true }
}

/**
 * Take a snapshot of a scene or a book as it is now, with the words not yet saved. This is the one
 * function every caller uses: the author's own button and a restore ("Before restore") today, the
 * assistant's Accept later (M8).
 */
export function takeSnapshot(
  s: WorkspaceSession,
  target: SnapshotTarget,
  opts: { name?: string; reason?: SnapshotReason; now?: Date } = {},
): Promise<Snapshot> {
  return s.exclusive(() => writeSnapshot(s, target, opts))
}

/** Every snapshot in the workspace, newest first. A folder with no readable `snapshot.json` is not listed, and is left alone. */
export async function listSnapshots(adapter: StorageAdapter): Promise<Snapshot[]> {
  const all = new Set(await adapter.list())
  const out: Snapshot[] = []
  for (const path of all) {
    const id = new RegExp(`^${SNAPSHOTS_DIR.replace('.', '\\.')}/(snp_\\w+)/snapshot\\.json$`).exec(
      path,
    )?.[1]
    if (!id) continue
    try {
      const found = await adapter.read(path)
      const m = manifestSchema.parse(JSON.parse(found?.text ?? ''))
      if (m.id !== id) continue
      out.push({ ...m, complete: m.files.every((f) => all.has(snapshotFilePath(id, f.path))) })
    } catch {
      // A snapshot that does not read (a newer Aurelia's, a damaged file) is kept, never deleted.
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1))
}

/**
 * The texts a snapshot holds, each checked against the hash written with it. A snapshot that is
 * still arriving, or whose file was changed or damaged, says so in words and gives nothing.
 */
export async function readSnapshot(
  adapter: StorageAdapter,
  snap: Snapshot,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const f of snap.files) {
    const found = await adapter.read(snapshotFilePath(snap.id, f.path)).catch(() => null)
    if (!found)
      throw new StorageError(
        'other',
        'This snapshot is not all here yet. It may still be coming from another device.',
      )
    if (found.hash !== f.hash)
      throw new StorageError(
        'other',
        'A file in this snapshot is not as it was saved, so Aurelia did not use it.',
      )
    out.set(f.path, found.text)
  }
  return out
}
