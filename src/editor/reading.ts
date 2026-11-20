// SPDX-License-Identifier: AGPL-3.0-or-later
// Read aloud, the editor's half: what is spoken (one unit per paragraph, as a reader sees it) and the
// mark on the paragraph being read. The mark is a decoration: the document is never touched.
import { Extension } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { parseLinks } from '@/index/links'

export interface ReadUnit {
  /** The paragraph's range in the document (the mark goes on it). */
  from: number
  to: number
  /** What is spoken. */
  text: string
}

/** Not read: notes (they are not the story's line), tables and text kept as written (code, raw HTML). */
const SKIPPED = /^(footnoteDef|rawBlock|table.*)$/

/**
 * What a reader sees of one paragraph: a link says its words (a link by ID with none says nothing, an
 * embedded card is not a line), a block ID is dropped, a footnote's marker is not spoken (a voice would say
 * "one" in the middle of the sentence), and Markdown marks are not in the text at all.
 */
export function spokenText(raw: string): string {
  let out = raw
  for (const link of parseLinks(raw).reverse()) {
    const said = link.embed ? '' : link.label?.trim() || (link.id ? '' : link.target)
    out = out.slice(0, link.start) + said + out.slice(link.end)
  }
  return out
    .replace(/\s?\^blk-[\w-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Text kept as written (the verbatim mark): a link with a title or a reference link says its words, not
 * its address; inline code, an image, an HTML tag and a bare or `<address>` link say nothing.
 */
const keptWords = (raw: string) => /^\[(.*?)\](?:\(.*\)|\[[^\]]*\])?$/s.exec(raw)?.[1] ?? ' '

/** The paragraphs of the scene, in order, that have words to say. */
export function readingUnits(doc: PmNode): ReadUnit[] {
  const units: ReadUnit[] = []
  doc.descendants((node, pos) => {
    if (SKIPPED.test(node.type.name)) return false
    if (!node.isTextblock) return true
    let raw = ''
    node.forEach((child) => {
      if (child.isText)
        raw += child.marks.some((m) => m.type.name === 'verbatim')
          ? keptWords(child.text!)
          : child.text
      else if (child.type.name === 'hardBreak') raw += ' '
    })
    const text = spokenText(raw)
    if (text) units.push({ from: pos, to: pos + node.nodeSize, text })
    return false
  })
  return units
}

/** Where reading starts: the first paragraph with words that ends after the caret (or the selection's start). */
export const unitAt = (units: readonly ReadUnit[], pos: number) =>
  units.findIndex((u) => u.to > pos)

const key = new PluginKey<{ from: number; to: number } | null>('aurelia-reading')

/** The mark on the paragraph being read. Drawn only; a change of the text moves it with the text. */
export const Reading = Extension.create({
  name: 'reading',
  addProseMirrorPlugins: () => [
    new Plugin<{ from: number; to: number } | null>({
      key,
      state: {
        init: () => null,
        apply: (tr, value) => {
          const set = tr.getMeta(key) as { from: number; to: number } | null | undefined
          if (set !== undefined) return set
          return value && tr.docChanged
            ? { from: tr.mapping.map(value.from), to: tr.mapping.map(value.to, -1) }
            : value
        },
      },
      props: {
        decorations(state) {
          const at = key.getState(state)
          return at
            ? DecorationSet.create(state.doc, [
                Decoration.node(at.from, at.to, { class: 'reading-now' }),
              ])
            : DecorationSet.empty
        },
      },
    }),
  ],
})

/** Mark a paragraph as the one being read (null clears it), and bring it gently into view. Not an edit. */
export function markReading(view: EditorView, at: { from: number; to: number } | null) {
  view.dispatch(view.state.tr.setMeta(key, at).setMeta('addToHistory', false))
  if (!at) return
  const el = view.nodeDOM(at.from)
  if (el instanceof HTMLElement)
    el.scrollIntoView?.({
      block: 'nearest',
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
}
