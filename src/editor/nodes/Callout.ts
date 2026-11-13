// SPDX-License-Identifier: AGPL-3.0-or-later
import { InputRule, mergeAttributes, Node } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: { toggleCallout: () => ReturnType }
  }
}

/** The label a callout shows when it has no title of its own: its kind, capitalised. */
export const calloutLabel = (kind: string, title: string) =>
  title || kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase()

/** A callout: `> [!note] Title` and the quoted lines under it (GitHub and Obsidian style). */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: { default: 'note', rendered: false },
      title: { default: '', rendered: false },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { kind, title } = node.attrs as { kind: string; title: string }
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-callout': kind.toLowerCase(),
        'data-title': calloutLabel(kind, title),
        role: 'group',
        'aria-label': calloutLabel(kind, title),
      }),
      0,
    ]
  },

  addCommands() {
    return {
      toggleCallout:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    }
  },

  addInputRules() {
    // Typing `> ` makes a quote; `[!note] ` as its first words turns that quote into a callout.
    return [
      new InputRule({
        find: /^\[!([\w-]+)\]\s$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.depth < 2 || $from.node($from.depth - 1).type.name !== 'blockquote') return null
          state.tr
            .delete(range.from, range.to)
            .setNodeMarkup($from.before($from.depth - 1), this.type, { kind: match[1] })
          return undefined
        },
      }),
    ]
  },
})
