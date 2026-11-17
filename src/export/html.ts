// SPDX-License-Identifier: AGPL-3.0-or-later
// Blocks as XHTML, for an EPUB and for the print view of a PDF (ADR-0014). Everything the author wrote is
// escaped text: nothing here can carry markup or a script into the page that shows it.
import type { Block, Inline } from './blocks'
import {
  chapterHeading,
  levelsOf,
  type ExportBook,
  type ExportChapter,
  type ExportScene,
} from './book'
import type { ExportProfile } from './profile'

export const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface HtmlContext {
  /** The EPUB flavour: footnotes carry `epub:type`, so a reading app can show them as pop-ups. */
  epub: boolean
  /** Put before every id on the page, so a page that holds the print view next to the app never has an id twice. */
  prefix: string
  /** Where a scene is, for a choice to link to ("ch003.xhtml#scn_x"); none: the choice is words only. */
  sceneHref?: (sceneId: string) => string | undefined
}

/** One chapter's notes are numbered through it, so a number never stands twice on the page. */
interface Place {
  prefix: string
  chapter: string
  /** Notes before this scene's in the chapter. */
  base: number
  seen: Set<number>
}

const noteId = (kind: 'fn' | 'fnref', p: Place, n: number) =>
  `${p.prefix}${kind}-${p.chapter}-${p.base + n}`

function run(r: Inline, ctx: HtmlContext, place: Place): string {
  if (r.t === 'br') return '<br/>'
  if (r.t === 'note') {
    const first = !place.seen.has(r.n)
    place.seen.add(r.n)
    const type = ctx.epub ? ' epub:type="noteref"' : ''
    return `<sup class="noteref"><a${type}${first ? ` id="${noteId('fnref', place, r.n)}"` : ''} href="#${noteId('fn', place, r.n)}">${place.base + r.n}</a></sup>`
  }
  let html = esc(r.text)
  if (r.code) html = `<code>${html}</code>`
  if (r.b) html = `<strong>${html}</strong>`
  if (r.i) html = `<em>${html}</em>`
  if (r.s) html = `<del>${html}</del>`
  if (r.u) html = `<u>${html}</u>`
  if (r.href) html = `<a href="${esc(r.href)}">${html}</a>`
  return html
}
const runs = (c: Inline[], ctx: HtmlContext, place: Place) =>
  c.map((r) => run(r, ctx, place)).join('')

const SEPARATOR = {
  stars: '<p class="sep">* * *</p>',
  rule: '<hr class="sep"/>',
  space: '<p class="sep gap">&#160;</p>',
}

function block(b: Block, ctx: HtmlContext, place: Place, p: ExportProfile, offset: number): string {
  switch (b.t) {
    case 'p':
      return `<p>${runs(b.c, ctx, place)}</p>`
    case 'h': {
      const level = Math.min(6, offset + b.level)
      return `<h${level}>${runs(b.c, ctx, place)}</h${level}>`
    }
    case 'break':
      return SEPARATOR[p.separator]
    case 'quote':
      return `<blockquote>${blocks(b.c, ctx, place, p, offset)}</blockquote>`
    case 'code':
      return `<pre><code>${esc(b.text)}</code></pre>`
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul'
      const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : ''
      const items = b.items
        .map((item) => {
          const box = item.checked === undefined ? '' : item.checked ? '&#9745; ' : '&#9744; '
          const inner = blocks(item.c, ctx, place, p, offset)
          // The box goes inside the item's first paragraph.
          return `<li>${inner.startsWith('<p>') ? inner.replace('<p>', `<p>${box}`) : box + inner}</li>`
        })
        .join('')
      return `<${tag}${start}>${items}</${tag}>`
    }
    case 'table': {
      const row = (cells: Inline[][], cell: 'th' | 'td') =>
        `<tr>${cells
          .map((c, i) => {
            const align = b.align[i]
            return `<${cell}${align ? ` class="al-${align[0]}"` : ''}>${runs(c, ctx, place)}</${cell}>`
          })
          .join('')}</tr>`
      const [head, ...body] = b.rows
      return `<table>${head ? `<thead>${row(head, 'th')}</thead>` : ''}<tbody>${body.map((r) => row(r, 'td')).join('')}</tbody></table>`
    }
  }
}
const blocks = (list: Block[], ctx: HtmlContext, place: Place, p: ExportProfile, offset: number) =>
  list.map((b) => block(b, ctx, place, p, offset)).join('')

