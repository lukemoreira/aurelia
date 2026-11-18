// SPDX-License-Identifier: AGPL-3.0-or-later
// The assistant's suggestions drawn in the text (ADR-0015): a frame on the paragraphs a suggestion would
// change and, after them, a card with Accept / Reject / Ask for changes. Decorations only: the document is
// never touched, and the card's own controls are outside the editable text.
import { Extension } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

export interface InTextSuggestion {
  id: string
  /** The paragraphs it changes, as their Markdown read (`before` of each change). */
  anchors: string[]
}

const key = new PluginKey<InTextSuggestion[]>('aurelia-suggestions')

/**
 * Where each suggestion goes: the top-level blocks whose Markdown reads as an anchor (in order, each
 * block used once), and the card after the last of them. One whose paragraphs are not found (it is out of
 * date, or it adds at the end, or it is a new scene) goes after the last block.
 */
export function placeSuggestions(doc: PmNode, items: readonly InTextSuggestion[]) {
  const blocks: { from: number; to: number; src: string }[] = []
  doc.forEach((node, offset) =>
    blocks.push({
      from: offset,
      to: offset + node.nodeSize,
      src: String(node.attrs.src ?? '').trim(),
    }),
  )
  return items.map((item) => {
    const used = new Set<number>()
    const targets = item.anchors.flatMap((a) => {
      const i = blocks.findIndex((b, k) => !used.has(k) && b.src && b.src === a.trim())
      if (i < 0) return []
      used.add(i)
      return [blocks[i]!]
    })
    const at = targets.length ? Math.max(...targets.map((t) => t.to)) : doc.content.size
    return { item, targets, at }
  })
}

/** `mount` puts the card into an element and returns how to take it out again. */
export function createSuggestions(mount: (el: HTMLElement, id: string) => () => void) {
  return Extension.create({
    name: 'suggestions',
    addProseMirrorPlugins: () => [
      new Plugin<InTextSuggestion[]>({
        key,
        state: { init: () => [], apply: (tr, value) => tr.getMeta(key) ?? value },
        props: {
          decorations(state) {
            const placed = placeSuggestions(state.doc, key.getState(state) ?? [])
            return DecorationSet.create(
              state.doc,
              placed.flatMap(({ item, targets, at }) => [
                ...targets.map((t) =>
                  Decoration.node(t.from, t.to, { class: 'suggestion-target' }),
                ),
                Decoration.widget(
                  at,
                  () => {
                    const el = document.createElement('div')
                    el.className = 'suggestion-card'
                    el.contentEditable = 'false'
                    const unmount = mount(el, item.id)
                    ;(el as HTMLElement & { unmount?: () => void }).unmount = unmount
                    return el
                  },
                  {
                    key: item.id,
                    side: 1,
                    ignoreSelection: true,
                    stopEvent: () => true,
                    destroy: (node) => (node as HTMLElement & { unmount?: () => void }).unmount?.(),
                  },
                ),
              ]),
            )
          },
        },
      }),
    ],
  })
}

/** Show these suggestions in the text (not an edit, not something to undo). */
export const setSuggestions = (view: EditorView, items: InTextSuggestion[]) =>
  view.dispatch(view.state.tr.setMeta(key, items).setMeta('addToHistory', false))
