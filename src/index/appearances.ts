// SPDX-License-Identifier: AGPL-3.0-or-later
// Where a record appears: the scenes that link to it or name it (a tagged name counts), grouped by
// book in the order the books are listed and each book's scenes in reading order. Derived from the
// index's backlinks; nothing is stored.
import type { Backlink, Target } from './types'

export interface BookAppearances {
  book: { id: string; title: string }
  scenes: { target: Target; count: number }[]
  /** Times it is written in this book, in all. */
  count: number
}

export function appearances(
  backlinks: Backlink[],
  books: { id: string; title: string }[],
): BookAppearances[] {
  const out = new Map<string, BookAppearances>()
  for (const b of backlinks) {
    if (b.from.kind !== 'scene' || !b.from.bookId) continue
    const book = books.find((x) => x.id === b.from.bookId)
    if (!book) continue
    const group = out.get(book.id) ?? { book, scenes: [], count: 0 }
    out.set(book.id, group)
    const count = b.links + b.names
    group.scenes.push({ target: b.from, count })
    group.count += count
  }
  return books.flatMap((b) => out.get(b.id) ?? [])
}
