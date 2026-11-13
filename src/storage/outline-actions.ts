// SPDX-License-Identifier: AGPL-3.0-or-later
// What the author does to the outline, each as one action that writes its files in an order a stop
// cannot hurt: content files first, what only points at them (the list of books, the cache) last.
// A stop leaves files the app can read: an extra file is shown (an unlisted book, an unfiled scene),
// never hidden, and the next change brings the cache and the lists back in step.
import { isId, newId, type IdPrefix } from '@/domain/ids'
import { keyAfter } from '@/domain/order'
import { outlineCache, outlineMarkdown } from '@/domain/outline-files'
import type { Move } from '@/domain/outline-moves'
import { CURRENT_SCHEMA_VERSION } from '@/domain/schema/common'
import { checkTitle } from '@/domain/titles'
import type { WorkspaceData } from '@/domain/workspace-data'
import { StorageError } from './errors'
import { newHead } from './frontmatter'
import { setTopLevel } from './json-edit'
import {
  WORKSPACE_FILE,
  bookPath,
  chapterPath,
  classify,
  outlinePath,
  partPath,
  scenePath,
  universePath,
} from './paths'
import { newSceneText } from './scene-file'
import { keepOne, moveBack, moveToTrash } from './set-aside'
import type { WorkspaceSession } from './session'
import type { YamlPatch } from './yaml-edit'

const V = CURRENT_SCHEMA_VERSION
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

/** An ID no file of the workspace has (an ID that is already someone's would overwrite them). */
function freshId<P extends IdPrefix>(s: WorkspaceSession, prefix: P) {
  for (let tries = 0; tries < 10; tries++) {
    const id = newId(prefix)
    if (!s.pathOf(id)) return id
  }
  throw new StorageError('other', 'Aurelia could not make a new ID.')
}

const lastOrder = (items: { order: string }[]) =>
  items
    .map((i) => i.order)
    .sort()
    .at(-1)

function titleOrThrow(raw: string, fallback?: string) {
  const checked = checkTitle(raw || fallback || '')
  if (!checked.ok) throw new StorageError('other', checked.error || 'Give it a name.')
  return checked.title
}

const homeOf = (data: WorkspaceData, bookId: string) =>
  data.universes.find((u) => u.books.includes(bookId))

/** The book an outline item or scene belongs to; records have none. */
export function bookOf(data: WorkspaceData, id: string): string | undefined {
  if (isId(id, 'bok')) return id
  if (isId(id, 'scn')) {
    const scene = data.scenes.find((x) => x.meta.id === id)
    return scene?.book ?? data.chapters.find((c) => c.id === scene?.meta.chapter)?.book
  }
  return [...data.chapters, ...data.parts].find((x) => x.id === id)?.book
}

/**
 * Bring a book's two derived files in step with its files: the outline cache in `book.json` and
 * `OUTLINE.md`. Each is written only when it differs. Returns the paths written.
 */
export async function syncOutline(s: WorkspaceSession, bookId: string): Promise<string[]> {
  const book = s.data.books.find((b) => b.id === bookId)
  const universe = homeOf(s.data, bookId)
  const path = s.pathOf(bookId)
  if (!book || !universe || !path) return []
  const written: string[] = []
  const cache = outlineCache(s.data, bookId)
  if (
    JSON.stringify(book.outline ?? []) !== JSON.stringify(cache) &&
    (await s.writeDerived(path, (disk) => setTopLevel(disk ?? '{}', 'outline', cache)))
  )
    written.push(path)
  const outline = outlinePath(universe.id, bookId)
  const text = outlineMarkdown(s.data, bookId)
  if (await s.writeDerived(outline, () => text)) written.push(outline)
  return written
}

/** An action that touches one book's files, then brings the book's derived files in step and saves them. */
const inBook = (s: WorkspaceSession, bookId: string, work: () => Promise<void>) =>
  s.exclusive(async () => {
    await work()
    await s.flushPaths(await syncOutline(s, bookId))
  })

