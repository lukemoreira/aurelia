// SPDX-License-Identifier: AGPL-3.0-or-later
// A book as an EPUB 3, written by hand on the stored zip writer (ADR-0014). The `mimetype` entry comes
// first and is stored, as the format requires. Footnotes are `<aside epub:type="footnote">` notes at
// the end of their chapter, so a reading app can show them as pop-ups. Nothing in the file depends on
// when it was made: the "modified" date is the zip's own start, and the identifier comes from the book.
import { encode } from '@/storage/hash'
import { FIXED_ZIP_STAMP, zipFiles, type ZipFile } from '@/storage/zip'
import type { ExportBook } from './book'
import { EPUB_CSS, chapterHtml, esc, titlePageHtml } from './html'
import type { ExportProfile } from './profile'

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n'
/** `dcterms:modified` is required and must be a date: a fixed one, so the file is the same on any day. */
const EPUB_MODIFIED = '1980-01-01T00:00:00Z'

const page = (title: string, lang: string, body: string) =>
  `${HEAD}<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(lang)}" xml:lang="${esc(lang)}">\n<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n<body>${body}</body>\n</html>\n`

const chapterFile = (i: number) => `ch${String(i + 1).padStart(3, '0')}.xhtml`

interface Doc {
  id: string
  file: string
  title: string
  html: string
}

/** The contents list: parts hold their chapters (a part runs from the chapter that opens it to the next part). */
function navList(book: ExportBook, files: string[]): string {
  if (!book.chapters.length) return `<ol><li><a href="title.xhtml">${esc(book.title)}</a></li></ol>`
  const items: string[] = []
  let open = false
  book.chapters.forEach((c, i) => {
    const link = `<a href="${files[i]}">${esc(c.title || `Chapter ${c.number}`)}</a>`
    if (c.part) {
      if (open) items.push('</ol></li>')
      items.push(`<li><a href="${files[i]}">${esc(c.part)}</a><ol>`)
      open = true
    }
    items.push(`<li>${link}</li>`)
  })
  if (open) items.push('</ol></li>')
  return `<ol>${items.join('')}</ol>`
}

/** The parts of the EPUB, `mimetype` first. */
function epubFiles(book: ExportBook, profile: ExportProfile): ZipFile[] {
  const files = book.chapters.map((_, i) => chapterFile(i))
  const where = new Map<string, string>()
  book.chapters.forEach((c, i) => {
    for (const s of c.scenes) where.set(s.id, `${files[i]}#${s.id}`)
  })
  const ctx = { epub: true, prefix: '', sceneHref: (id: string) => where.get(id) }
  const docs: Doc[] = []
  const title = titlePageHtml(book, profile)
  if (title) docs.push({ id: 'title', file: 'title.xhtml', title: book.title, html: title })
  book.chapters.forEach((c, i) =>
    docs.push({
      id: `ch${i + 1}`,
      file: files[i]!,
      title: c.title,
      html: chapterHtml(book, c, profile, ctx),
    }),
  )
  // A reading app needs something to open, so an empty book still has its title page.
  if (!docs.length)
    docs.push({
      id: 'title',
      file: 'title.xhtml',
      title: book.title,
      html: titlePageHtml(book, { ...profile, titlePage: true }),
    })

  // The cover: a page first in the spine, and the image itself (an AVIF is no EPUB core image type, so it is left out).
  const cover = book.cover && book.cover.ext !== 'avif' ? book.cover : undefined
  const coverFile = cover && `cover.${cover.ext}`
  if (cover)
    docs.unshift({
      id: 'cover',
      file: 'cover.xhtml',
      title: book.title,
      html: `<section epub:type="cover" style="text-align:center"><img src="${coverFile}" alt="${esc(`Cover of ${book.title}`)}" style="max-width:100%;max-height:100%"/></section>`,
    })

  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...(cover
      ? [
          `<item id="cover-image" href="${coverFile}" media-type="${cover.type}" properties="cover-image"/>`,
        ]
      : []),
    ...docs.map((d) => `<item id="${d.id}" href="${d.file}" media-type="application/xhtml+xml"/>`),
  ]
  const opf = `${HEAD}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${esc(book.language)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">urn:aurelia:${esc(book.id)}</dc:identifier>
<dc:title>${esc(book.title)}</dc:title>
<dc:language>${esc(book.language)}</dc:language>
${book.author ? `<dc:creator>${esc(book.author)}</dc:creator>\n` : ''}<meta property="dcterms:modified">${EPUB_MODIFIED}</meta>
${cover ? '<meta name="cover" content="cover-image"/>\n' : ''}</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine>
${docs.map((d) => `<itemref idref="${d.id}"/>`).join('\n')}
</spine>
</package>
`
  const nav = page(
    'Contents',
    book.language,
    `<nav epub:type="toc" id="toc"><h1>Contents</h1>${navList(book, files)}</nav>`,
  )
  const parts: [string, string][] = [
    ['mimetype', 'application/epub+zip'],
    [
      'META-INF/container.xml',
      `${HEAD}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n`,
    ],
    ['OEBPS/content.opf', opf],
    ['OEBPS/nav.xhtml', nav],
    ['OEBPS/style.css', EPUB_CSS],
    ...docs.map((d): [string, string] => [
      `OEBPS/${d.file}`,
      page(d.title || book.title, book.language, d.html),
    ]),
  ]
  return [
    ...parts.map(([path, text]) => ({ path, data: encode(text) })),
    ...(cover ? [{ path: `OEBPS/${coverFile}`, data: cover.bytes }] : []),
  ]
}

export const epubBlob = (book: ExportBook, profile: ExportProfile): Blob =>
  zipFiles(epubFiles(book, profile), FIXED_ZIP_STAMP, true)
