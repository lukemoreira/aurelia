// SPDX-License-Identifier: AGPL-3.0-or-later
// A scene's Markdown as plain blocks an export writes out (ADR-0014). It reads the text with the same
// converter the editor uses (`parseMarkdown`, ADR-0007), so a table, a footnote or a callout means here
// what it means on screen; what that converter keeps "as written" is kept as text, never rendered.
import type { JSONContent } from '@tiptap/core'
import { parseMarkdown } from '@/editor/markdown/parse'

export interface Run {
  t: 'text'
  text: string
  b?: true
  i?: true
  s?: true
  u?: true
  code?: true
  /** Only an address an export can follow (http, https, mailto). */
  href?: string
}
export type Inline = Run | { t: 'br' } | { t: 'note'; n: number }

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: { checked?: boolean; c: Block[] }[] }
  /** `rows[0]` is the header; each cell is a run of text. */
  | { t: 'table'; align: (string | null)[]; rows: Inline[][][] }
  | { t: 'code'; text: string }
  | { t: 'break' }

/** A footnote's words, numbered by its first reference in the scene. */
export interface Note {
  n: number
  c: Block[]
}

interface SceneBlocks {
  blocks: Block[]
  notes: Note[]
}

/** What a record is called: how a `[[id:…]]` link with no name of its own is shown. */
export type NameOf = (id: string) => string | undefined

const WIKI = /!?\[\[([^\]]*)\]\]/g
/** `[[Elena]]`, `[[id:chr_x|Elena]]` and `![[Elena]]` are the words a reader sees: the name, nothing else. */
function plainLinks(text: string, nameOf: NameOf = () => undefined): string {
  return text.replace(WIKI, (_m, inner: string) => {
    const bar = inner.lastIndexOf('|')
    const shown = bar >= 0 ? inner.slice(bar + 1) : inner
    if (shown.trim() && !(bar < 0 && inner.startsWith('id:'))) return shown
    return inner.startsWith('id:')
      ? (nameOf(inner.slice(3, bar < 0 ? undefined : bar)) ?? '')
      : shown
  })
}

