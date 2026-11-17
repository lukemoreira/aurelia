// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed } from 'vue'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSharedChangeForm } from './useChangeForm'

/** The words selected on the page right now, if they are in the manuscript. */
export function selectedManuscriptText(): string {
  const selection = typeof window === 'undefined' ? null : window.getSelection()
  if (!selection || selection.isCollapsed) return ''
  const inside = selection.anchorNode?.parentElement?.closest('.manuscript')
  return inside ? selection.toString().trim() : ''
}

/**
 * Recording a change from anywhere: the palette's "Add a change", the shortcut, and "Mark as change"
 * on selected words (which starts the board with them as the quote). One board, opened here.
 */
export function useAddChange() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const form = useSharedChangeForm()
  const available = computed(() => !!ws.sceneId && form.canEdit.value)
  /** Open the board; `quote` is the selected words, when there are some. */
  const open = (quote = '') => {
    if (available.value) form.startAdd(undefined, quote)
  }
  /** What the shortcut does: the words selected at that moment are the quote. */
  const fromSelection = () => open(selectedManuscriptText())
  /** Remember the selection before a palette takes the keyboard: the command runs after it has closed. */
  const rememberSelection = () => (edits.selectedText = selectedManuscriptText())
  const fromRemembered = () => {
    open(edits.selectedText)
    edits.selectedText = ''
  }
  return { available, open, fromSelection, rememberSelection, fromRemembered }
}
