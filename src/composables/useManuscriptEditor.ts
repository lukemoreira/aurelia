// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AnyExtension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { Editor } from '@tiptap/vue-3'
import { onBeforeUnmount, ref, watch } from 'vue'
import { editorExtensions } from '@/editor/extensions'
import { bodyToDoc, docToBody } from '@/editor/markdown/body'
import { pasteProps } from '@/editor/paste'

export interface ManuscriptOptions {
  /** The scene's text as the workspace holds it. A change not made here is an outside change. */
  body: () => string
  editable: () => boolean
  /** The author changed the text. Called only for a change made in the editor. */
  onEdit: (body: string) => void
  /** More to the editor: what only a screen with a workspace has (links, names). */
  extensions?: AnyExtension[]
  /** Attributes of the editable element: its accessible name. */
  attributes: () => Record<string, string>
  /** Words typed in the source mode that the workspace had not taken: shown, and sent again. */
  held?: string | null
  /** Where to put the caret when the editor opens: a block of the text, and how far into it. */
  place?: { block: number; offset: number } | null
}

/** Where the caret is: which top-level block, and how far into it. */
const caretOf = (editor: Editor) => {
  const { $from } = editor.state.selection
  return $from.depth ? { block: $from.index(0), offset: $from.pos - $from.before(1) } : null
}

/** Put the caret back at the same block and offset in a text that has been replaced. */
function placeCaret(editor: Editor, caret: ReturnType<typeof caretOf>) {
  if (!caret) return
  const { doc } = editor.state
  const block = Math.min(caret.block, doc.childCount - 1)
  let start = 0
  for (let i = 0; i < block; i++) start += doc.child(i).nodeSize
  const pos = start + Math.min(caret.offset, Math.max(doc.child(block).nodeSize - 1, 0))
  editor.view.dispatch(
    editor.state.tr
      .setSelection(TextSelection.near(doc.resolve(pos)))
      .setMeta('addToHistory', false),
  )
}

/**
 * The Tiptap editor on a scene. The text goes in as Markdown and comes out as Markdown, and
 * opening a scene writes nothing: `onEdit` hears only of changes the author made. A change made
 * outside (another device, a restored copy) replaces what is shown and keeps the caret in place.
 */
export function useManuscriptEditor(options: ManuscriptOptions) {
  // The bars float over the text, top and bottom: the caret is kept clear of them as it moves.
  const editorProps = () => ({
    attributes: options.attributes(),
    scrollMargin: 88,
    scrollThreshold: 88,
    ...pasteProps,
  })
  /** Counts every change of the document or the selection, for the toolbar to read. */
  const tick = ref(0)
  /** The text the workspace holds, as last seen. */
  let known = options.body()
  /**
   * Text typed here that the workspace has not taken (it was read-only or settling at that
   * moment). It stays on screen, is never replaced by an outside change, and is sent again when
   * the editor can write.
   */
  let pending: string | null = options.held != null && options.held !== known ? options.held : null

  const created = new Editor({
    extensions: [...editorExtensions, ...(options.extensions ?? [])],
    content: bodyToDoc(pending ?? known),
    editable: options.editable(),
    editorProps: editorProps(),
    onTransaction: () => tick.value++,
    onUpdate: ({ editor: ed, transaction }) => {
      // Something the editor itself added (the empty line after a table, a table made whole) and
      // that the author did not do: not an edit, and focusing a scene writes nothing.
      if (!transaction.docChanged) return
      const body = docToBody(ed.state.doc)
      if (body === (pending ?? known)) return
      pending = body === known ? null : body
      options.onEdit(body)
    },
  })

  if (options.place) placeCaret(created, options.place)
  if (pending !== null && options.editable()) options.onEdit(pending)

  watch(options.body, (next) => {
    if (pending !== null) {
      // The workspace took what was typed (or something else changed while it waits: ours stays).
      if (next === pending) {
        known = next
        pending = null
      }
      return
    }
    if (next === known) return
    known = next
    const caret = caretOf(created)
    // Not an edit, and not something to undo: the old steps no longer fit the new text.
    const doc = created.schema.nodeFromJSON(bodyToDoc(next))
    created.view.dispatch(
      created.state.tr
        .replaceWith(0, created.state.doc.content.size, doc.content)
        .setMeta('addToHistory', false)
        .setMeta('preventUpdate', true),
    )
    placeCaret(created, caret)
  })
  watch(options.editable, (editable) => {
    created.setEditable(editable)
    if (editable && pending !== null && pending !== options.body()) options.onEdit(pending)
  })
  watch(options.attributes, () => created.setOptions({ editorProps: editorProps() }))
  onBeforeUnmount(() => created.destroy())

  return { editor: created, tick, pending: () => pending }
}
