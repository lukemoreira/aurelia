// SPDX-License-Identifier: AGPL-3.0-or-later
import { watch, type Ref } from 'vue'

/**
 * Remember what had focus when `open` turns true and give it back when the layer closes.
 * Reka only restores focus to its own trigger; a layer opened from code needs this.
 */
export function useReturnFocus(open: Ref<boolean>) {
  let previous: HTMLElement | null = null
  watch(
    open,
    (isOpen) => {
      if (isOpen) previous = document.activeElement as HTMLElement | null
    },
    { flush: 'sync' },
  )
  return (event: Event) => {
    event.preventDefault()
    previous?.focus()
    previous = null
  }
}
