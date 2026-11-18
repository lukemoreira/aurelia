// SPDX-License-Identifier: AGPL-3.0-or-later
// The story base of a book (ADR-0016), written by the author by hand or by an accepted suggestion: the
// `storyBase` key of `book.json`, set through the session like the book's other details.
import { baseOf, type BaseSection, type StoryBase } from '@/domain/story-base'
import { StorageError } from './errors'
import type { WorkspaceSession } from './session'

/** Put these sections in the book's story base and wait until `book.json` is saved. Not exclusive. */
export async function writeBase(s: WorkspaceSession, bookId: string, base: StoryBase) {
  const path = s.pathOf(bookId)
  if (!path || !s.data.books.some((b) => b.id === bookId))
    throw new StorageError('other', 'That book is no longer in the workspace.')
  const kept = Object.fromEntries(Object.entries(base).filter(([, v]) => v?.trim()))
  await s.setFields(bookId, { storyBase: Object.keys(kept).length ? kept : undefined })
  await s.flushPaths([path])
  if (s.pipeline.isBusy(path))
    throw new StorageError(
      'other',
      'The story base could not be saved just yet. Its words are kept safe and Aurelia will try again.',
    )
}

/** One section typed by the author: read and written inside one action, so two edits never cross. */
export function setBaseSection(
  s: WorkspaceSession,
  bookId: string,
  key: BaseSection,
  text: string,
): Promise<void> {
  return s.exclusive(async () => {
    const now = baseOf(s.data.books.find((b) => b.id === bookId))
    if (now[key] === text) return
    await writeBase(s, bookId, { ...now, [key]: text })
  })
}
