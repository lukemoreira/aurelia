// SPDX-License-Identifier: AGPL-3.0-or-later
// The story base of a book (ADR-0016): its objectives, world and history, and main narrative, kept in
// `book.json` as `storyBase`; its main characters are the universe's Character records. The assistant
// reads it first on every question. Plain TS: the app and the assistant server (Node) share it.
import type { Book } from './schema/book'
import type { TextField } from './schema/record'
import type { WorkspaceData } from './workspace-data'

export const BASE_SECTIONS = [
  {
    key: 'objectives',
    label: 'Objectives',
    hint: 'What the book should do: audience, genre, tone, length, themes',
  },
  { key: 'world', label: 'World and history', hint: 'The world and its history, in outline' },
  {
    key: 'narrative',
    label: 'Main narrative',
    hint: 'The premise, the main arc, and where the ending goes',
  },
] as const
export type BaseSection = (typeof BASE_SECTIONS)[number]['key']
export type StoryBase = Partial<Record<BaseSection, string>>

/** The fields of a Character record the assistant may fill in when it suggests a main character. */
export const CHARACTER_FIELDS = [
  'role',
  'age',
  'appearance',
  'background',
  'goal',
  'fear',
  'flaw',
  'belief',
  'secret',
  'voice',
] as const satisfies readonly TextField[]
export type CharacterField = (typeof CHARACTER_FIELDS)[number]

const textOf = (v: unknown) => (typeof v === 'string' ? v : '')

/** The base as it stands: only the three sections, each a string ('' when not written, or not text). */
export const baseOf = (book: Pick<Book, 'storyBase'> | undefined): Record<BaseSection, string> => ({
  objectives: textOf(book?.storyBase?.objectives),
  world: textOf(book?.storyBase?.world),
  narrative: textOf(book?.storyBase?.narrative),
})

/** The universe a book is in (a universe lists its books). */
export const universeOfBook = (data: WorkspaceData, bookId: string) =>
  data.universes.find((u) => u.books.includes(bookId))?.id

/** The characters of a book: the records of type character in its universe, shared or its own. */
export function bookCharacters(data: WorkspaceData, bookId: string) {
  const universe = universeOfBook(data, bookId)
  return data.records.filter(
    (r) =>
      r.meta.type === 'character' &&
      r.universe === universe &&
      (r.meta.scope === 'universe' || r.meta.scope === `book:${bookId}`),
  )
}

/** Whether a book has no story base yet: no section written and no character. */
export const isBaseEmpty = (data: WorkspaceData, bookId: string) =>
  Object.values(baseOf(data.books.find((b) => b.id === bookId))).every((t) => !t.trim()) &&
  !bookCharacters(data, bookId).length

/** A character of this universe already goes by this name (case and spaces aside). */
export const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()
