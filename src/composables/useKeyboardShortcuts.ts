// SPDX-License-Identifier: AGPL-3.0-or-later
import { onBeforeUnmount, onMounted } from 'vue'

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
/** How the shortcut modifier is written on this device. */
export const modLabel = isMac ? '⌘' : 'Ctrl'
export const altLabel = isMac ? '⌥' : 'Alt'
/** The accessible name of the search button, with its shortcut spelled out. */
export const searchLabel = `Search or run a command (${isMac ? 'Command K' : 'Ctrl K'})`
/** How the focus mode chord is written on this device. */
export const focusLabel = isMac ? '⌘⇧F' : 'Ctrl+Shift+F'
/** How the pin chord is written on this device. */
export const pinLabel = isMac ? '⌥P' : 'Alt+P'

export interface Shortcut {
  /** `KeyboardEvent.code`, so it works on any keyboard layout. */
  code: string
  alt?: boolean
  run: () => void
}

/**
 * Cmd on a Mac, Ctrl elsewhere — never the other one: Ctrl+K is text editing on a Mac, and the
 * Windows key belongs to the system. AltGr counts as Ctrl+Alt on Windows and is a letter, not a
 * shortcut. Alt must match, so ⌘\ and ⌘⌥\ stay apart.
 */
export function matchShortcut(
  e: KeyboardEvent,
  shortcuts: Shortcut[],
  mac: boolean = isMac,
): Shortcut | undefined {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod || e.shiftKey || e.getModifierState('AltGraph')) return undefined
  return shortcuts.find((s) => s.code === e.code && !!s.alt === e.altKey)
}

/**
 * Alt+P (⌥P): pin or unpin the focused item. Plain Alt, matched by `code`: on a Mac ⌥P types
 * "π", so `event.key` would never say "p".
 */
export const isPinChord = (e: KeyboardEvent) =>
  e.code === 'KeyP' && e.altKey && !e.ctrlKey && !e.metaKey

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  const onKeydown = (e: KeyboardEvent) => {
    const hit = matchShortcut(e, shortcuts)
    if (!hit) return
    e.preventDefault()
    hit.run()
  }
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