function sceneHtml(
  s: ExportScene,
  first: boolean,
  ctx: HtmlContext,
  place: Place,
  p: ExportProfile,
  levels: ReturnType<typeof levelsOf>,
): string {
  const out: string[] = []
  if (p.sceneTitles)
    out.push(`<h${levels.scene} class="scene-title">${esc(s.title)}</h${levels.scene}>`)
  else if (!first) out.push(SEPARATOR[p.separator])
  out.push(blocks(s.blocks, ctx, place, p, levels.scene))
  if (s.choices.length) {
    const items = s.choices
      .map((c) => {
        const href = c.targetId ? ctx.sceneHref?.(c.targetId) : undefined
        const target = href ? `<a href="${esc(href)}">${esc(c.target)}</a>` : esc(c.target)
        return `<li>${esc(c.label)} &#8594; ${target}</li>`
      })
      .join('')
    out.push(
      `<div class="choices"><p class="choices-title"><strong>Choices</strong></p><ul>${items}</ul></div>`,
    )
  }
  return `<div class="scene" id="${esc(place.prefix + s.id)}">${out.join('')}</div>`
}

/** A chapter: its part's title when it opens one, its heading, its scenes, and its notes at the end. */
export function chapterHtml(
  book: ExportBook,
  c: ExportChapter,
  profile: ExportProfile,
  ctx: HtmlContext,
): string {
  const levels = levelsOf(book)
  const out: string[] = []
  if (c.part) out.push(`<h${levels.part} class="part-title">${esc(c.part)}</h${levels.part}>`)
  const heading = chapterHeading(c, profile.chapterTitles)
  if (heading)
    out.push(`<h${levels.chapter} class="chapter-title">${esc(heading)}</h${levels.chapter}>`)
  const notes: string[] = []
  let base = 0
  c.scenes.forEach((s, i) => {
    const place: Place = { prefix: ctx.prefix, chapter: c.id, base, seen: new Set() }
    out.push(sceneHtml(s, i === 0, ctx, place, profile, levels))
    for (const n of s.notes) {
      const type = ctx.epub ? ' epub:type="footnote"' : ''
      const back = `<a class="noteback" href="#${noteId('fnref', place, n.n)}">&#8617;</a>`
      const body = blocks(n.c, ctx, { ...place, seen: new Set() }, profile, levels.scene)
      const withBack = body.endsWith('</p>')
        ? `${body.slice(0, -4)} ${back}</p>`
        : `${body}<p>${back}</p>`
      notes.push(
        `<aside${type} id="${noteId('fn', place, n.n)}" class="note"><p class="note-n">${base + n.n}.</p>${withBack}</aside>`,
      )
    }
    base += s.notes.length
  })
  if (notes.length)
    out.push(
      `<section class="notes"><h${levels.scene} class="notes-title">Notes</h${levels.scene}>${notes.join('')}</section>`,
    )
  return `<section class="chapter" id="${esc(ctx.prefix + c.id)}">${out.join('')}</section>`
}

/** The title page: title, subtitle and author; nothing when the profile has none. */
export function titlePageHtml(book: ExportBook, profile: ExportProfile): string {
  if (!profile.titlePage) return ''
  return `<section class="title-page"><h1 class="title">${esc(book.title)}</h1>${book.subtitle ? `<p class="subtitle">${esc(book.subtitle)}</p>` : ''}${book.author ? `<p class="author">${esc(book.author)}</p>` : ''}</section>`
}

/** The styles of an EPUB: little, so a reading app's own fonts and sizes stay in charge. */
export const EPUB_CSS = `body { line-height: 1.5; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; }
p { margin: 0 0 .7em; }
.chapter-title, .part-title { margin: 2em 0 1em; text-align: center; }
.title-page { text-align: center; margin-top: 30%; }
.title-page .subtitle { font-style: italic; }
.sep { text-align: center; margin: 1.5em 0; }
hr.sep { width: 30%; margin-left: auto; margin-right: auto; }
.gap { height: 1.5em; }
blockquote { margin: 1em 1.5em; font-style: italic; }
pre { white-space: pre-wrap; font-size: .9em; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid #888; padding: .25em .5em; }
.al-l { text-align: left; } .al-c { text-align: center; } .al-r { text-align: right; }
.choices { margin: 1.2em 0; }
.note { font-size: .9em; }
.note p { display: inline; margin: 0; }
.note-n { font-weight: bold; margin-right: .3em; }
.noteref { font-size: .75em; }
`
