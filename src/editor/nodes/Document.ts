// SPDX-License-Identifier: AGPL-3.0-or-later
import { Node } from '@tiptap/core'

/**
 * The scene's text: blocks, and footnote definitions, which stand only at the top (a note inside
 * a quote or a list is a block kept as written, as it always was).
 */
export const Document = Node.create({
  name: 'doc',
  topNode: true,
  content: '(block|footnoteDef)+',
})
