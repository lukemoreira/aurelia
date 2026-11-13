// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSONContent } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { schema } from '../extensions'
import { parseMarkdown } from './parse'
import { LIST_FAMILY, LIST_MARKERS, isBlank, renderBlock, type ListShape } from './render'

/**
 * A scene's text ⇄ the editor's document (ADR-0007). The rule that matters: opening a scene
 * and typing nowhere changes no byte. Every block remembers the Markdown it was read from
 * (`src`) and what it held then (`sig`); a block still holding that is written back as read, so
 * only a block the author edited is written again, in the dialect's own form.
 */

/** cyrb53: 53 bits, so two different texts do not meet by chance. */
function hashText(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** A short fingerprint of a block's content: its type, its details and what is in it. */
export function sigOf(node: Node): string {
  const attrs = { ...node.attrs }
  for (const key of ['src', 'sig', 'nx']) delete attrs[key]
  return hashText(JSON.stringify([node.type.name, attrs, node.content.toJSON()]))
}

/** The scene's text as the editor's document (always at least one block, so there is a place to type). */
export function bodyToDoc(body: string): JSONContent {
  const { blocks, exact } = parseMarkdown(body)
  if (!blocks.length) return { type: 'doc', content: [{ type: 'paragraph' }] }
  return {
    type: 'doc',
    content: blocks.map(({ json, src }, i) => {
      if (!exact) return json
      const sig = sigOf(schema.nodeFromJSON(json))
      // `nx` says which text followed this block in the file, so two neighbours that were
      // touching are known to be able to touch.
      const nx = i < blocks.length - 1 ? hashText(blocks[i + 1]!.src) : null
      return { ...json, attrs: { ...json.attrs, src, sig, nx } }
    }),
  }
}

interface Piece {
  node: Node
  /** Its Markdown, without the blank lines after it, unless `kept`. */
  text: string
  kept: boolean
  /** The blank lines the block had after it when it was read. */
  trail: string | null
  /** For a list: the kind, and the marker it is written with. */
  family?: string
  marker?: string
  /** For a list written again: how its first item was laid out. */
  shape?: ListShape
  /** For a block kept as read: a fingerprint of the text that followed it in the file. */
  nx?: unknown
}

/** The marker a list's own Markdown starts with: `-`, `*`, `+`, or the `.` or `)` after a number. */
const markerOf = (src: string) => {
  const m = /^\s{0,3}(?:([-*+])|\d{1,9}([.)]))/.exec(src)
  return m?.[1] ?? m?.[2]
}

/**
 * How a list was laid out: its indent, and the column its items' text began at (tabs go to
 * multiples of 4), the widest of its items, so what follows it in the file stays outside it.
 */
function shapeOf(src: string): ListShape | undefined {
  let shape: ListShape | undefined
  for (const m of src.matchAll(/^( {0,3})([-*+]|\d{1,9}[.)])([ \t]*)(?=\S|$)/gm)) {
    let col = m[1]!.length + m[2]!.length
    const start = col
    for (const ch of m[3]!) col += ch === '\t' ? 4 - (col % 4) : 1
    // Five spaces or more after the marker are one space and an indented code block.
    const width = col - start > 4 ? start + 1 : col
    // Only the list's own items (the first one's indent), not a list nested in them.
    if (!shape) shape = { indent: m[1]!.length, width }
    else if (m[1]!.length === shape.indent && width > shape.width) shape.width = width
  }
  return shape
}

function pieceOf(node: Node): Piece | null {
  const { src, sig } = node.attrs as { src: unknown; sig: unknown }
  const kept = typeof src === 'string' && sig === sigOf(node)
  // A block with nothing in it is not written, unless it was read like that (`#` is a heading).
  if (isBlank(node) && !kept) return null
  const family = LIST_FAMILY[node.type.name]
  if (kept)
    return {
      node,
      text: src as string,
      kept: true,
      trail: null,
      family,
      marker: family ? markerOf(src as string) : undefined,
      nx: (node.attrs as { nx?: unknown }).nx,
    }
  return {
    node,
    text: '',
    kept: false,
    trail: typeof src === 'string' ? (/\s*$/.exec(src)?.[0] ?? '') : null,
    family,
    shape: family && typeof src === 'string' ? shapeOf(src) : undefined,
  }
}

/**
 * Lists that follow each other must not read back as one list, so a list written fresh takes a
 * marker that differs from the lists beside it, whatever marker those have (a list kept as read
 * keeps its own).
 */
function chooseMarkers(all: Piece[]) {
  all.forEach((p, i) => {
    if (p.kept || !p.family) return
    const neighbours = [all[i - 1], all[i + 1]]
      .filter((n) => n?.family === p.family)
      .map((n) => n!.marker)
    const options = LIST_MARKERS[p.family]!
    p.marker = options.find((m) => !neighbours.includes(m)) ?? options[0]
  })
}

/**
 * The editor's document as the scene's text. A block that was not edited is its old Markdown
 * exactly; one that was is written fresh, keeping the spacing it had. Empty paragraphs hold
 * no words and are not written.
 */
export function docToBody(doc: Node): string {
  const all: Piece[] = []
  doc.forEach((node) => {
    const piece = pieceOf(node)
    if (piece) all.push(piece)
  })
  chooseMarkers(all)
  const first = write(all, false)
  // An edit can change how the blocks around it read (a line that no longer interrupts a
  // paragraph, a list that now takes the next line in). The text around each block written
  // again is read once more; if it is not the blocks it was written from, every block is parted
  // from the next.
  const bad = all.some((p, i) => {
    if (p.kept) return false
    const lo = Math.max(0, i - 2)
    const hi = Math.min(all.length - 1, i + 2)
    const text = first.out.slice(first.starts[lo], first.starts[hi + 1] ?? first.out.length)
    return parseMarkdown(text).blocks.length !== hi - lo + 1
  })
  return bad ? write(all, true).out : first.out
}

function write(all: Piece[], strict: boolean): { out: string; starts: number[] } {
  let out = ''
  const starts: number[] = []
  all.forEach((p, i) => {
    const last = i === all.length - 1
    const before = all[i - 1]
    // A block never runs into the one before it: at least one blank line between. Two blocks
    // kept as read, whose old neighbours were not these, are checked: they may only touch when
    // they still read as two blocks.
    if (out && !/\n\r?\n$/.test(out)) {
      // Touching neighbours that were so in the file stay so. Others, kept as read, touch only
      // if the text so far and this block still read as one block more.
      const apart =
        strict ||
        !before?.kept ||
        !p.kept ||
        (before.nx !== hashText(p.text) &&
          parseMarkdown(out + p.text).blocks.length <= parseMarkdown(out).blocks.length)
      if (apart) out += out.endsWith('\n') ? (out.endsWith('\r\n') ? '\r\n' : '\n') : '\n\n'
    }
    starts.push(out.length)
    if (p.kept) out += p.text
    else {
      const old = p.trail
      const trail = old === null ? (last ? '\n' : '\n\n') : last && old.length > 1 ? '\n' : old
      out += renderBlock(p.node, p.marker, p.shape) + trail
    }
  })
  return { out, starts }
}
