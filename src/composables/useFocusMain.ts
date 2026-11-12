// SPDX-License-Identifier: AGPL-3.0-or-later

/** The id of the scrollable main content, where focus goes when a panel closes around it. */
export const MAIN_CONTENT_ID = 'main-content'

/** A panel's wrapper carries this, so focus inside it can be found. */
export const panelAttr = (name: 'navigator' | 'inspector') => ({ 'data-panel': name })

/**
 * Call before a panel is hidden: focus inside it would be lost to the page body, so it moves
 * to the main content first. Does nothing when focus is elsewhere.
 */
export function leavePanelFocus(name: 'navigator' | 'inspector'): void {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !active.closest(`[data-panel="${name}"]`)) return
  document.getElementById(MAIN_CONTENT_ID)?.focus()
}
