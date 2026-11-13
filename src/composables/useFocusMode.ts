// SPDX-License-Identifier: AGPL-3.0-or-later
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { isMac } from '@/composables/useKeyboardShortcuts'
import { useLayoutStore } from '@/stores/layout'

/** A dialog, a menu or a popover is open: the Escape is for closing that. */
const somethingOpen = () => !!document.querySelector('[role="dialog"], [role="menu"]')

/**
 * Focus mode on the writing screen: Mod+Shift+F (and F11, where a page gets it) turns it on and off, Escape leaves it (unless a menu or
 * a dialog is open: its Escape is for closing it). Leaving the writing screen leaves focus mode too, so the
 * bars are never gone from a screen that has nothing to show without them.
 */
export function useFocusMode() {
  const layout = useLayoutStore()
  const route = useRoute()

  const onKeydown = (e: KeyboardEvent) => {
    // F11 never reaches a page in Chrome or Edge (the browser's own full screen), so Mod+Shift+F too.
    const chord =
      e.code === 'KeyF' &&
      e.shiftKey &&
      !e.altKey &&
      (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)
    if ((e.key === 'F11' || chord) && route.name === 'write') {
      e.preventDefault()
      layout.toggleFocus()
    } else if (e.key === 'Escape' && layout.focus && !e.defaultPrevented && !somethingOpen()) {
      layout.focus = false
    }
  }
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
  watch(
    () => route.name,
    (name) => {
      if (name !== 'write') layout.focus = false
    },
  )
}
