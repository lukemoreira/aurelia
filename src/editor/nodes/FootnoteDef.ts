// SPDX-License-Identifier: AGPL-3.0-or-later
import { Node } from '@tiptap/core'

/** A footnote's note: `[^1]: …`, its first line after the label and the rest indented under it. */
export const FootnoteDef = Node.create({
  name: 'footnoteDef',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return { label: { default: '1', rendered: false } }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-footnote-def]',
        getAttrs: (el) => ({ label: (el as HTMLElement).getAttribute('data-footnote-def') }),
      },
    ]
  },

  renderHTML({ node }) {
    return ['div', { 'data-footnote-def': String(node.attrs.label), role: 'group' }, 0]
  },

  addKeyboardShortcuts() {
    return {
      // A note with nothing in it goes with its Backspace; one with words in it never does.
      Backspace: ({ editor }) => {
        const { empty, $anchor } = editor.state.selection
        if (!empty || $anchor.parentOffset > 0) return false
        for (let d = $anchor.depth; d > 0; d--) {
          const node = $anchor.node(d)
          if (node.type !== this.type) continue
          if (node.textContent) return false
          return editor.commands.deleteRange({ from: $anchor.before(d), to: $anchor.after(d) })
        }
        return false
      },
    }
  },
})
