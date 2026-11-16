// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Node } from '@tiptap/pm/model'

/**
 * The prose of the editor's document as one string, so the same code that reads a scene's text
 * (links, names) reads what is on screen. Blocks are told apart by a blank line, a hard break is a
 * line break, and inline code and kept-as-written text keep their own characters (backticks
 * included), so code is skipped the same way as in the file.
 */
export interface DocText {
  text: string
  /** The document position of the character at `offset`. */
  at(offset: number): number
  /** The document range of `[start, end)` in `text`. */
  range(start: number, end: number): [from: number, to: number]
}

export function docText(doc: Node): DocText {
  let text = ''
  /** Pieces of text in the string and where each starts in the document. */
  const starts: { offset: number; pos: number }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (text) text += '\n\n'
    node.forEach((child, offset) => {
      const childPos = pos + 1 + offset
      if (child.isText) {
        starts.push({ offset: text.length, pos: childPos })
        text += child.text
      } else {
        starts.push({ offset: text.length, pos: childPos })
        text += child.type.name === 'hardBreak' ? '\n' : '￼'
      }
    })
    return false
  })
  const at = (offset: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid]!.offset <= offset) lo = mid
      else hi = mid - 1
    }
    const piece = starts[lo]
    return piece ? piece.pos + (offset - piece.offset) : 0
  }
  return {
    text,
    at,
    // An end offset is the position just after its last character, not the start of what follows.
    range: (start, end) => [at(start), end > start ? at(end - 1) + 1 : at(start)],
  }
}
