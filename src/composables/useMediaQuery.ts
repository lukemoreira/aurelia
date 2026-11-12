// SPDX-License-Identifier: AGPL-3.0-or-later
import { ref, type Ref } from 'vue'

/** True while the query matches. Call once and keep the result: it listens for good. */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false)
  if (typeof matchMedia === 'function') {
    const list = matchMedia(query)
    matches.value = list.matches
    list.addEventListener('change', (e) => (matches.value = e.matches))
  }
  return matches
}
