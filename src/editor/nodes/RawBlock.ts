// SPDX-License-Identifier: AGPL-3.0-or-later
import { Node } from '@tiptap/core'

/**
 * A block Aurelia cannot edit yet — a table, a footnote, a code block, raw HTML — kept as its
 * Markdown text, exactly as written. It is shown as plain text and never rendered, so an HTML
 * block is only ever letters on the page (ADR-0003: HTML is escaped, never rendered).
 */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  parseHTML() {
    return [{ tag: 'pre[data-raw-block]', preserveWhitespace: 'full' }]
  },

  renderHTML() {
    return [
      'pre',
      {
        'data-raw-block': '',
        role: 'group',
        'aria-label': 'Kept as Markdown, exactly as written',
        title:
          'Kept as Markdown, exactly as written, until Aurelia can edit it. It is shown as text and never rendered.',
      },
      0,
    ]
  },

  addKeyboardShortcuts() {
    return {
      // An empty one turns back into a paragraph, so it is never a trap.
      Backspace: ({ editor }) => {
        const { empty, $anchor } = editor.state.selection
        if (!empty || $anchor.parent.type !== this.type || $anchor.parent.content.size > 0)
          return false
        return editor.commands.setNode('paragraph')
      },
    }
  },
})