/** A chapter with an empty first scene, at the end of the book (or of a part). Returns both IDs. */
export async function addChapter(
  s: WorkspaceSession,
  bookId: string,
  opts: { title?: string; partId?: string } = {},
): Promise<{ chapter: string; scene: string }> {
  let made = { chapter: '', scene: '' }
  await inBook(s, bookId, async () => {
    const universe = homeOf(s.data, bookId)
    if (!universe) throw new StorageError('other', 'That book is no longer in the workspace.')
    const chapters = s.data.chapters.filter((c) => c.book === bookId)
    const title = titleOrThrow(opts.title ?? '', `Chapter ${chapters.length + 1}`)
    const chapter = freshId(s, 'chp')
    const scene = freshId(s, 'scn')
    const part =
      opts.partId && s.data.parts.some((p) => p.id === opts.partId) ? opts.partId : undefined
    await s.create([
      {
        path: chapterPath(universe.id, bookId, chapter),
        text: newHead({
          title,
          schemaVersion: V,
          id: chapter,
          book: bookId,
          ...(part ? { part } : {}),
          order: keyAfter(lastOrder(chapters)),
        }),
      },
      {
        path: scenePath(universe.id, bookId, scene),
        text: newSceneText({
          title: 'Untitled scene',
          schemaVersion: V,
          id: scene,
          chapter,
          order: 'a',
        }),
      },
    ])
    made = { chapter, scene }
  })
  return made
}

/** An empty part at the end of the book. */
export async function addPart(s: WorkspaceSession, bookId: string, rawTitle = ''): Promise<string> {
  let id = ''
  await inBook(s, bookId, async () => {
    const universe = homeOf(s.data, bookId)
    if (!universe) throw new StorageError('other', 'That book is no longer in the workspace.')
    const parts = s.data.parts.filter((p) => p.book === bookId)
    id = freshId(s, 'prt')
    await s.create([
      {
        path: partPath(universe.id, bookId, id),
        text: newHead({
          title: titleOrThrow(rawTitle, `Part ${parts.length + 1}`),
          schemaVersion: V,
          id,
          book: bookId,
          order: keyAfter(lastOrder(parts)),
        }),
      },
    ])
  })
  return id
}

/**
 * A new book with one chapter and one empty scene, in a shared universe or (without
 * `universeId`) as a book of its own. The book's files go first; the line that lists it, in the
 * universe or in `aurelia.json`, goes last, so a stop leaves a book that is shown, not hidden.
 */
export async function addBook(
  s: WorkspaceSession,
  opts: { title: string; universeId?: string },
): Promise<{ book: string; scene: string }> {
  let made = { book: '', scene: '' }
  await s.exclusive(async () => {
    const title = titleOrThrow(opts.title)
    const shared = opts.universeId
      ? s.data.universes.find((u) => u.id === opts.universeId && u.kind === 'shared')
      : undefined
    if (opts.universeId && !shared)
      throw new StorageError('other', 'Books can only be added to a shared universe.')
    const unv = shared?.id ?? freshId(s, 'unv')
    const [book, chapter, scene] = [freshId(s, 'bok'), freshId(s, 'chp'), freshId(s, 'scn')]
    // Each file is only ever pointed at by one before it: the book by its universe, the chapter by the
    // book, the scene by the chapter. The cache starts empty and is filled last.
    const files = [
      {
        path: bookPath(unv, book),
        text: json({ title, schemaVersion: V, id: book, mode: 'linear', outline: [] }),
      },
      {
        path: chapterPath(unv, book, chapter),
        text: newHead({ title: 'Chapter 1', schemaVersion: V, id: chapter, book, order: 'a' }),
      },
      {
        path: scenePath(unv, book, scene),
        text: newSceneText({
          title: 'Untitled scene',
          schemaVersion: V,
          id: scene,
          chapter,
          order: 'a',
        }),
      },
    ]
    if (shared) {
      await s.create(files)
      await s.setFields(shared.id, { books: [...shared.books, book] })
    } else {
      const universe = {
        path: universePath(unv),
        text: newHead({ title, schemaVersion: V, id: unv, kind: 'standalone', books: [book] }),
      }
      await s.create([universe, ...files])
      const list = [...s.data.workspace.universes.filter((u) => u !== unv), unv]
      await s.write(WORKSPACE_FILE, setTopLevel(s.current(WORKSPACE_FILE) ?? '', 'universes', list))
    }
    await s.flushPaths([...(await syncOutline(s, book)), universePath(unv), WORKSPACE_FILE])
    made = { book, scene }
  })
  return made
}

/** Change a title: one file, then the derived outline text that shows it. */
export async function renameItem(s: WorkspaceSession, id: string, raw: string): Promise<void> {
  const title = titleOrThrow(raw)
  const book = bookOf(s.data, id)
  await s.exclusive(async () => {
    await s.setFields(id, { title })
    await s.flushPaths([s.pathOf(id) ?? '', ...(book ? await syncOutline(s, book) : [])])
  })
}

