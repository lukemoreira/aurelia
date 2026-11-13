// SPDX-License-Identifier: AGPL-3.0-or-later
import { mergeAttributes } from '@tiptap/core'
import TiptapHeading from '@tiptap/extension-heading'

/**
 * A heading in the text. The page's own `<h1>` is the scene's title, so a `#` in the text is
 * drawn as an `<h2>`, `##` as an `<h3>` and so on (never past `<h6>`): a screen reader's list of
 * headings has one first level. The file's level is kept in `data-level`, which the stylesheet
 * sizes by and which reads back when the heading is copied.
 */
export const Heading = TiptapHeading.extend({
  parseHTML() {
    return [
      {
        tag: 'h1, h2, h3, h4, h5, h6',
        getAttrs: (el) => {
          const dom = el as HTMLElement
          const level = Number(dom.dataset.level ?? dom.tagName.slice(1))
          return this.options.levels.includes(level as 1) ? { level } : false
        },
      },
    ]
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = Number(node.attrs.level)
    return [
      `h${Math.min(level + 1, 6)}`,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-level': level }),
      0,
    ]
  },
})
