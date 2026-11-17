// SPDX-License-Identifier: AGPL-3.0-or-later
import { Node } from '@tiptap/core'

/**
 * A footnote's reference in the text: `[^1]`. The label is the file's own and is never renamed on
 * its own; the number drawn beside it is only its place among the references (`footnotes.ts`).
 */
export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { label: { default: '1', rendered: false } }
  },

  parseHTML() {
    return [
      {
        tag: 'sup[data-footnote-ref]',
        getAttrs: (el) => ({ label: (el as HTMLElement).getAttribute('data-footnote-ref') }),
      },
    ]
  },

  // The number is the reference's place among the references, so it is not the node's to know:
  // the numbering plugin hands it to the node's view with the note's words and the accessible name.
  renderHTML({ node }) {
    return ['sup', { 'data-footnote-ref': String(node.attrs.label) }]
  },

  // The number is written in the element as text (not drawn by CSS), so a screen reader and the
  // caret's steps over it meet it as a number.
  addNodeView() {
    return ({ node, decorations }) => {
      const dom = document.createElement('sup')
      dom.setAttribute('data-footnote-ref', String(node.attrs.label))
      const paint = (deco: readonly { spec: { footnoteNumber?: string } }[]) => {
        dom.textContent = deco.find((d) => d.spec.footnoteNumber)?.spec.footnoteNumber ?? ''
      }
      paint(decorations)
      return {
        dom,
        update: (updated, deco) => {
          if (updated.type !== node.type) return false
          dom.setAttribute('data-footnote-ref', String(updated.attrs.label))
          paint(deco)
          return true
        },
      }
    }
  },

  // The same words as in the file, so what reads the text (links, tests) sees what is written.
  extendNodeSchema(extension) {
    return extension.name === 'footnoteRef'
      ? { leafText: (node: { attrs: { label: string } }) => `[^${node.attrs.label}]` }
      : {}
  },
})