/** Set details of one item (status, summary, POV…): one file, never more. */
export async function setDetails(s: WorkspaceSession, id: string, patch: YamlPatch): Promise<void> {
  await s.exclusive(async () => {
    await s.setFields(id, patch)
    await s.flushPaths([s.pathOf(id) ?? ''])
  })
}

/** Move one item: its own file changes (order, and its chapter or part), then the derived files follow. */
export async function applyMove(s: WorkspaceSession, move: Move): Promise<void> {
  const book = bookOf(s.data, move.id)
  const { order, chapter, part } = move.fields
  const patch: YamlPatch = { order }
  if (chapter !== undefined) patch.chapter = chapter
  if (part !== undefined) patch.part = part ?? undefined // null takes the part away
  await inBook(s, book ?? '', async () => {
    await s.setFields(move.id, patch)
    // Only when no key fitted between the neighbours: they get fresh ones, after the moved item.
    for (const other of move.also ?? []) await s.setFields(other.id, { order: other.order })
    await s.flushPaths(
      [move.id, ...(move.also ?? []).map((o) => o.id)].map((id) => s.pathOf(id) ?? ''),
    )
  })
}

export interface Deleted {
  stamp: string
  label: string
  kind: string
  book?: string
}

/**
 * Move an item to the trash. A chapter takes its scenes with it (scenes first, so a stop leaves a
 * chapter that is still whole in the outline), a part takes only itself (its chapters stay, loose),
 * a book takes its folder. The last book of a workspace stays.
 */
export async function deleteItem(s: WorkspaceSession, id: string): Promise<Deleted> {
  let done!: Deleted
  const book = bookOf(s.data, id)
  await s.exclusive(async () => {
    const d = s.data
    const own = s.pathOf(id)
    if (!own) throw new StorageError('other', 'That is no longer in the workspace.')
    let paths = [own]
    let kind = 'record'
    let label = d.records.find((r) => r.meta.id === id)?.meta.title ?? ''
    if (isId(id, 'scn')) {
      kind = 'scene'
      label = d.scenes.find((x) => x.meta.id === id)!.meta.title
    } else if (isId(id, 'chp')) {
      kind = 'chapter'
      label = d.chapters.find((c) => c.id === id)!.title
      const scenes = d.scenes.filter((x) => x.meta.chapter === id).map((x) => s.pathOf(x.meta.id))
      paths = [...scenes.filter((p): p is string => !!p), own]
    } else if (isId(id, 'prt')) {
      kind = 'part'
      label = d.parts.find((p) => p.id === id)!.title
    } else if (isId(id, 'bok')) {
      kind = 'book'
      label = d.books.find((b) => b.id === id)!.title
      if (d.books.length < 2)
        throw new StorageError('other', 'A workspace keeps at least one book. Add another first.')
      const folder = own.replace(/[^/]*$/, '') // the book's folder: book.json sits in it
      await s.flush() // files that are only in the journal are on disk before they move
      paths = (await s.adapter.list()).filter((p) => p.startsWith(folder)).sort()
    }
    const stamp = await moveToTrash(s, { label, kind, paths })
    done = { stamp, label, kind, ...(book ? { book } : {}) }
    if (kind === 'book') {
      const home = d.universes.find((u) => u.books.includes(id))
      if (home) await s.setFields(home.id, { books: home.books.filter((b) => b !== id) })
      await s.flushPaths(home ? [universePath(home.id)] : [])
    } else if (book) await s.flushPaths(await syncOutline(s, book))
  })
  return done
}

/** Put a deleted item back, list a returned book again, and bring the cache and the outline up to date. */
export function restoreDeleted(
  s: WorkspaceSession,
  stamp: string,
): Promise<{ restored: string[]; skipped: string[] }> {
  return s.exclusive(async () => {
    const result = await moveBack(s, stamp)
    await s.refresh()
    const books = new Map<string, string>() // book → universe
    for (const path of result.restored) {
      const kind = classify(path)
      if ('book' in kind) books.set(kind.book, kind.universe)
    }
    for (const [book, universe] of books) {
      const home = s.data.universes.find((u) => u.id === universe)
      if (home) await s.setFields(home.id, { books: home.books })
      await s.flushPaths([universePath(universe), ...(await syncOutline(s, book))])
    }
    return result
  })
}

/** The author keeps one of the files that share an ID; the others are set aside, never deleted. */
export const chooseDuplicate = (s: WorkspaceSession, id: string, keepPath: string) =>
  s.exclusive(() => keepOne(s, id, keepPath))
