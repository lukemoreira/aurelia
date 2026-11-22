// SPDX-License-Identifier: AGPL-3.0-or-later
// The assistant's suggestions drawn in the text (ADR-0015): a dashed frame on each paragraph a suggestion
// really changes and, on the frame's top-right corner, a small button that opens the suggestion in a popup.
// Decorations only: the document is never touched. The button sits inside the framed paragraph, drawn out of
// the flow (no size of its own), so the text, its spacing and the caret are exactly as without it.
import { Extension } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
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
      return [
        {
          change: a.change,
          from: hit.from,
          to: hit.to,
          text,
          inside: !!doc.nodeAt(hit.from)?.isTextblock,
        },
      ]
    })
    return { item, marks, end: doc.content.size }
  })
}

const words = (text: string) => {
  const w = text.split(/\s+/).filter(Boolean)
  return w.slice(0, 6).join(' ') + (w.length > 6 ? '…' : '')
}

/** One suggestion that a button stands for, and the change whose paragraph it is (0 for the scene's own button). */
export type SuggestionHit = { id: string; change: number }
type Open = (hits: SuggestionHit[], pos: number | null) => void
/** What the popup shows: the suggestions of the button used, and where its paragraph starts (null: the scene's end). */
export type SuggestionTarget = { hits: SuggestionHit[]; pos: number | null }

interface Chip {
  item: InTextSuggestion
  change: number | null
  text: string
  first: boolean
}

/** What a button says: "Suggestion", or the count when several suggestions change the paragraph. */
const chipWords = (list: Chip[]) => {
  const stale = list.every((c) => c.item.outOfDate)
  const n = list.length
  return `${n > 1 ? `${n} suggestions` : 'Suggestion'}${stale ? ' · out of date' : ''}`
}

/**
 * ONE button for a framed paragraph (or for the scene's end): it stands for every suggestion that changes
 * it. Plain DOM: it needs nothing but the click. It is a Tab stop when it is some suggestion's first
 * button, so every suggestion is reached by Tab exactly once.
 */
function button(list: Chip[], open: Open, pos: number | null) {
  const n = list.length
  const stale = list.every((c) => c.item.outOfDate)
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `suggestion-chip${stale ? ' is-stale' : ''}`
  b.dataset.hits = list.map((c) => `${c.item.id}:${c.change ?? 'end'}`).join(' ')
  if (!list.some((c) => c.first)) b.tabIndex = -1
  const what = stale
    ? `${chipWords(list)} — show ${n > 1 ? 'them' : 'it'}`
    : `Show ${n > 1 ? `${n} suggestions` : 'the suggestion'}`
  b.setAttribute(
    'aria-label',
    pos === null
      ? `${what} for this scene`
      : `${what} for this paragraph: “${words(list[0]!.text)}”`,
  )
  b.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons.spark}"/></svg>`
  b.append(chipWords(list))
  b.addEventListener('click', () => {
    b.focus() // some browsers do not focus a button on click: the popup gives focus back to it
    open(
      list.map((c) => ({ id: c.item.id, change: c.change ?? 0 })),
      pos,
    )
  })
  return b
}

/** The button a closed popup came from, if it is still drawn: the scene's end has its own key ('end'), never a paragraph's change 0. */
export function findChip(root: HTMLElement, at: SuggestionTarget) {
  return [...root.querySelectorAll<HTMLElement>('button.suggestion-chip')].find((b) =>
    at.hits.some((h) =>
      b.dataset.hits?.split(' ').includes(`${h.id}:${at.pos === null ? 'end' : h.change}`),
    ),
  )
}

/** A paragraph's anchor (a span drawn on its frame) holding its button; or the scene's row at its end. */
function chips(list: Chip[], open: Open, pos: number | null) {
  const end = pos === null
  const row = document.createElement(end ? 'div' : 'span')
  row.className = end ? 'suggestion-chip-row' : 'suggestion-chip-anchor'
  row.contentEditable = 'false'
  row.append(button(list, open, pos))
  return row
}

/**
 * `open` is called with the suggestions the used button stands for (each with the number of the change on
 * its paragraph) and where that paragraph starts in the document (null for the scene's own button).
 */
export function createSuggestions(open: Open) {
  // A paragraph's buttons go inside it, before its first character (`side: -1`: typed text lands after
  // them); a block with no text of its own (a scene break, a table, a list) has them just before it, outside
  // anything that clips. Only events on a button are its own.
  const widget = (list: Chip[], at: number, pos: number | null, side: number): Decoration =>
    Decoration.widget(at, () => chips(list, open, pos), {
      key: `${at}:${list.map((c) => `${c.item.id}:${c.change ?? 'end'}:${c.item.outOfDate}:${c.first}`).join('|')}`,
      side,
      ignoreSelection: true,
      stopEvent: (e) => !!(e.target as Element | null)?.closest?.('.suggestion-chip'),
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
            const byBlock = new Map<number, { inside: boolean; chips: Chip[] }>()
            const end: Chip[] = []
            const nodes: Decoration[] = []
            for (const { item, marks } of placed) {
              if (!marks.length) {
                end.push({ item, change: null, text: '', first: true })
                continue
              }
              marks.forEach((m, i) => {
                nodes.push(
                  Decoration.node(m.from, m.to, {
                    class: `suggestion-target${item.outOfDate ? ' is-stale' : ''}`,
                  }),
                )
                const at = byBlock.get(m.from) ?? { inside: m.inside, chips: [] }
                at.chips.push({ item, change: m.change, text: m.text, first: i === 0 })
                byBlock.set(m.from, at)
              })
            }
            const anchors = [...byBlock].map(([from, b]) =>
              widget(b.chips, b.inside ? from + 1 : from, from, -1),
            )
            const ends = end.length ? [widget(end, state.doc.content.size, null, 1)] : []
            return DecorationSet.create(state.doc, [...nodes, ...anchors, ...ends])
          },
        },
      }),
    ],
  })
}

/** Show these suggestions in the text (not an edit, not something to undo). */
export const setSuggestions = (view: EditorView, items: InTextSuggestion[]) =>
  view.dispatch(view.state.tr.setMeta(key, items).setMeta('addToHistory', false))

/** Where the caret goes back to for the block at `pos` (null: the scene's end): the nearest place text can be. */
export const caretNear = (doc: PmNode, pos: number | null) =>
  TextSelection.near(
    doc.resolve(pos === null ? doc.content.size : Math.min(pos + 1, doc.content.size)),
  )
