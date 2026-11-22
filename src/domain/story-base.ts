// SPDX-License-Identifier: AGPL-3.0-or-later
// The story base of a book (ADR-0016): its genre, subject area, audience, planned volumes, intentions, objectives, world and history, main narrative and notes, kept in
// `book.json` as `storyBase`; its main characters are the universe's Character records. The assistant
// reads it first on every question. Plain TS: the app and the assistant server (Node) share it.
import type { Book } from './schema/book'
import type { TextField } from './schema/record'
import type { WorkspaceData } from './workspace-data'

export const BASE_SECTIONS = [
  {
    key: 'genre',
    label: 'Genre',
    hint: 'For example: military history, fantasy, romance',
    short: true,
  },
  {
    key: 'subject',
    label: 'Subject area',
    hint: 'The field the book covers, for example WWII naval warfare',
    short: true,
  },
  { key: 'audience', label: 'Audience', hint: 'Who the book is for', short: true },
  {
    key: 'volumes',
    label: 'Planned volumes',
    hint: 'How many books the series should have, for example 3',
    short: true,
  },
  {
    key: 'intentions',
    label: 'Intentions',
    hint: 'Why you write this book: what you want to say or achieve',
    short: false,
  },
  {
    key: 'objectives',
    label: 'Objectives',
    hint: 'What the book should do: tone, length, themes',
    short: false,
  },
  {
    key: 'world',
    label: 'World and history',
    hint: 'The world and its history, in outline',
    short: false,
  },
  {
    key: 'narrative',
    label: 'Main narrative',
    hint: 'The premise, the main arc, and where the ending goes',
    short: false,
  },
  { key: 'notes', label: 'Notes', hint: 'Anything else to keep in mind', short: false },
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

/** A section that is not text (written elsewhere) reads as its JSON, so replacing it counts as replacing. */
const textOf = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v))

/** The base as it stands: only the known sections, each a string ('' when not written). */
export const baseOf = (book: Pick<Book, 'storyBase'> | undefined) =>
  Object.fromEntries(BASE_SECTIONS.map((s) => [s.key, textOf(book?.storyBase?.[s.key])])) as Record<
    BaseSection,
    string
  >

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
