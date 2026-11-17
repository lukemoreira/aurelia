// SPDX-License-Identifier: AGPL-3.0-or-later
// A book as a folder of Markdown files in a zip (ADR-0014): a folder for each chapter (inside a folder for
// each part, when the book has parts) and a file for each scene, named by their place and title so any
// file browser lists them in reading order. Aurelia's own import reads this layout back.
import { newHead } from '@/storage/frontmatter'
import { encode } from '@/storage/hash'
import { FIXED_ZIP_STAMP, zipFiles, type ZipFile } from '@/storage/zip'
import { fileSafe, type ExportBook, type ExportScene } from './book'

const pad = (n: number, of: number) => String(n).padStart(Math.max(2, String(of).length), '0')

/** A scene's file: its title in the details at the top, its text, and its choices as a list. */
function sceneFile(s: ExportScene, where: Record<string, string>): string {
  const lines: string[] = []
  if (s.choices.length) {
    lines.push('', '**Choices**', '')
    for (const c of s.choices) lines.push(`- ${c.label} → ${c.target}`)
  }
  const body = s.markdown.replace(/\s+$/, '')
  return `${newHead({ title: s.title, ...where })}${body}${body ? '\n' : ''}${lines.length ? `${lines.join('\n')}\n` : ''}`
}

/** The files of the bundle, sorted by path. */
function markdownFiles(book: ExportBook): ZipFile[] {
  const root = fileSafe(book.title)
  const out: ZipFile[] = []
  const parts = book.chapters.filter((c) => c.part).length
  let part = ''
  let partTitle = ''
  let partNo = 0
  book.chapters.forEach((c, i) => {
    if (c.part) partTitle = c.part
    if (c.part) part = `${pad(++partNo, parts)} ${fileSafe(c.part, 'Part')}`
    const dir = `${root}/${part ? `${part}/` : ''}${pad(i + 1, book.chapters.length)} ${fileSafe(c.title, 'Chapter')}`
    // The real titles, which a folder name cannot always be (it has no `/` or `:`): the book, its part, its chapter.
    const where = { book: book.title, ...(partTitle ? { part: partTitle } : {}), chapter: c.title }
    c.scenes.forEach((s, j) =>
      out.push({
        path: `${dir}/${pad(j + 1, c.scenes.length)} ${fileSafe(s.title, 'Scene')}.md`,
        data: encode(sceneFile(s, where)),
      }),
    )
  })
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export const markdownBlob = (book: ExportBook): Blob =>
  zipFiles(markdownFiles(book), FIXED_ZIP_STAMP, true)