/** An address an export may link to; anything else (a `javascript:` address, a file) is only its words. */
const safeHref = (href: unknown): string | undefined => {
  if (typeof href !== 'string') return undefined
  try {
    // Written as the URL parser writes it: spaces and odd characters are escaped, so the file stays valid.
    const url = new URL(href.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

const BLOCK_ID = /[ \t]*\^blk-[a-z0-9]+[ \t]*$/
/** Characters XML cannot hold (a stray control character would make a DOCX or an EPUB unreadable). */
export const xmlSafe = (text: string) =>
  // eslint-disable-next-line no-control-regex
  text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')

/** Text the converter kept as written: inline code is code, `[a](b "c")` and `![a](b)` are their words. */
function verbatim(text: string): Pick<Run, 'text' | 'code'> {
  // A comment is for the author: it is not in a Word file, an e-book or a PDF (the Markdown bundle keeps it).
  if (/^<!--[\s\S]*-->$/.test(text)) return { text: '' }
  const code = /^(`+)([\s\S]*?)\1$/.exec(text)
  if (code) return { text: code[2]!.trim(), code: true }
  return {
    text: text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'),
  }
}

class Reader {
  /** Footnote labels in the order they are first referenced: label → number. */
  readonly numbers = new Map<string, number>()
  constructor(
    private readonly nameOf: NameOf,
    /** Labels that have a note: a reference to any other stays as typed. */
    private readonly defined: Set<string>,
    /** Notes read inside a note stay as typed: one level of notes. */
    private readonly inNote = false,
  ) {}

  inline(nodes: JSONContent[] | undefined): Inline[] {
    const out: Inline[] = []
    for (const node of nodes ?? []) {
      if (node.type === 'hardBreak') out.push({ t: 'br' })
      else if (node.type === 'footnoteRef') {
        const label = String(node.attrs?.label ?? '')
        if (this.inNote || !this.defined.has(label)) out.push({ t: 'text', text: `[^${label}]` })
        else {
          if (!this.numbers.has(label)) this.numbers.set(label, this.numbers.size + 1)
          out.push({ t: 'note', n: this.numbers.get(label)! })
        }
      } else if (node.type === 'text' && node.text) {
        const marks = node.marks ?? []
        const kept = marks.some((m) => m.type === 'verbatim' || m.type === 'code')
        const base = kept ? verbatim(node.text) : { text: plainLinks(node.text, this.nameOf) }
        const link = marks.find((m) => m.type === 'link')
        const href = link ? safeHref(link.attrs?.href) : undefined
        const has = (type: string) => marks.some((m) => m.type === type)
        const text = xmlSafe(base.text)
        if (text)
          out.push({
            t: 'text',
            text,
            ...('code' in base ? { code: true as const } : {}),
            ...(has('bold') ? { b: true as const } : {}),
            ...(has('italic') ? { i: true as const } : {}),
            ...(has('strike') ? { s: true as const } : {}),
            ...(has('underline') ? { u: true as const } : {}),
            ...(href ? { href } : {}),
          })
      }
    }
    // A block's own ID (`^blk-a1b2c3`) is for Aurelia, not for a reader.
    const last = out.at(-1)
    if (last?.t === 'text') {
      const text = last.text.replace(BLOCK_ID, '')
      if (text) last.text = text
      else out.pop()
    }
    return out
  }

  blocks(nodes: JSONContent[] | undefined): Block[] {
    return (nodes ?? []).flatMap((n) => this.block(n))
  }

  private block(node: JSONContent): Block[] {
    switch (node.type) {
      case 'paragraph': {
        const c = this.inline(node.content)
        return c.length ? [{ t: 'p', c }] : []
      }
      case 'heading':
        return [{ t: 'h', level: Number(node.attrs?.level) || 1, c: this.inline(node.content) }]
      case 'sceneBreak':
        return [{ t: 'break' }]
      case 'blockquote':
        return [{ t: 'quote', c: this.blocks(node.content) }]
      case 'callout': {
        const kind = String(node.attrs?.kind ?? 'note')
        const title =
          String(node.attrs?.title ?? '').trim() || kind[0]!.toUpperCase() + kind.slice(1)
        const head: Block = { t: 'p', c: [{ t: 'text', text: xmlSafe(title), b: true }] }
        return [{ t: 'quote', c: [head, ...this.blocks(node.content)] }]
      }
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return [
          {
            t: 'list',
            ordered: node.type === 'orderedList',
            start: Number(node.attrs?.start) || 1,
            items: (node.content ?? []).map((item) => ({
              ...(node.type === 'taskList' ? { checked: !!item.attrs?.checked } : {}),
              c: this.blocks(item.content),
            })),
          },
        ]
      case 'table': {
        const rows = (node.content ?? []).map((row) =>
          (row.content ?? []).map((cell) =>
            (cell.content ?? []).flatMap((p) => this.inline(p.content)),
          ),
        )
        const align = (node.content?.[0]?.content ?? []).map(
          (cell) => (cell.attrs?.align as string | null | undefined) ?? null,
        )
        return [{ t: 'table', align, rows }]
      }
      case 'rawBlock':
        return rawBlock(String((node.content ?? []).map((t) => t.text ?? '').join('')))
      default:
        return []
    }
  }
}

/** A fence or an indented block is code; a link definition says nothing to a reader; any other kept text is shown as it is written. */
function rawBlock(text: string): Block[] {
  const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*\n?([\s\S]*)$/.exec(text)
  if (fence) {
    const body = fence[2]!.replace(
      new RegExp(`\\n? {0,3}${fence[1]![0]}{${fence[1]!.length},}\\s*$`),
      '',
    )
    return [{ t: 'code', text: xmlSafe(body) }]
  }
  if (/^(?: {4}|\t)/.test(text))
    return [{ t: 'code', text: xmlSafe(text.replace(/^(?: {4}|\t)/gm, '')) }]
  if (/^ {0,3}\[[^\]]+\]:\s*\S+/.test(text)) return []
  if (/^\s*<!--[\s\S]*-->\s*$/.test(text)) return []
  const c: Inline[] = []
  text.split('\n').forEach((line, i) => {
    if (i) c.push({ t: 'br' })
    if (line) c.push({ t: 'text', text: xmlSafe(line) })
  })
  return c.length ? [{ t: 'p', c }] : []
}

/**
 * A scene's text as blocks and numbered notes. A footnote is numbered by its first reference; a
 * reference with no note stays as typed, and a note nothing refers to is kept as a paragraph at
 * the end, so no words of the scene are left out.
 */
export function sceneBlocks(body: string, nameOf: NameOf = () => undefined): SceneBlocks {
  const nodes = parseMarkdown(body).blocks.map((b) => b.json)
  const defs = new Map<string, JSONContent>()
  const rest: JSONContent[] = []
  for (const n of nodes) {
    if (n.type === 'footnoteDef') defs.set(String(n.attrs?.label), n)
    else rest.push(n)
  }
  const reader = new Reader(nameOf, new Set(defs.keys()))
  const blocks = reader.blocks(rest)
  const inNote = new Reader(nameOf, new Set(), true)
  const notes: Note[] = []
  const orphans: Block[] = []
  for (const [label, def] of defs) {
    const n = reader.numbers.get(label)
    if (n) notes.push({ n, c: inNote.blocks(def.content) })
    else orphans.push(...inNote.blocks(def.content))
  }
  notes.sort((a, b) => a.n - b.n)
  return { blocks: [...blocks, ...orphans], notes }
}

const FENCE = /^( {0,3})(`{3,}|~{3,})/

const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s/
const CODE_SPAN = /(``[^`]+``|`[^`]+`)/

/**
 * A scene's Markdown for a Markdown export: as written, except that links to records are their names
 * and block IDs are gone (they mean something only to Aurelia). Code is left exactly as it is: a fence, an
 * indented block (four spaces after a blank line, outside a list) and a span between backticks.
 */
export function plainMarkdown(body: string, nameOf: NameOf = () => undefined): string {
  let fence = ''
  let blank = true
  let inList = false
  let indented = false
  return body
    .split('\n')
    .map((line) => {
      const open = FENCE.exec(line)
      const empty = !line.trim()
      const wasBlank = blank
      blank = empty
      if (fence) {
        if (open && open[2]!.startsWith(fence[0]!) && open[2]!.length >= fence.length) fence = ''
        return line
      }
      if (open) {
        fence = open[2]!
        return line
      }
      if (empty) return line
      const deep = /^(?: {4}|\t)/.test(line)
      if (!deep) {
        indented = false
        inList = LIST_ITEM.test(line) || (inList && !wasBlank)
      } else if (indented || (wasBlank && !inList)) {
        indented = true
        return line
      }
      return line
        .split(CODE_SPAN)
        .map((piece, i) => (i % 2 ? piece : plainLinks(piece, nameOf)))
        .join('')
        .replace(BLOCK_ID, '')
    })
    .join('\n')
}
