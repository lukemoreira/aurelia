// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** The rows to draw for a scrolled list of rows of one height: the ones in view, and a few beyond. */
export function visibleRange(
  count: number,
  rowHeight: number,
  scrollTop: number,
  viewport: number,
  overscan = 8,
) {
  const start = Math.min(count, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan))
  const end = Math.min(
    count,
    Math.max(start, Math.ceil((scrollTop + viewport) / rowHeight) + overscan),
  )
  return { start, end }
}

/**
 * Windowing for a long table: only the rows near the viewport are in the page, with blank space
 * above and below standing in for the rest, so a book of a thousand scenes scrolls like ten.
 */
export function useVirtualRows(
  count: Ref<number>,
  rowHeight: number,
  scroller: Ref<HTMLElement | null>,
  /** Height of a sticky header above the first row, inside the scrolling element. */
  header = 0,
) {
  const top = ref(0)
  const viewport = ref(640)
  const range = computed(() =>
    visibleRange(count.value, rowHeight, Math.max(0, top.value - header), viewport.value),
  )
  const before = computed(() => range.value.start * rowHeight)
  const after = computed(() => (count.value - range.value.end) * rowHeight)

  const measure = () => {
    top.value = scroller.value?.scrollTop ?? 0
    viewport.value = scroller.value?.clientHeight || viewport.value
  }
  let observer: ResizeObserver | undefined
  watch(
    scroller,
    (el, old) => {
      old?.removeEventListener('scroll', measure)
      observer?.disconnect()
      if (!el) return
      el.addEventListener('scroll', measure, { passive: true })
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(measure)
        observer.observe(el)
      }
      measure()
    },
    { immediate: true, flush: 'post' },
  )
  onBeforeUnmount(() => {
    scroller.value?.removeEventListener('scroll', measure)
    observer?.disconnect()
  })

  /** Bring a row into view (the row may not be in the page yet). */
  function reveal(index: number) {
    const el = scroller.value
    if (!el || index < 0) return
    // A row sits `header` lower than its place among the rows, and hides under the sticky header above it.
    const [from, to] = [index * rowHeight, header + (index + 1) * rowHeight]
    if (from < el.scrollTop) el.scrollTop = from
    else if (to > el.scrollTop + el.clientHeight) el.scrollTop = to - el.clientHeight
    measure()
  }
  return { range, before, after, reveal }
}
