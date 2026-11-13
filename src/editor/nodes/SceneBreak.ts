// SPDX-License-Identifier: AGPL-3.0-or-later
import { mergeAttributes, Node, nodeInputRule } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sceneBreak: { setSceneBreak: () => ReturnType }
  }
}

/** A scene break, written `* * *`. Any thematic break in a file reads as one. */
export const SceneBreak = Node.create({
  name: 'sceneBreak',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-scene-break]' }, { tag: 'hr' }]
  },

  // The three stars are drawn by CSS, so the node itself is empty.
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-scene-break': '',
        role: 'separator',
        'aria-label': 'Scene break',
      }),
    ]
  },

  addCommands() {
    return {
      setSceneBreak:
        () =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name }, { type: 'paragraph' }]),
    }
  },

  addInputRules() {
    return [nodeInputRule({ find: /^(?:---|—-|___|\*\*\*)\s$/, type: this.type })]
  },
})
