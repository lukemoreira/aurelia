// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSONContent } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { schema } from '../extensions'
import { parseMarkdown } from './parse'
import { LIST_FAMILY, LIST_MARKERS, isBlank, renderBlock } from './render'

/**
 * A scene's text ⇄ the editor's document (ADR-0007). The rule that matters: opening a scene
 * and typing nowhere changes no byte. Every block remembers the Markdown it was read from
 * (`src`) and what it held then (`sig`); a block still holding that is written back as read, so
 * only a block the author edited is written again, in the dialect's own form.
 */

/** A short fingerprint of a block's content: its type, its details and what is in it. */
export function sigOf(node: Node): string {
  const attrs = { ...node.attrs }
  delete attrs.src
  delete attrs.sig
  const text = JSON.stringify([node.type.name, attrs, node.content.toJSON()])
  // cyrb53: 53 bits, so two different blocks do not meet by chance.
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

/** The scene's text as the editor's document (always at least one block, so there is a place to type). */
export function bodyToDoc(body: string): JSONContent {
  const { blocks, exact } = parseMarkdown(body)
  if (!blocks.length) return { type: 'doc', content: [{ type: 'paragraph' }] }
  return {
    type: 'doc',
    content: blocks.map(({ json, src }) => {
      if (!exact) return json
      const sig = sigOf(schema.nodeFromJSON(json))
      return { ...json, attrs: { ...json.attrs, src, sig } }
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
}

/** The marker a list's own Markdown starts with: `-`, `*`, `+`, or the `.` or `)` after a number. */
const markerOf = (src: string) => {
  const m = /^\s{0,3}(?:([-*+])|\d{1,9}([.)]))/.exec(src)
  return m?.[1] ?? m?.[2]
}

function pieceOf(node: Node): Piece | null {
  if (isBlank(node)) return null
  const { src, sig } = node.attrs as { src: unknown; sig: unknown }
  const family = LIST_FAMILY[node.type.name]
  if (typeof src === 'string' && sig === sigOf(node))
    return {
      node,
      text: src,
      kept: true,
      trail: null,
      family,
      marker: family ? markerOf(src) : undefined,
    }
  return {
    node,
    text: '',
    kept: false,
    trail: typeof src === 'string' ? (/\s*$/.exec(src)?.[0] ?? '') : null,
    family,
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
  let out = ''
  all.forEach((p, i) => {
    const last = i === all.length - 1
    const before = all[i - 1]
    // A block never runs into the one before it: at least one blank line between. Two blocks
    // kept as read, whose old neighbours were not these, are checked: they may only touch when
    // they still read as two blocks.
    if (out && !/\n\r?\n$/.test(out)) {
      const apart =
        !before?.kept || !p.kept || parseMarkdown(before.text + p.text).blocks.length < 2
      if (apart) out += out.endsWith('\n') ? (out.endsWith('\r\n') ? '\r\n' : '\n') : '\n\n'
    }
    if (p.kept) out += p.text
    else {
      const old = p.trail
      const trail = old === null ? (last ? '\n' : '\n\n') : last && old.length > 1 ? '\n' : old
      out += renderBlock(p.node, p.marker) + trail
    }
  })
  return out
}
