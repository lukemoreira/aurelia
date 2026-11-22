// SPDX-License-Identifier: AGPL-3.0-or-later
// The assistant's suggestions drawn in the text (ADR-0015): a dashed frame on each paragraph a suggestion
// really changes and, after it, a small button that opens the suggestion in a popup. Decorations only: the
// document is never touched, and the buttons are outside the editable text.
import { Extension } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { icons } from '@/components/ui/icons'

export interface InTextSuggestion {
  id: string
  /** Out of date: drawn quietly, and only on the paragraphs that still read as the suggestion saw them. */
  outOfDate: boolean
  /** The paragraphs it changes: each change's number in the proposal, its `before`, and which of the equal ones. */
  anchors: { change: number; before: string; occurrence: number; copies: number }[]
}

const key = new PluginKey<InTextSuggestion[]>('aurelia-suggestions')

/**
 * Where each suggestion shows: a block for each anchor that still reads exactly as the suggestion saw it
 * (the same match Accept makes: the `occurrence`th of the `copies` blocks that read so, and none when
 * their number changed). A suggestion with no such block (it adds at the end, is a new scene, or is out of
 * date everywhere) gets one button at the end of the scene.
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
    const marks = item.anchors.flatMap((a) => {
      const text = a.before.trim()
      const same = text ? blocks.filter((b) => b.src === text) : []
      const hit = same.length === a.copies ? same[a.occurrence] : undefined
      const i = hit ? blocks.indexOf(hit) : -1
      if (!hit || used.has(i)) return []
      used.add(i)
      return [{ change: a.change, from: hit.from, to: hit.to, text }]
    })
    return { item, marks, end: doc.content.size }
  })
}

const words = (text: string) => {
  const w = text.split(/\s+/).filter(Boolean)
  return w.slice(0, 6).join(' ') + (w.length > 6 ? '…' : '')
}

/** The button after a framed paragraph. Plain DOM: it needs nothing but the click. */
function chip(
  item: InTextSuggestion,
  change: number | null,
  text: string,
  open: (id: string, change: number) => void,
) {
  const row = document.createElement('div')
  row.className = 'suggestion-chip-row'
  row.contentEditable = 'false'
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `suggestion-chip${item.outOfDate ? ' is-stale' : ''}`
  b.dataset.suggestion = item.id
  if (change !== null) b.dataset.change = String(change)
  const what = item.outOfDate ? 'the out-of-date suggestion' : 'the suggestion'
  b.setAttribute(
    'aria-label',
    change === null
      ? `Show ${what} for this scene`
      : `Show ${what} for this paragraph: “${words(text)}”`,
  )
  b.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons.spark}"/></svg>`
  b.append(item.outOfDate ? 'Out of date' : 'Suggestion')
  b.addEventListener('click', () => {
    b.focus() // some browsers do not focus a button on click: the popup gives focus back to it
    open(item.id, change ?? 0)
  })
  row.append(b)
  return row
}

/** `open` is called with the suggestion's id and the number of the change whose paragraph's button was used. */
export function createSuggestions(open: (id: string, change: number) => void) {
  const widget = (
    item: InTextSuggestion,
    at: number,
    change: number | null,
    text: string,
  ): Decoration =>
    Decoration.widget(at, () => chip(item, change, text, open), {
      key: `${item.id}:${change ?? 'end'}:${item.outOfDate}`,
      side: 1,
      ignoreSelection: true,
      stopEvent: () => true,
    })
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
              placed.flatMap(({ item, marks, end }) =>
                marks.length
                  ? marks.flatMap((m) => [
                      Decoration.node(m.from, m.to, {
                        class: `suggestion-target${item.outOfDate ? ' is-stale' : ''}`,
                      }),
                      widget(item, m.to, m.change, m.text),
                    ])
                  : [widget(item, end, null, '')],
              ),
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
