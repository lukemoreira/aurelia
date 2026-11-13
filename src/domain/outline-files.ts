// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Book } from './schema/book'
import { bookOutline, bookUnfiled } from './outline'
import type { WorkspaceData } from './workspace-data'

type Cache = NonNullable<Book['outline']>

/** What `book.json` keeps of the outline: a cache of the order, never the truth (ADR-0003 rule 3). */
export function outlineCache(data: WorkspaceData, bookId: string): Cache {
  return bookOutline(data, bookId).flatMap((group) =>
    group.chapters.map((c) => ({
      chapter: c.chapter.id,
      ...(group.part ? { part: group.part.id } : {}),
      scenes: c.scenes.map((s) => s.meta.id),
    })),
  )
}

/** Plain text for a line of Markdown: one line, nothing that reads as a heading or list. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * The read-only `OUTLINE.md` of a book (ADR-0003 rule 9): titles, each with the file it is in, so
 * a person with only a file browser can find their way. Derived: rewritten after every change.
 */
export function outlineMarkdown(data: WorkspaceData, bookId: string): string {
  const book = data.books.find((b) => b.id === bookId)
  const lines = [
    `# ${oneLine(book?.title ?? '')}`,
    '',
    'Derived by Aurelia from the files in this folder. Do not edit it: it is rewritten whenever the outline changes.',
  ]
  for (const group of bookOutline(data, bookId)) {
    if (group.part) lines.push('', `## ${oneLine(group.part.title)} (parts/${group.part.id}.md)`)
    for (const c of group.chapters) {
      lines.push(
        '',
        `### ${c.number}. ${oneLine(c.chapter.title)} (chapters/${c.chapter.id}.md)`,
        '',
      )
      for (const s of c.scenes) lines.push(`- ${oneLine(s.meta.title)} (scenes/${s.meta.id}.md)`)
    }
  }
  const unfiled = bookUnfiled(data, bookId)
  if (unfiled.length) {
    lines.push('', '## Unfiled', '')
    for (const s of unfiled) lines.push(`- ${oneLine(s.meta.title)} (scenes/${s.meta.id}.md)`)
  }
  return `${lines.join('\n')}\n`
}
