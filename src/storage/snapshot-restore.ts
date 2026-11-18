// SPDX-License-Identifier: AGPL-3.0-or-later
// Putting a snapshot back (ADR-0013). Nothing is deleted: the text as it is now is snapshotted
// first ("Before restore"), a scene that is here now and not in the snapshot stays, and a file that
// is in conflict, still saving or has two versions waiting is left as it is and named.
import { bodyForEditor, parseFrontmatter, splitDocument } from './frontmatter'
import { StorageError } from './errors'
import { classify } from './paths'
import { listTrash } from './set-aside'
import { syncOutline } from './outline-actions'
import { listSnapshots, readSnapshot, writeSnapshot, type Snapshot } from './snapshots'
import { writeBase } from './story-base-actions'
import { BASE_SECTIONS, baseOf, type StoryBase } from '@/domain/story-base'
import type { WorkspaceSession } from './session'

export interface SceneRestore {
  /** False when the scene already read the same: nothing was written and no snapshot was made. */
  changed: boolean
  /** The "Before restore" snapshot of the scene as it was. */
  before?: string
}

export interface BookRestore {
  /** Titles of scenes whose text was put back, and "Story base" when its sections were. */
  restored: string[]
  /** Titles of scenes that had been deleted and are back. */
  broughtBack: string[]
  /** Scenes that already read the same. */
  unchanged: number
  /** Titles of scenes that are in the book now and were not in the snapshot. They stay. */
  kept: string[]
  /** Scenes left as they are, and why, in words. */
  skipped: { title: string; why: string }[]
  before?: string
}

const ID_IN_PATH = /\/(scn_\w+|chp_\w+|prt_\w+)\.md$/

/** The text a scene shows in the editor, from its whole file. */
export function sceneBodyOf(file: string): string {
  const doc = splitDocument(file)
  return doc ? bodyForEditor(doc.head, doc.body) : file
}

/** One text value of a Markdown file's details (`title`, `chapter`, `part`), or undefined. */
function fieldOf(file: string, key: string): string | undefined {
  try {
    const doc = splitDocument(file)
    const value = doc ? (parseFrontmatter(doc.yaml) as Record<string, unknown>)[key] : undefined
    return typeof value === 'string' && value ? value : undefined
  } catch {
    return undefined
  }
}

/** The title in a Markdown file's details, or the id when it has none. */
export const titleOfFile = (file: string, fallback: string) => fieldOf(file, 'title') ?? fallback

async function usable(s: WorkspaceSession, snapshotId: string, kind?: Snapshot['kind']) {
  const snap = (await listSnapshots(s.adapter)).find((x) => x.id === snapshotId)
  if (!snap || (kind && snap.kind !== kind))
    throw new StorageError('other', 'That snapshot is not there any more.')
  return { snap, texts: await readSnapshot(s.adapter, snap) }
}

/** Why this scene must be left as it is right now, in words, or undefined. Saves what is waiting first. Shared with the assistant's Accept. */
export async function blocker(
  s: WorkspaceSession,
  id: string,
  path: string,
): Promise<string | undefined> {
  if (s.view().duplicates.some((d) => d.id === id)) return 'two files have its ID. Choose one first'
  if (s.view().conflicts.some((c) => c.path === path))
    return 'two versions are waiting. Choose one first'
  await s.flushPaths([path])
  if (s.pipeline.isBusy(path)) return 'it is still saving. Try again in a moment'
  return undefined
}

export const bodyNow = (s: WorkspaceSession, id: string) =>
  s.data.scenes.find((x) => x.meta.id === id)?.body

/**
 * Put a text into a scene and wait until it is in the file. Refused (`moved`) when the scene no longer
 * reads as `was`, the text the "Before restore" snapshot was made from: words typed meanwhile are in
 * no snapshot, and writing over them would lose them. The check and the edit have nothing awaited between.
 */
