// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSONContent } from '@tiptap/core'
import { Lexer, Tokenizer } from 'marked'

/** The part of a `marked` token that is read here. */
interface Tok {
  type: string
  raw: string
  text?: string
  tokens?: Tok[]
  items?: Tok[]
  depth?: number
  ordered?: boolean
  start?: number | ''
  task?: boolean
  loose?: boolean
  checked?: boolean
  href?: string
  title?: string | null
  /** A table's header cells, rows (each a list of cells) and the alignment of each column. */
  header?: Tok[]
  rows?: Tok[][]
  align?: (string | null)[]
}

export interface ParsedBlock {
  json: JSONContent
  /** The block's Markdown exactly as read, with the blank lines after it. */
  src: string
}

export interface ParsedMarkdown {
  blocks: ParsedBlock[]
  /** The blocks' sources put end to end are the text that was read, so each can be written back as read. */
  exact: boolean
}

/**
 * `marked` keeps every link definition of a file in one table, and a footnote's line that looks
 * like one (`[^1]: https://…`) would make every `[^1]` in the file read as a link, wherever it
 * stands and whatever its neighbours say. A footnote's label is not a link's: its definition is
 * left out of the table.
 */
class NoteSafeTokenizer extends Tokenizer {
  override def(src: string) {
    const token = super.def(src)
    if (token?.tag.startsWith('^')) token.tag = `\0${token.tag}`
    return token
  }
}

const OPTIONS = { gfm: true, breaks: false, pedantic: false }
const lex = (md: string) =>
  new Lexer({ ...OPTIONS, tokenizer: new NoteSafeTokenizer() }).lex(md) as unknown as Tok[]

const FOOTNOTE_DEFINITION = /^\[\^[^\]\s]+\]:/
/**
 * A footnote's reference, `[^1]`, anywhere in a line; and its definition, only at the start of one.
 * A label is anything but space, a bracket, a backslash or what Markdown reads (`*`, a backtick,
 * `<`, `>`, `~`): `[^né]` and `[^a.b]` are labels like `[^1]`.
 */
const FOOTNOTE_REFERENCE = /\[\^([^\]\s\\[*`<>~]+)\]/g
const FOOTNOTE_START = /^\[\^([^\]\s\\[*`<>~]+)\]:/
const CALLOUT_OPENING = /^\[!([\w-]+)\][ \t]*([^\n]*)(?:\n|$)/

type Mark = NonNullable<JSONContent['marks']>[number]
const VERBATIM: Mark = { type: 'verbatim' }

/** The marks plus one more; `**x* y**` reads as two italics, which is one. */
const withMark = (marks: Mark[], type: string): Mark[] =>
  marks.some((m) => m.type === type) ? marks : [...marks, { type }]

