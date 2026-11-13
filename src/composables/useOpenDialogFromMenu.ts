// SPDX-License-Identifier: AGPL-3.0-or-later
import { nextTick, type Ref } from 'vue'
import { useLayoutStore } from '@/stores/layout'

/**
 * Close a popover menu and open a dialog from it. Focus goes to the menu's own button first, so
 * the dialog remembers it as its opener and gives focus back to it (the item that was clicked is
 * gone by then).
 */
export function useOpenDialogFromMenu(open: Ref<boolean>, trigger: Ref<HTMLElement | null>) {
  const layout = useLayoutStore()
  return async (dialog: 'backupOpen' | 'renameOpen') => {
    open.value = false
    trigger.value?.focus()
    await nextTick()
    layout[dialog] = true
  }
}