export async function put(
  s: WorkspaceSession,
  id: string,
  body: string,
  path: string,
  was: string,
) {
  if (bodyNow(s, id) !== was) return 'moved' as const
  await s.editScene(id, body)
  await s.flushPaths([path])
  if (bodyNow(s, id) !== body || s.pipeline.isBusy(path))
    throw new StorageError(
      'other',
      'The scene could not be saved just yet. Its words are kept safe and Aurelia will try again.',
    )
  return undefined
}

const MOVED = 'it was typed in while the restore ran. Its words are kept; try again'

/**
 * Put one scene's text back from a snapshot (of the scene, or of its book). Only the writing
 * changes: the scene's details (title, status, choices, which chapter it is in) stay as they are.
 */
export function restoreScene(
  s: WorkspaceSession,
  snapshotId: string,
  sceneId: string,
): Promise<SceneRestore> {
  return s.exclusive(async () => {
    const { texts } = await usable(s, snapshotId)
    const file = [...texts].find(([p]) => p.endsWith(`/${sceneId}.md`))?.[1]
    const path = s.pathOf(sceneId)
    if (file === undefined)
      throw new StorageError('other', 'This snapshot does not hold that scene.')
    if (!path || bodyNow(s, sceneId) === undefined)
      throw new StorageError('other', 'That scene is no longer in the book.')
    const why = await blocker(s, sceneId, path)
    if (why) throw new StorageError('other', `This scene was left as it is: ${why}.`)
    const body = sceneBodyOf(file)
    const was = bodyNow(s, sceneId)!
    if (was === body) return { changed: false }
    const before = await writeSnapshot(
      s,
      { kind: 'scene', id: sceneId },
      { reason: 'before-restore' },
    )
    if (await put(s, sceneId, body, path, was))
      throw new StorageError('other', `This scene was left as it is: ${MOVED}.`)
    return { changed: true, before: before.id }
  })
}

interface Change {
  id: string
  path: string
  body: string
  title: string
  was: string
}

/**
 * Put a whole book's writing back. A scene that is here now and not in the snapshot stays; a scene
 * that was deleted and is no longer in Recently deleted comes back, with the chapter (and part) it
 * needs if those are gone too; the story base's sections the snapshot has come back (ADR-0016); the
 * book's other details, its records and everything else are not touched.
 */
