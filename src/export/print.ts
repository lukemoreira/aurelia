// SPDX-License-Identifier: AGPL-3.0-or-later
// The print view of a PDF export (ADR-0014): the book as one page of HTML and a print stylesheet; the
// browser's own "Save as PDF" makes the file. No PDF library: a page, `@page`, and `window.print()`.
import type { ExportBook } from './book'
import { chapterHtml, titlePageHtml } from './html'
import { PRINT_CLASS } from './print-class'
import type { ExportProfile } from './profile'

/** Where the print view stands on the page, so its ids never meet the app's. */
const PRINT_PREFIX = 'print-'

/** The book as HTML: title page, then each chapter on a page of its own. */
export function printHtml(book: ExportBook, profile: ExportProfile): string {
  const ctx = {
    epub: false,
    prefix: PRINT_PREFIX,
    sceneHref: (id: string) => `#${PRINT_PREFIX}${id}`,
  }
  return `${titlePageHtml(book, profile)}${book.chapters.map((c) => chapterHtml(book, c, profile, ctx)).join('')}`
}

const FONT = {
  serif: '"Literata", Georgia, "Times New Roman", serif',
  sans: '"Inter", Arial, Helvetica, sans-serif',
  mono: '"JetBrains Mono", "Courier New", monospace',
}

/**
 * The stylesheet of the print view: how it looks on screen (a sheet of paper), and under `@media print`
 * the one thing printed (the app is hidden), on the page size, font, size and line spacing of the profile.
 */
export function printCss(p: ExportProfile): string {
  const size = p.pageSize === 'a4' ? 'A4' : 'letter'
  const b = '.print-book'
  return `@page { size: ${size}; margin: 2.2cm 2.4cm 2.6cm; @bottom-center { content: counter(page); font-size: 10pt; } }
@page :first { @bottom-center { content: none; } }
${b} { font-family: ${FONT[p.font]}; font-size: ${p.fontSize}pt; line-height: ${p.spacing}; color: #000; background: #fff; }
${b} h1, ${b} h2, ${b} h3, ${b} h4, ${b} h5, ${b} h6 { line-height: 1.25; margin: 1.3em 0 .5em; break-after: avoid; }
${b} h1 { font-size: 1.8em; font-weight: 700; }
${b} h2 { font-size: 1.45em; font-weight: 700; }
${b} h3 { font-size: 1.2em; font-weight: 700; }
${b} h4, ${b} h5, ${b} h6 { font-size: 1em; font-weight: 700; }
${b} p { margin: 0; text-indent: 1.5em; orphans: 3; widows: 3; }
${b} h1 + p, ${b} h2 + p, ${b} h3 + p, ${b} .sep + p, ${b} .chapter-title + p, ${b} blockquote p, ${b} li p, ${b} td p, ${b} .choices p, ${b} .note p, ${b} .scene > p:first-child { text-indent: 0; }
${b} ul, ${b} ol { margin: .6em 0; padding-left: 1.6em; }
${b} ul { list-style: disc; }
${b} ol { list-style: decimal; }
${b} li > p { margin-bottom: .25em; }
${b} .chapter { break-before: page; }
${b} .chapter-title, ${b} .part-title { text-align: center; margin: 0 0 1.2em; }
${b} .chapter > .chapter-title:first-child, ${b} .chapter > .part-title { margin-top: 20vh; }
${b} .title-page { text-align: center; padding-top: 28%; }
${b} .title-page .title { font-size: 2.4em; margin: 0 0 .4em; }
${b} .title-page p { text-indent: 0; }
${b} .title-page .subtitle { font-size: 1.3em; font-style: italic; margin: 0 0 2em; }
${b} .title-page .author { font-size: 1.15em; }
${b} .sep { text-align: center; margin: 1.4em 0; text-indent: 0; }
${b} hr.sep { width: 30%; border: 0; border-top: 1px solid #555; }
${b} .gap { height: 1.4em; }
${b} blockquote { margin: 1em 1.6em; font-style: italic; }
${b} pre { white-space: pre-wrap; font-family: "JetBrains Mono", "Courier New", monospace; font-size: .85em; margin: .8em 0; }
${b} table { border-collapse: collapse; margin: 1em 0; break-inside: avoid; }
${b} th, ${b} td { border: 1px solid #777; padding: .25em .5em; }
${b} .al-l { text-align: left; } ${b} .al-c { text-align: center; } ${b} .al-r { text-align: right; }
${b} a { color: inherit; text-decoration: none; }
${b} .choices { margin: 1.2em 0; break-inside: avoid; }
${b} .notes { margin-top: 2em; border-top: 1px solid #999; padding-top: .6em; font-size: .85em; }
${b} .notes-title { margin: .4em 0 .6em; }
${b} .note { margin: 0 0 .4em; }
${b} .note p { display: inline; }
${b} .note p.note-n { font-weight: bold; margin-right: .5em; }
${b} .noteref { font-size: .7em; line-height: 0; }
@media screen {
  ${b} .chapter { margin-top: 3rem; padding-top: 2.2rem; border-top: 2px dashed #bbb; position: relative; }
  ${b} .chapter::before { content: "New page"; position: absolute; top: .4rem; right: 0; font: 11px/1 sans-serif; color: #777; }
  ${b} .title-page + .chapter { margin-top: 2rem; }
}
@media print {
  ${b} .noteback { display: none; }
  html.${PRINT_CLASS} body > :not(.print-view) { display: none !important; }
  html.${PRINT_CLASS} .print-view { position: static !important; overflow: visible !important; height: auto !important; background: #fff !important; padding: 0 !important; }
  html.${PRINT_CLASS} .print-view .print-bar { display: none !important; }
  html.${PRINT_CLASS} .print-view .print-sheet { box-shadow: none !important; width: auto !important; max-width: none !important; padding: 0 !important; margin: 0 !important; }
}
`
}
