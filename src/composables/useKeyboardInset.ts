// SPDX-License-Identifier: AGPL-3.0-or-later
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * How far the on-screen keyboard covers the bottom of the page, from what the visual viewport
 * says: the layout viewport keeps its height when a phone's keyboard opens, so a bar stuck to
 * the bottom of it ends up behind the keys.
 */
export function keyboardInset(
  layoutHeight: number,
  visual: { height: number; offsetTop: number },
): number {
  return Math.max(0, Math.round(layoutHeight - visual.height - visual.offsetTop))
}

/** The keyboard's height in pixels, kept up to date while the page is on screen (0 with none). */
export function useKeyboardInset() {
  const inset = ref(0)
  let stop = () => {}
  onMounted(() => {
    const visual = window.visualViewport
    if (!visual) return
    const update = () => (inset.value = keyboardInset(window.innerHeight, visual))
    update()
    visual.addEventListener('resize', update)
    visual.addEventListener('scroll', update)
    stop = () => {
      visual.removeEventListener('resize', update)
      visual.removeEventListener('scroll', update)
    }
  })
  onBeforeUnmount(() => stop())
  return inset
}
