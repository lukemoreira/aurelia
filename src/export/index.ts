// SPDX-License-Identifier: AGPL-3.0-or-later
// Export a book: the entries the screens call (ADR-0014).
import type { WorkspaceData } from '@/domain/workspace-data'
import { buildExportBook, fileSafe } from './book'
import type { ExportCover } from './cover'
import { docxBlob } from './docx'
import { epubBlob } from './epub'
import { markdownBlob } from './markdown'
import { printCss, printHtml } from './print'
import type { ExportProfile } from './profile'

export interface ExportedFile {
  filename: string
  blob: Blob
}

/** The file for a book under a profile (Markdown bundle, DOCX or EPUB). A PDF is `printBook`: the browser makes it. */
export function exportBook(
  data: WorkspaceData,
  bookId: string,
  profile: ExportProfile,
  cover?: ExportCover,
): ExportedFile {
  const book = { ...buildExportBook(data, bookId, profile), ...(cover && { cover }) }
  const name = fileSafe(book.title)
  switch (profile.format) {
    case 'docx':
      return { filename: `${name}.docx`, blob: docxBlob(book, profile) }
    case 'epub':
      return { filename: `${name}.epub`, blob: epubBlob(book, profile) }
    case 'markdown':
      return { filename: `${name} (Markdown).zip`, blob: markdownBlob(book) }
    case 'pdf':
      throw new Error('A PDF is made from the print view.')
  }
}

/** The print view of a book: its page, the stylesheet that prints it, and the title it is saved under. */
export function printBook(
  data: WorkspaceData,
  bookId: string,
  profile: ExportProfile,
  cover?: ExportCover,
) {
  const book = { ...buildExportBook(data, bookId, profile), ...(cover && { cover }) }
  return {
    title: fileSafe(book.title),
    css: printCss(profile, !!cover),
    html: printHtml(book, profile),
  }
}