/** Inline tokens → text with marks. What is not understood is kept as written, marked `verbatim`. */
function inline(tokens: Tok[] | undefined, marks: Mark[]): JSONContent[] {
  const out: JSONContent[] = []
  const text = (raw: string, extra: Mark[] = []) => {
    // A paragraph holds no blank line: `marked` can hand back one in an item's lazy lines
    // (`- a\n=\n[^1]: b`), and written out it would split the paragraph.
    let value = raw.replace(/\n[ \t]*\n[\s]*/g, '\n')
    // After a hard break the next line's leading spaces, and a newline `marked` adds, are not text.
    if (out.at(-1)?.type === 'hardBreak') value = value.replace(/^[ \t\n]+/, '')
    const all = [...marks, ...extra]
    const piece = (text: string) =>
      text && out.push(all.length ? { type: 'text', text, marks: all } : { type: 'text', text })
    // `[^1]` is a footnote's reference, except in text kept as written (inline code, a tag).
    if (all.some((m) => m.type === 'verbatim')) return void piece(value)
    let from = 0
    for (const m of value.matchAll(FOOTNOTE_REFERENCE)) {
      piece(value.slice(from, m.index))
      reference(m[1]!, all)
      from = m.index + m[0].length
    }
    piece(value.slice(from))
  }
  const reference = (label: string, all: Mark[]) =>
    out.push({
      type: 'footnoteRef',
      attrs: { label },
      ...(all.length ? { marks: all } : {}),
    })
  const list = tokens ?? []
  for (let i = 0; i < list.length; i++) {
    const t = list[i]!
    switch (t.type) {
      case 'text':
        if (t.tokens?.length) out.push(...inline(t.tokens, marks))
        else text(t.raw)
        break
      case 'escape':
        text(t.raw.slice(1))
        break
      case 'checkbox':
        break // a loose item's box sits in its first paragraph; the item already says it
      case 'strong':
        out.push(...inline(t.tokens, withMark(marks, 'bold')))
        break
      case 'em':
        out.push(...inline(t.tokens, withMark(marks, 'italic')))
        break
      case 'del':
        out.push(...inline(t.tokens, withMark(marks, 'strike')))
        break
      case 'br':
        out.push({ type: 'hardBreak' })
        break
      case 'link':
        // Only `[text](address)` is a link here; an address in angle brackets, a bare address,
        // a link with a title and a reference link stay as written.
        if (t.raw.startsWith('[') && t.raw.includes('](') && !t.title && t.href) {
          out.push(...inline(t.tokens, [...marks, { type: 'link', attrs: { href: t.href } }]))
        } else text(t.raw, [VERBATIM])
        break
      case 'html': {
        // `<u>…</u>` is underline. Every other tag is text: shown, never rendered.
        const close = t.raw === '<u>' ? closingUnderline(list, i) : -1
        if (close > i) {
          out.push(...inline(list.slice(i + 1, close), [...marks, { type: 'underline' }]))
          i = close
        } else text(t.raw, [VERBATIM])
        break
      }
      default:
        text(t.raw, [VERBATIM])
    }
  }
  return out
}

/** The index of the `</u>` that closes the `<u>` at `open`, or -1. */
function closingUnderline(tokens: Tok[], open: number): number {
  let depth = 1
  for (let j = open + 1; j < tokens.length; j++) {
    const t = tokens[j]!
    if (t.type !== 'html') continue
    if (t.raw === '<u>') depth++
    else if (t.raw === '</u>' && --depth === 0) return j
  }
  return -1
}

const paragraph = (content: JSONContent[]): JSONContent =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' }

const rawBlock = (t: Tok): JSONContent => {
  const text = t.raw.replace(/\n+$/, '')
  return text ? { type: 'rawBlock', content: [{ type: 'text', text }] } : { type: 'rawBlock' }
}

/**
 * The inline tokens of a paragraph or an item's text, without a checkbox (the item says it).
 * `marked` reads an item's text with its checkbox still in it, so tokens can hold the box a
 * second time (`- [ ] [` gives the text `[ ] [`). Tokens that do not add up to the text are
 * read again from the text.
 */
function inlineTokens(t: Tok): Tok[] {
  const box = t.tokens?.[0]?.type === 'checkbox' ? t.tokens[0].raw : ''
  const trim = (value: string) => value.replace(/\n+$/, '')
  let text = trim(t.text ?? t.raw)
  if (box && text.startsWith(box)) text = text.slice(box.length)
  const kids = (t.tokens ?? []).filter((k) => k.type !== 'checkbox')
  if (kids.length && trim(kids.map((k) => k.raw).join('')) === text) {
    // A tight item's text keeps the newline that came before its nested list.
    const last = kids[kids.length - 1]!
    return last.type === 'text' && last.raw !== trim(last.raw)
      ? [...kids.slice(0, -1), { ...last, raw: trim(last.raw) }]
      : kids
  }
  return Lexer.lexInline(text, OPTIONS) as unknown as Tok[]
}

/** Block tokens → nodes; there is always at least one, because a quote or an item cannot be empty. */
function blocks(tokens: Tok[] | undefined): JSONContent[] {
  const out = (tokens ?? []).map(block).filter((n): n is JSONContent => n !== null)
  return out.length ? out : [{ type: 'paragraph' }]
}

