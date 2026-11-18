// SPDX-License-Identifier: AGPL-3.0-or-later
// The story base of a book (ADR-0016), written by the author by hand or by an accepted suggestion: the
// `storyBase` key of `book.json`, set through the session like the book's other details.
import { baseOf, type BaseSection } from '@/domain/story-base'
import { StorageError } from './errors'
import type { WorkspaceSession } from './session'

export const CHANGED_ELSEWHERE =
  'This section changed on another device. What you typed is kept here: save again to replace it.'

/** The base as `book.json` keeps it: empty sections left out, any other value (a key a later version adds) kept. */
export const cleanBase = (base: Record<string, unknown> | undefined) =>
  Object.fromEntries(
    Object.entries(base ?? {}).filter(
      ([, v]) => v !== undefined && (typeof v !== 'string' || v.trim()),
    ),
  )

/** Two bases hold the same, whatever the order of their keys. */
export const sameBase = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const sorted = (x: Record<string, unknown>) =>
    JSON.stringify(Object.entries(cleanBase(x)).sort(([k], [l]) => (k < l ? -1 : 1)))
  return sorted(a) === sorted(b)
}

/** The stored base of a book, as read: the caller puts its changes over it, so nothing else is lost. */
export const storedBase = (s: WorkspaceSession, bookId: string) =>
  s.data.books.find((b) => b.id === bookId)?.storyBase ?? {}

/** Put this base in the book and wait until `book.json` is saved. Not exclusive. */
export async function writeBase(
  s: WorkspaceSession,
  bookId: string,
  base: Record<string, unknown>,
) {
  const path = s.pathOf(bookId)
  if (!path || !s.data.books.some((b) => b.id === bookId))
    throw new StorageError('other', 'That book is no longer in the workspace.')
  // Kept even when empty: a snapshot taken now then holds an empty base, which a restore puts back.
  await s.setFields(bookId, { storyBase: cleanBase(base) })
  await s.flushPaths([path])
  if (s.pipeline.isBusy(path))
    throw new StorageError(
      'other',
      'The story base could not be saved just yet. Its words are kept safe and Aurelia will try again.',
    )
}

/**
 * One section typed by the author, read and written inside one action. `expected` is the text the author
 * started from: when the section reads otherwise now (another device's sync), nothing is written over it.
 */
export function setBaseSection(
  s: WorkspaceSession,
  bookId: string,
  key: BaseSection,
  text: string,
  expected: string,
): Promise<void> {
  return s.exclusive(async () => {
    const now = baseOf(s.data.books.find((b) => b.id === bookId))[key]
    if (now === text) return
    if (now !== expected) throw new StorageError('other', CHANGED_ELSEWHERE)
    await writeBase(s, bookId, { ...storedBase(s, bookId), [key]: text })
  })
}
