// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, watch, type WatchSource } from 'vue'

/** Long books have thousands of places: show the first, and more when asked. Starts again when `reset` changes. */
export function useShowMore<T>(
  groups: () => { where: string; places: T[] }[],
  reset: WatchSource,
  step = 150,
) {
  const limit = ref(step)
  watch(reset, () => (limit.value = step))
  const visible = computed(() => {
    let left = limit.value
    return groups()
      .map((g) => ({ where: g.where, places: g.places.slice(0, Math.max(0, left)) }))
      .map((g) => ((left -= g.places.length), g))
      .filter((g) => g.places.length)
  })
  const hasMore = computed(() => groups().reduce((n, g) => n + g.places.length, 0) > limit.value)
  return { visible, hasMore, more: () => (limit.value += step) }
}
