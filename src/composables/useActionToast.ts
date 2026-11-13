// SPDX-License-Identifier: AGPL-3.0-or-later
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEditsStore } from '@/stores/edits'
import { MAIN_CONTENT_ID } from './useFocusMain'
import { matchShortcut } from './useKeyboardShortcuts'

/**
 * The toast after an action: Undo for a delete, with the keys that go with it. After a delete made
 * from the keyboard focus lands on Undo (the row that had it is gone); Esc dismisses; ⌘Z / Ctrl+Z
 * undoes the delete while the toast shows, except in a field, where it is the text's own undo.
 */
export function useActionToast() {
  const edits = useEditsStore()
  const undoButton = ref<HTMLElement | null>(null)

  watch(
    () => edits.toast,
    async (toast) => {
      if (!toast?.focusUndo || !toast.undo) return
      await nextTick()
      undoButton.value?.focus()
    },
  )

  /** Focus that was in the toast goes back to the page, not to nothing. */
  const settleFocus = () => {
    if (document.activeElement === document.body || undoButton.value === document.activeElement)
      document.getElementById(MAIN_CONTENT_ID)?.focus()
  }
  function dismiss() {
    edits.toast = null
    settleFocus()
  }
  async function undo() {
    const run = edits.toast?.undo
    edits.toast = null
    settleFocus()
    await run?.()
  }

  const inField = (e: KeyboardEvent) =>
    !!(e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')
  function onKeydown(e: KeyboardEvent) {
    const toast = edits.toast
    if (!toast) return
    if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"]'))
      return dismiss()
    if (toast.undo && !inField(e) && matchShortcut(e, [{ code: 'KeyZ', run: undo }])) {
      e.preventDefault()
      void undo()
    }
  }
  onMounted(() => document.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

  return {
    toast: () => edits.toast,
    announcement: () => edits.announcement,
    undoButton,
    undo,
    dismiss,
  }
}
