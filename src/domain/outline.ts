// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Book, Chapter, Part } from './schema/book'
import type { SceneDoc, WorkspaceData } from './workspace-data'

export interface OutlineChapter {
  chapter: Chapter
  number: number
  scenes: SceneDoc[]
  words: number
}
interface OutlinePart {
  /** Absent for chapters that sit straight under the book. */
  part?: Part
  chapters: OutlineChapter[]
}

const byOrder = <T extends { order?: string }>(a: T, b: T) =>
  (a.order ?? '') < (b.order ?? '') ? -1 : (a.order ?? '') > (b.order ?? '') ? 1 : 0

/** Scene frontmatter wins over the book's outline cache (ADR-0003 rule 3). */
export function bookOutline(data: WorkspaceData, bookId: string): OutlinePart[] {
  const chapters = data.chapters.filter((c) => c.book === bookId).sort(byOrder)
  const numbered = chapters.map((chapter, i): OutlineChapter => {
    const scenes = data.scenes
      .filter((s) => s.meta.chapter === chapter.id)
      .sort((a, b) => byOrder(a.meta, b.meta))
    const stated = (chapter as { number?: unknown }).number
    return {
      chapter,
      number: typeof stated === 'number' ? stated : i + 1,
      scenes,
      words: scenes.reduce((n, s) => n + s.words, 0),
    }
  })
  const parts = data.parts.filter((p) => p.book === bookId).sort(byOrder)
  // A chapter whose part is missing is kept, among the loose ones: nothing vanishes (ADR-0003).
  const partIds = new Set(parts.map((p) => p.id))
  const loose = numbered.filter((c) => !c.chapter.part || !partIds.has(c.chapter.part))
  const groups: OutlinePart[] = loose.length ? [{ chapters: loose }] : []
  for (const part of parts)
    groups.push({ part, chapters: numbered.filter((c) => c.chapter.part === part.id) })
  return groups
}

export const outlineScenes = (outline: OutlinePart[]): SceneDoc[] =>
  outline.flatMap((p) => p.chapters.flatMap((c) => c.scenes))

/**
 * Scenes in a book's folder whose chapter is not in the workspace (deleted, not synced yet, or a
 * hand edit): shown as "Unfiled" so nothing is hidden, and filed by moving them to a chapter.
 */
export function bookUnfiled(data: WorkspaceData, bookId: string): SceneDoc[] {
  const chapters = new Set(data.chapters.map((c) => c.id))
  return data.scenes
    .filter((s) => s.book === bookId && !chapters.has(s.meta.chapter))
    .sort((a, b) => byOrder(a.meta, b.meta))
}

/** The outline's scenes in reading order, then the unfiled ones: every scene a book has. */
export const bookScenes = (data: WorkspaceData, bookId: string): SceneDoc[] => [
  ...outlineScenes(bookOutline(data, bookId)),
  ...bookUnfiled(data, bookId),
]

/** Stands in for the chapter of an unfiled scene. Its ID is empty, which no chapter has. */
export const UNFILED = 'Unfiled'

interface SceneContext {
  scene: SceneDoc
  book: Book
  part?: Part
  chapter: OutlineChapter
  /** 1-based position inside the chapter. */
  index: number
}

export function sceneContext(data: WorkspaceData, sceneId: string): SceneContext | undefined {
  const scene = data.scenes.find((s) => s.meta.id === sceneId)
  const unfiled = scene?.book ? bookUnfiled(data, scene.book) : []
  const home = data.books.find((b) => b.id === scene?.book)
  if (scene && home && unfiled.includes(scene)) {
    const fake = { title: UNFILED, schemaVersion: 1, id: '', book: home.id, order: '' }
    const scenes = unfiled
    const words = scenes.reduce((n, s) => n + s.words, 0)
    return {
      scene,
      book: home,
      chapter: { chapter: fake, number: 0, scenes, words },
      index: scenes.indexOf(scene) + 1,
    }
  }
  const chapter = data.chapters.find((c) => c.id === scene?.meta.chapter)
  const book = data.books.find((b) => b.id === chapter?.book)
  if (!scene || !chapter || !book) return undefined
  for (const group of bookOutline(data, book.id)) {
    const found = group.chapters.find((c) => c.chapter.id === chapter.id)
    if (found)
      return {
        scene,
        book,
        part: group.part,
        chapter: found,
        index: found.scenes.indexOf(scene) + 1,
      }
  }
  return undefined
}

export const bookWords = (data: WorkspaceData, bookId: string) =>
  bookOutline(data, bookId).reduce((n, p) => p.chapters.reduce((m, c) => m + c.words, n), 0)

/** "61.9k", "980", and a dash for nothing written yet. */
export function formatWords(n: number): string {
  if (n <= 0) return '—'
  if (n < 1000) return String(n)
  return `${(Math.round(n / 100) / 10).toFixed(1)}k`
}

const WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
]
/** "Chapter Seven · Scene 2" for the eyebrow above a scene title. */
export const sceneEyebrow = (chapterNumber: number, sceneIndex: number) =>
  `${chapterNumber === 0 ? UNFILED : `Chapter ${WORDS[chapterNumber] ?? chapterNumber}`} · Scene ${sceneIndex}`