function block(t: Tok): JSONContent | null {
  switch (t.type) {
    case 'space':
    case 'checkbox':
      return null
    case 'paragraph':
      return FOOTNOTE_DEFINITION.test(t.text ?? '')
        ? rawBlock(t)
        : paragraph(inline(inlineTokens(t), []))
    case 'text':
      return paragraph(inline(inlineTokens(t), []))
    case 'heading': {
      const content = inline(t.tokens, [])
      const attrs = { level: t.depth }
      return content.length ? { type: 'heading', attrs, content } : { type: 'heading', attrs }
    }
    case 'hr':
      return { type: 'sceneBreak' }
    case 'blockquote':
      return quote(t)
    case 'list':
      return list(t)
    case 'table':
      return table(t)
    default:
      // A table, a code block, HTML, a link definition, anything else: kept as written.
      return rawBlock(t)
  }
}

/**
 * How many cells a table line has, counted the way `marked` splits it: an unescaped `|` ends a
 * cell (inside a code span too), and a pipe at either edge does not make an empty one.
 */
function cellCount(line: string): number {
  const row = line.replace(/\|/g, (_m, offset: number, whole: string) => {
    let escaped = false
    for (let i = offset - 1; i >= 0 && whole[i] === '\\'; i--) escaped = !escaped
    return escaped ? '|' : ' |'
  })
  const cells = row.split(/ \|/)
  if (!cells[0]!.trim()) cells.shift()
  if (cells.length && !cells.at(-1)!.trim()) cells.pop()
  return cells.length
}

/**
 * A GFM table: a row of header cells, then rows. `marked` drops the cells a row has beyond the
 * header's, so a table with such a row is not read as one: it is kept as written.
 */
function table(t: Tok): JSONContent {
  const header = t.header ?? []
  const lines = t.raw.replace(/\n+$/, '').split('\n')
  const body = lines.slice(2)
  if (
    (t.rows ?? []).length !== body.length ||
    [lines[0]!, ...body].some((l) => cellCount(l) > header.length)
  )
    return rawBlock(t)
  const row = (cells: Tok[], type: string) => ({
    type: 'tableRow',
    content: cells.map((cell, i) => {
      const align = t.align?.[i]
      return {
        type,
        ...(align ? { attrs: { align } } : {}),
        content: [paragraph(inline(cell.tokens, []))],
      }
    }),
  })
  return {
    type: 'table',
    content: [row(header, 'tableHeader'), ...(t.rows ?? []).map((r) => row(r, 'tableCell'))],
  }
}

/**
 * Footnote definitions starting at token `i`: `[^1]: first line`, and what is indented under it
 * (the lines of its paragraph, then more blocks after a blank line, each indented). One
 * paragraph can hold several definitions; each is a block with the part of the text that is its
 * own, so an untouched one is written back as read. Returns null where no definition starts.
 */
function definitions(tokens: Tok[], i: number): NoteGroup | null {
  const group = noteGroup(tokens, i)
  if (!group) return null
  // Each note must read the same alone: its neighbours decide how `marked` reads a lazy line
  // (`2) x` is a list after a definition and a line of text after a paragraph), and one that
  // read otherwise once a blank line stood before it would be changed by an edit beside it.
  const alone = group.blocks.every(({ json, src }) => {
    const own = lex(src)
    while (own.at(-1)?.type === 'space') own.pop()
    const again = noteGroup(own, 0)
    return (
      again?.end === own.length - 1 &&
      again.blocks.length === 1 &&
      JSON.stringify(again.blocks[0]!.json) === JSON.stringify(json)
    )
  })
  return alone ? group : null
}

interface NoteGroup {
  end: number
  blocks: ParsedBlock[]
}

