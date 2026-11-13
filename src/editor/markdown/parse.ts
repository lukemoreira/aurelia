// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSONContent } from '@tiptap/core'
import { Lexer } from 'marked'

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

const OPTIONS = { gfm: true, breaks: false, pedantic: false }
const lex = (md: string) => Lexer.lex(md, OPTIONS) as unknown as Tok[]

const FOOTNOTE_DEFINITION = /^\[\^[^\]\s]+\]:/
const CALLOUT_OPENING = /^\[!([\w-]+)\][ \t]*([^\n]*)(?:\n|$)/

type Mark = NonNullable<JSONContent['marks']>[number]
const VERBATIM: Mark = { type: 'verbatim' }

/** Inline tokens → text with marks. What is not understood is kept as written, marked `verbatim`. */
function inline(tokens: Tok[] | undefined, marks: Mark[]): JSONContent[] {
  const out: JSONContent[] = []
  const text = (raw: string, extra: Mark[] = []) => {
    // A paragraph holds no blank line: `marked` can hand back one in an item's lazy lines
    // (`- a\n=\n[^1]: b`), and written out it would split the paragraph.
    const value = raw.replace(/\n[ \t]*\n[\s]*/g, '\n')
    const all = [...marks, ...extra]
    if (value)
      out.push(
        all.length ? { type: 'text', text: value, marks: all } : { type: 'text', text: value },
      )
  }
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
        out.push(...inline(t.tokens, [...marks, { type: 'bold' }]))
        break
      case 'em':
        out.push(...inline(t.tokens, [...marks, { type: 'italic' }]))
        break
      case 'del':
        out.push(...inline(t.tokens, [...marks, { type: 'strike' }]))
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
  let text = t.text ?? t.raw.replace(/\n+$/, '')
  if (box && text.startsWith(box)) text = text.slice(box.length)
  const kids = (t.tokens ?? []).filter((k) => k.type !== 'checkbox')
  if (kids.length && kids.map((k) => k.raw).join('') === text) return kids
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
    default:
      // A table, a code block, HTML, a link definition, anything else: kept as written.
      return rawBlock(t)
  }
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
  const tokens = lex(crlf ? md.replace(/\r\n/g, '\n') : md)
  const parsed: ParsedBlock[] = []
  let lead = ''
  for (const t of tokens) {
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
