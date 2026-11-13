// SPDX-License-Identifier: AGPL-3.0-or-later
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const LEAD_WORDS = 5

/**
 * The first few words of a scene, in small capitals (the writing screen's design). Drawn only:
 * the text is not touched. A short first paragraph is left whole.
 */
export function leadInRange(doc: Node): { from: number; to: number } | null {
  const first = doc.firstChild
  if (first?.type.name !== 'paragraph') return null
  const text = first.textContent
  const words = text.split(/(\s+)/)
  if (words.length <= LEAD_WORDS * 2) return null
  const lead = words.slice(0, LEAD_WORDS * 2 - 1).join('')
  // The paragraph's text starts at 1. Only while it is all text do its characters and positions agree.
  let onlyText = true
  first.forEach((child) => {
    if (!child.isText) onlyText = false
  })
  return onlyText ? { from: 1, to: 1 + lead.length } : null
}

export const LeadIn = Extension.create({
  name: 'leadIn',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: ({ doc }) => {
            const range = leadInRange(doc)
            return range
              ? DecorationSet.create(doc, [
                  Decoration.inline(range.from, range.to, { class: 'lead-in' }),
                ])
              : null
          },
        },
      }),
    ]
  },
})
