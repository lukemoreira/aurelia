// SPDX-License-Identifier: AGPL-3.0-or-later
// A book as an export reads it: parts, chapters and scenes in outline order, each scene's text as blocks
// and, wherever a scene has choices, the "Choices" list at its end (ADR-0004 point 10, ADR-0014).
import { bookOutline } from '@/domain/outline'
import type { WorkspaceData } from '@/domain/workspace-data'
import type { ExportCover } from './cover'
import { plainMarkdown, sceneBlocks, xmlSafe, type Block, type NameOf, type Note } from './blocks'
import { validLanguage, type ExportProfile } from './profile'

export interface ExportChoice {
  label: string
  /** The title of the scene it leads to, in words a reader knows ("a scene that is gone" when it is). */
  target: string
  /** The scene's ID when it is in this export, so a format with links can link to it. */
  targetId?: string
}

export interface ExportScene {
  id: string
  title: string
  blocks: Block[]
  notes: Note[]
  /** The text as Markdown, for the Markdown export. */
  markdown: string
  choices: ExportChoice[]
}

export interface ExportChapter {
  id: string
  title: string
  number: number
  /** The title of the part this chapter opens, when it is the first chapter of one. */
  part?: string
  scenes: ExportScene[]
}

export interface ExportBook {
  id: string
  title: string
  subtitle: string
  author: string
  language: string
  chapters: ExportChapter[]
  /** The book's cover art, when it has one that could be read. */
  cover?: ExportCover
  /** The book has parts: part, chapter and scene headings are one level deeper. */
  hasParts: boolean
}

export const GONE = 'a scene that is no longer here'
/** A choice to a scene that exists but is not in this export (another book, or in no chapter). */
export const NOT_HERE = 'a scene that is not in this export'

const clean = (text: string) => xmlSafe(text).replace(/\s+/g, ' ').trim()

/** The book in reading order, as the profile's settings need it. Unfiled scenes (in no chapter) are not part of the manuscript. */
export function buildExportBook(
  data: WorkspaceData,
  bookId: string,
  profile: ExportProfile,
): ExportBook {
  const book = data.books.find((b) => b.id === bookId)
  if (!book) throw new Error('That book is no longer in the workspace.')
  const names = new Map(data.records.map((r) => [r.meta.id, r.meta.title]))
  const nameOf: NameOf = (id) => names.get(id)
  const titles = new Map(data.scenes.map((s) => [s.meta.id, s.meta.title]))
  const inBook = new Set<string>()
  const outline = bookOutline(data, bookId)
  for (const g of outline)
    for (const c of g.chapters) for (const s of c.scenes) inBook.add(s.meta.id)

  const chapters: ExportChapter[] = []
  for (const group of outline) {
    group.chapters.forEach((c, i) => {
      chapters.push({
        id: c.chapter.id,
        title: clean(c.chapter.title),
        number: c.number,
        ...(group.part && i === 0 ? { part: clean(group.part.title) } : {}),
        scenes: c.scenes.map((s) => ({
          id: s.meta.id,
          title: clean(s.meta.title),
          ...sceneBlocks(s.body, nameOf),
          markdown: plainMarkdown(s.body, nameOf),
          choices: (s.meta.choices ?? []).map((choice) => ({
            label: clean(choice.label),
            target: !titles.has(choice.target)
              ? GONE
              : !inBook.has(choice.target)
                ? NOT_HERE
                : clean(titles.get(choice.target)!) || 'Untitled scene',
            ...(inBook.has(choice.target) ? { targetId: choice.target } : {}),
          })),
        })),
      })
    })
  }
  return {
    id: bookId,
    title: clean(book.title),
    subtitle: clean(profile.subtitle),
    author: clean(profile.author),
    language: validLanguage(profile.language),
    chapters,
    hasParts: outline.some((g) => g.part && g.chapters.length),
  }
}

/** The heading a chapter shows under a profile: nothing, its title, or "Chapter 3: Its title". */
export function chapterHeading(c: ExportChapter, mode: ExportProfile['chapterTitles']): string {
  if (mode === 'none') return ''
  return mode === 'numbered' ? `Chapter ${c.number}: ${c.title}` : c.title
}

/** The heading levels of the book: a part is 1, a chapter 1 (2 under parts), a scene one deeper. */
export const levelsOf = (book: ExportBook) => ({
  part: 1,
  chapter: book.hasParts ? 2 : 1,
  scene: book.hasParts ? 3 : 2,
})

/** A file name from a title: no characters a system refuses, and never empty. */
export const fileSafe = (title: string, fallback = 'Book') =>
  title
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '') || fallback