export function restoreBook(s: WorkspaceSession, snapshotId: string): Promise<BookRestore> {
  return s.exclusive(async () => {
    const { snap, texts } = await usable(s, snapshotId, 'book')
    if (!s.data.books.some((b) => b.id === snap.book))
      throw new StorageError(
        'other',
        'This book is in Recently deleted. Put it back first, then restore.',
      )
    const result: BookRestore = {
      restored: [],
      broughtBack: [],
      unchanged: 0,
      kept: [],
      skipped: [],
    }
    const trashed = new Set((await listTrash(s.adapter)).flatMap((e) => e.waiting))
    const inSnapshot = new Set<string>()
    const change: Change[] = []
    const scenes: { path: string; text: string; title: string }[] = []
    const others = new Map<string, { path: string; text: string }>() // chapters and parts, by ID

    // The story base is the author's writing too (ADR-0016): a section the snapshot has comes back; one
    // written since and empty in the snapshot stays, as a scene that is not in it stays.
    const base: StoryBase = {}
    for (const [path, text] of texts) {
      const k = classify(path)
      if (k.kind !== 'book' || k.book !== snap.book || k.universe !== snap.universe) continue
      let then: Record<string, string> = {}
      try {
        then = baseOf(JSON.parse(text)) // only the three sections, each read as text
      } catch {
        // a book.json that does not read gives nothing back
      }
      const now = baseOf(s.data.books.find((b) => b.id === snap.book))
      for (const { key } of BASE_SECTIONS)
        if (typeof then[key] === 'string' && then[key].trim() && then[key] !== now[key])
          base[key] = then[key]
    }
    for (const [path, text] of texts) {
      const k = classify(path)
      const id = ID_IN_PATH.exec(path)?.[1]
      // Only files of this book are ever written (a snapshot's paths are checked when it is read, and again here).
      if (!id || !('book' in k) || k.book !== snap.book || k.universe !== snap.universe) continue
      if (!id.startsWith('scn_')) {
        others.set(id, { path, text })
        continue
      }
      inSnapshot.add(id)
      const here = s.pathOf(id)
      const title = titleOfFile(text, id)
      const body = sceneBodyOf(text)
      if (here === undefined) {
        // A deleted scene comes back at its own place, unless it waits in Recently deleted (put it back from
        // there: this would give it the older words and block that) or something else has taken the place.
        if (trashed.has(path))
          result.skipped.push({ title, why: 'it is in Recently deleted. Put it back first' })
        else if (await s.adapter.readBytes(path))
          result.skipped.push({ title, why: 'another file is in its place' })
        else scenes.push({ path, text, title })
      } else if ((classify(here) as { book?: string }).book !== snap.book)
        result.skipped.push({ title, why: 'it is in another book now' })
      else if (bodyNow(s, id) === body) result.unchanged++
      else change.push({ id, path: here, body, title, was: '' })
    }
    for (const scene of s.data.scenes)
      if (!inSnapshot.has(scene.meta.id) && s.pathOf(scene.meta.id)?.includes(`/${snap.book}/`))
        result.kept.push(scene.meta.title)

    // Only what a brought-back scene needs: its chapter, and that chapter's part. A chapter or part
    // deleted on purpose, with nothing coming back into it, is not brought back.
    const absent = async (id: string | undefined) => {
      const o = id ? others.get(id) : undefined
      return o &&
        s.pathOf(id!) === undefined &&
        !trashed.has(o.path) &&
        !(await s.adapter.readBytes(o.path))
        ? o
        : undefined
    }
    const chapters: { path: string; text: string }[] = []
    const parts: { path: string; text: string }[] = []
    for (const id of new Set(scenes.map((x) => fieldOf(x.text, 'chapter')))) {
      const chapter = await absent(id)
      if (!chapter) continue
      chapters.push(chapter)
      const partId = fieldOf(chapter.text, 'part')
      const part = await absent(partId)
      if (part && !parts.includes(part)) parts.push(part)
    }

    const doable: Change[] = []
    for (const c of change) {
      const why = await blocker(s, c.id, c.path)
      if (why) result.skipped.push({ title: c.title, why })
      else doable.push({ ...c, was: bodyNow(s, c.id)! })
    }
    const baseBack = Object.keys(base).length > 0
    if (!doable.length && !scenes.length && !baseBack) return result

    const before = await writeSnapshot(
      s,
      { kind: 'book', id: snap.book },
      { reason: 'before-restore' },
    )
    result.before = before.id
    const made = [...parts, ...chapters, ...scenes] // a scene needs its chapter, which may need its part
    try {
      await s.create(made)
      for (const m of scenes) result.broughtBack.push(m.title)
      for (const c of doable) {
        try {
          if (await put(s, c.id, c.body, c.path, c.was))
            result.skipped.push({ title: c.title, why: MOVED })
          else result.restored.push(c.title)
        } catch {
          // Not saved: the scene goes back to what it was (unless it has been typed in since), and the rest go on.
          if (bodyNow(s, c.id) === c.body) await s.editScene(c.id, c.was).catch(() => undefined)
          result.skipped.push({ title: c.title, why: 'it could not be saved just yet' })
        }
      }
      if (baseBack)
        try {
          await writeBase(s, snap.book, {
            ...baseOf(s.data.books.find((b) => b.id === snap.book)),
            ...base,
          })
          result.restored.push('Story base')
        } catch {
          result.skipped.push({ title: 'Story base', why: 'it could not be saved just yet' })
        }
    } finally {
      if (made.length) await s.flushPaths(await syncOutline(s, snap.book)).catch(() => undefined)
    }
    return result
  })
}
