// SPDX-License-Identifier: AGPL-3.0-or-later
import { Extension } from '@tiptap/core'

/** The blocks that stand on their own in a scene's text. */
export const TOP_LEVEL_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'callout',
  'sceneBreak',
  'rawBlock',
]

/**
 * What a block looked like in the file: `src` is its Markdown exactly as read, `sig` says what
 * the block held then. A block whose content still matches `sig` is written back as `src`, byte
 * for byte, so only the blocks the author edits are ever rewritten (ADR-0003 rule 6). Neither is
 * drawn, copied or split off: a new block starts without them.
 */
export const Source = Extension.create({
  name: 'source',
  addGlobalAttributes() {
    return [
      {
        // A list written with blank lines between its items stays that way.
        types: ['bulletList', 'orderedList', 'taskList'],
        attributes: {
          loose: { default: false, rendered: false, parseHTML: () => null },
        },
      },
      {
        types: TOP_LEVEL_TYPES,
        attributes: {
          src: { default: null, rendered: false, keepOnSplit: false, parseHTML: () => null },
          sig: { default: null, rendered: false, keepOnSplit: false, parseHTML: () => null },
        },
      },
    ]
  },
})
