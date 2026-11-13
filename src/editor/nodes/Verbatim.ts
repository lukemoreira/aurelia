// SPDX-License-Identifier: AGPL-3.0-or-later
import { Mark } from '@tiptap/core'

/**
 * Text kept exactly as it was written: inline code, an image, a bare link, a span of HTML.
 * Aurelia does not render them; it shows the characters and writes the same characters back,
 * with nothing escaped or reshaped.
 */
export const Verbatim = Mark.create({
  name: 'verbatim',
  inclusive: false,

  parseHTML() {
    return [{ tag: 'span[data-verbatim]' }]
  },

  renderHTML() {
    return ['span', { 'data-verbatim': '' }, 0]
  },
})
