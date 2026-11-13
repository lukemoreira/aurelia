// SPDX-License-Identifier: AGPL-3.0-or-later
import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

/**
 * Let a textarea grow with its text so the page scrolls, not the box. Browsers with
 * `field-sizing: content` do it themselves; the others are measured here.
 */
export function useAutosize(el: Ref<HTMLTextAreaElement | null>, value: () => string) {
  const native = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content')
  const fit = () => {
    const area = el.value
    if (native || !area) return
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight}px`
  }
  watch(value, () => void nextTick(fit), { flush: 'post' })
  onMounted(() => {
    fit()
    window.addEventListener('resize', fit) // a narrower column wraps differently
  })
  onBeforeUnmount(() => window.removeEventListener('resize', fit))
}