function noteGroup(tokens: Tok[], i: number): NoteGroup | null {
  const first = tokens[i]!
  if ((first.type !== 'paragraph' && first.type !== 'def') || !FOOTNOTE_START.test(first.raw))
    return null
  // What belongs to a note: its lazy lines, which `marked` sets apart from a first line that
  // reads as a link definition (`[^1]: word`, then a line of text), and the indented blocks
  // after a blank line, which it reads as code.
  let end = i
  for (let j = i + 1; j < tokens.length; j++) {
    const k = tokens[j]!
    const touching = end === j - 1 && !/\n[ \t]*\n$/.test(tokens[end]!.raw)
    if (k.type === 'code' && /^(?: {4}|\t)/.test(k.raw)) end = j
    else if (touching && (k.type === 'paragraph' || k.type === 'def' || k.type === 'text')) end = j
    else if (k.type !== 'space') break
  }
  const raw = tokens
    .slice(i, end + 1)
    .map((k) => k.raw)
    .join('')
  const starts = [...raw.matchAll(/^\[\^[^\]\s\\[*`<>~]+\]:/gm)].map((m) => m.index)
  const found = starts.map((at, n) => {
    const src = raw.slice(at, starts[n + 1] ?? raw.length)
    const label = FOOTNOTE_START.exec(src)![1]!
    const text = src
      .replace(FOOTNOTE_START, '')
      .replace(/^[ \t]+/, '')
      .split('\n')
      .map((line, k) => (k ? line.replace(/^(?: {1,4}|\t)/, '') : line))
      .join('\n')
      .replace(/\s+$/, '')
    return {
      json: { type: 'footnoteDef', attrs: { label }, content: blocks(lex(text)) },
      src,
    }
  })
  return { end, blocks: found }
}

function quote(t: Tok): JSONContent {
  const opening = CALLOUT_OPENING.exec(t.text ?? '')
  if (!opening) return { type: 'blockquote', content: blocks(t.tokens) }
  const body = lex((t.text ?? '').slice(opening[0].length))
  return {
    type: 'callout',
    attrs: { kind: opening[1], title: opening[2]!.trim() },
    content: blocks(body),
  }
}

function list(t: Tok): JSONContent {
  const items = t.items ?? []
  const allTasks = items.every((i) => i.task)
  const type = t.ordered ? 'orderedList' : allTasks ? 'taskList' : 'bulletList'
  const asTask = type === 'taskList'
  return {
    type,
    attrs: {
      loose: !!t.loose,
      ...(type === 'orderedList' ? { start: typeof t.start === 'number' ? t.start : 1 } : {}),
    },
    content: items.map((item) => {
      const content = blocks(item.tokens)
      if (content[0]!.type !== 'paragraph') content.unshift({ type: 'paragraph' })
      // A checkbox in a list that is not a checklist stays in the text, as written.
      if (item.task && !asTask) {
        const box = { type: 'text', text: item.checked ? '[x] ' : '[ ] ', marks: [VERBATIM] }
        content[0] = { ...content[0]!, content: [box, ...(content[0]!.content ?? [])] }
      }
      return asTask
        ? { type: 'taskItem', attrs: { checked: !!item.checked }, content }
        : { type: 'listItem', content }
    }),
  }
}

/**
 * Markdown → nodes, one per top-level block, each with the source it came from. A text whose
 * lines all end in CRLF is read as LF and its sources are given their CRLF back, so a file
 * with Windows line endings under details with Unix ones is still written back as read.
 */
export function parseMarkdown(md: string): ParsedMarkdown {
  const crlf = md.includes('\r\n')
  let tokens: Tok[]
  try {
    tokens = lex(crlf ? md.replace(/\r\n/g, '\n') : md)
  } catch {
    // `marked` itself can fail on some text: all of it is then one block, kept as written.
    const text = md.replace(/(\r?\n)+$/, '')
    return {
      blocks: [{ json: { type: 'rawBlock', content: [{ type: 'text', text }] }, src: md }],
      exact: true,
    }
  }
  const parsed: ParsedBlock[] = []
  let lead = ''
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    const notes = definitions(tokens, i)
    if (notes) {
      for (const note of notes.blocks) {
        parsed.push({ json: note.json, src: lead + note.src })
        lead = ''
      }
      i = notes.end
      continue
    }
    const json = block(t)
    if (json) {
      parsed.push({ json, src: lead + t.raw })
      lead = ''
    } else if (parsed.length) parsed[parsed.length - 1]!.src += t.raw
    else lead += t.raw
  }
  if (crlf) for (const b of parsed) b.src = b.src.replace(/\n/g, '\r\n')
  // True when the sources, end to end, are the text that was read.
  const exact = parsed.map((b) => b.src).join('') === md || (!parsed.length && lead === md)
  return { blocks: parsed, exact }
}
