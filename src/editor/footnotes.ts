// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Node } from '@tiptap/pm/model'

/**
 * Footnotes as the editor sees them. A reference and its note are tied by a label that is the
 * file's own (`[^1]`, `[^note]`) and is never renamed unless the author asks (`renumberPlan`).
 * The number drawn beside a reference is only its place among the references.
 */
export interface FootnoteScan {
  /** Every reference, in the order of the text. */
  refs: { pos: number; label: string }[]
  /** Every note: where it stands, its label and its words. */
  defs: { pos: number; size: number; label: string; text: string }[]
}

export function scanFootnotes(doc: Node): FootnoteScan {
  const refs: FootnoteScan['refs'] = []
  const defs: FootnoteScan['defs'] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnoteRef') refs.push({ pos, label: String(node.attrs.label) })
    else if (node.type.name === 'footnoteDef')
      defs.push({
        pos,
        size: node.nodeSize,
        label: String(node.attrs.label),
        text: node.textBetween(0, node.content.size, ' ').replace(/\s+/g, ' ').trim(),
      })
    return true
  })
  return { refs, defs }
}

/** The number each label is drawn with: its first reference's place, counting from 1. */
export function numberLabels(scan: FootnoteScan): Map<string, number> {
  const numbers = new Map<string, number>()
  for (const { label } of scan.refs) if (!numbers.has(label)) numbers.set(label, numbers.size + 1)
  return numbers
}

/** A label no reference or note uses: one more than the largest number in use. */
export function nextLabel(doc: Node): string {
  const { refs, defs } = scanFootnotes(doc)
  let highest = 0
  for (const { label } of [...refs, ...defs])
    if (/^\d+$/.test(label)) highest = Math.max(highest, Number(label))
  return String(highest + 1)
}

/**
 * Old label → new label when the author asks for the labels to follow the text: 1, 2, 3 in the
 * order of the references, then the notes nothing refers to. `null` when they already do.
 */
export function renumberPlan(scan: FootnoteScan): Map<string, string> | null {
  const order = [...numberLabels(scan).keys()]
  for (const { label } of scan.defs) if (!order.includes(label)) order.push(label)
  const plan = new Map(order.map((label, i) => [label, String(i + 1)]))
  return [...plan].every(([from, to]) => from === to) ? null : plan
}

/**
 * Whether any text kept as written (a block or inline code) mentions a footnote: a note inside a
 * quote or a list, say. Renumbering would leave that text pointing at labels that no longer exist,
 * and cannot reach it, so it is not offered.
 */
export function keptTextMentionsNotes(doc: Node): boolean {
  let found = false
  doc.descendants((node) => {
    if (found) return false
    const kept = node.type.name === 'rawBlock' || node.marks.some((m) => m.type.name === 'verbatim')
    if (kept && node.textContent.includes('[^')) found = true
    return !found
  })
  return found
}
