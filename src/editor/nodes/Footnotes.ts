// SPDX-License-Identifier: AGPL-3.0-or-later
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  keptTextMentionsNotes,
  nextLabel,
  numberLabels,
  renumberPlan,
  scanFootnotes,
} from '../footnotes'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnotes: {
      /** A reference at the caret and an empty note after the last one; the caret goes into the note. */
      insertFootnote: () => ReturnType
      /** The labels follow the text: 1, 2, 3. Only when the author asks. */
      renumberFootnotes: () => ReturnType
    }
  }
}

const TIP_LENGTH = 240
const tip = (text: string) =>
  text.length > TIP_LENGTH ? `${text.slice(0, TIP_LENGTH - 1)}…` : text

/** What is drawn over references and notes: their number, the note's words, and a name for a screen reader. */
function decorate(doc: Node): DecorationSet {
  const scan = scanFootnotes(doc)
  if (!scan.refs.length && !scan.defs.length) return DecorationSet.empty
  const numbers = numberLabels(scan)
  const notes = new Map(scan.defs.map((d) => [d.label, d.text]))
  const decorations: Decoration[] = []
  for (const { pos, label } of scan.refs) {
    const note = notes.get(label) ?? ''
    const number = numbers.get(label)
    decorations.push(
      Decoration.node(
        pos,
        pos + 1,
        {
          // A reference to a note: the role is what gives the name below a place to be read.
          role: 'doc-noteref',
          'data-number': String(number),
          'data-note': tip(note) || 'No note yet',
          'aria-label': `Footnote ${number}: ${tip(note) || 'no note yet'}`,
        },
        { footnoteNumber: String(number) },
      ),
    )
  }
  for (const { pos, size, label } of scan.defs) {
    // A note nothing refers to is numbered by its label, so it is still found.
    const mark = String(numbers.get(label) ?? label)
    decorations.push(
      Decoration.node(pos, pos + size, {
        'data-number': mark,
        'aria-label': numbers.has(label) ? `Footnote ${mark}` : `Footnote ${mark} (no reference)`,
      }),
    )
  }
  return DecorationSet.create(doc, decorations)
}

/** Footnotes: the insert command, the numbering over references and notes, and renumbering on request. */
export const Footnotes = Extension.create({
  name: 'footnotes',

  addCommands() {
    return {
      insertFootnote:
        () =>
        ({ tr, dispatch, state }) => {
          const { $to } = tr.selection
          const ref = state.schema.nodes.footnoteRef!
          const def = state.schema.nodes.footnoteDef!
          // Not inside a note (a note holds no note), nor where a reference cannot stand.
          for (let d = $to.depth; d > 0; d--) if ($to.node(d).type === def) return false
          if (!$to.parent.canReplaceWith($to.index(), $to.index(), ref)) return false
          if (!dispatch) return true
          const label = nextLabel(tr.doc)
          tr.insert($to.pos, ref.create({ label }))
          // After the last note, else after the last block that has words in it.
          let at = 0
          let lastNote = -1
          tr.doc.forEach((node, offset) => {
            const end = offset + node.nodeSize
            if (node.type === def) lastNote = end
            else if (node.type.name !== 'paragraph' || node.content.size) at = end
          })
          if (lastNote >= 0) at = lastNote
          tr.insert(at, def.createAndFill({ label })!)
          tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView()
          dispatch(tr)
          return true
        },
      renumberFootnotes:
        () =>
        ({ tr, dispatch }) => {
          const plan = renumberPlan(scanFootnotes(tr.doc))
          if (!plan || keptTextMentionsNotes(tr.doc)) return false
          if (dispatch) {
            // Same size before and after, so every position found stays true.
            tr.doc.descendants((node, pos) => {
              if (node.type.name !== 'footnoteRef' && node.type.name !== 'footnoteDef') return true
              const to = plan.get(String(node.attrs.label))
              if (to && to !== node.attrs.label)
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: to })
              return true
            })
            dispatch(tr)
          }
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-f': ({ editor }) => editor.commands.insertFootnote(),
      // From a reference (selected with the arrows) into its note, and back: the note's words
      // are reachable without a pointer.
      'Alt-ArrowDown': ({ editor }) => {
        const { selection, doc } = editor.state
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'footnoteRef')
          return false
        const note = scanFootnotes(doc).defs.find((d) => d.label === selection.node.attrs.label)
        if (!note) return false
        editor.view.dispatch(
          editor.state.tr
            .setSelection(TextSelection.near(doc.resolve(note.pos + 2)))
            .scrollIntoView(),
        )
        return true
      },
      'Alt-ArrowUp': ({ editor }) => {
        const { $from } = editor.state.selection
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d)
          if (node.type.name !== 'footnoteDef') continue
          const ref = scanFootnotes(editor.state.doc).refs.find((r) => r.label === node.attrs.label)
          if (!ref) return false
          editor.view.dispatch(
            editor.state.tr
              .setSelection(NodeSelection.create(editor.state.doc, ref.pos))
              .scrollIntoView(),
          )
          return true
        }
        return false
      },
    }
  },

  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>('footnotes')
    return [
      new Plugin({
        key,
        state: {
          init: (_, { doc }) => decorate(doc),
          apply: (tr, old, _before, after) => (tr.docChanged ? decorate(after.doc) : old),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ]
  },
})
