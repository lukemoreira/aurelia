// SPDX-License-Identifier: AGPL-3.0-or-later
import { StorageError } from './errors'
import { setDetails } from './outline-actions'
import type { WorkspaceSession } from './session'

/**
 * "Not a name" (ADR-0010): put these places in the scene's `ignoreNames`. Only that line of the
 * scene's details changes; the text is not touched, and a place already there is not added again.
 */
export async function addIgnoredNames(
  s: WorkspaceSession,
  sceneId: string,
  keys: string[],
): Promise<void> {
  const known = s.data.scenes.find((x) => x.meta.id === sceneId)?.meta.ignoreNames ?? []
  const next = Array.from(new Set([...known, ...keys]))
  if (next.length === known.length) return
  await setDetails(s, sceneId, { ignoreNames: next })
}

/**
 * "Not a name" for a word the Names panel offered (ADR-0010 §5): the word goes in the book's
 * `notNames` list in `book.json`, so every device and the MCP server stop offering it. Nothing is
 * written into a scene. The list is read and written inside one action, so two words answered in
 * a row, or on two devices, never write over each other from a stale list.
 */
export function changeNotNames(
  s: WorkspaceSession,
  bookId: string,
  change: { add: string } | { remove: string },
): Promise<void> {
  return s.exclusive(async () => {
    const book = s.data.books.find((b) => b.id === bookId)
    if (!book) throw new StorageError('other', 'That book is no longer in the workspace.')
    const now = book.notNames ?? []
    const next =
      'add' in change
        ? Array.from(new Set([...now, change.add]))
        : now.filter((w) => w !== change.remove)
    if (next.length === now.length) return
    await s.setFields(bookId, { notNames: next.length ? next : undefined })
    await s.flushPaths([s.pathOf(bookId) ?? ''])
  })
}
