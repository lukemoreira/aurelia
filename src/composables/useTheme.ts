// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, watchEffect } from 'vue'
import { storageBlocked } from './usePersisted'

export type ThemeChoice = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'aurelia.theme'

const choice = ref<ThemeChoice>('system')
const systemDark = ref(false)
let started = false

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function start() {
  if (started) return
  started = true
  choice.value = readChoice()
  const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  systemDark.value = query?.matches ?? false
  query?.addEventListener('change', (e) => (systemDark.value = e.matches))
  watchEffect(() => {
    const resolved =
      choice.value === 'system' ? (systemDark.value ? 'dark' : 'light') : choice.value
    document.documentElement.dataset.theme = resolved
  })
}

/** Light, dark or follow the system. Saved per device; works when storage is blocked. */
export function useTheme() {
  start()
  const setTheme = (next: ThemeChoice) => {
    choice.value = next
    try {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
      else localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Storage blocked: the choice still applies until the page closes.
      storageBlocked.value = true
    }
  }
  const resolved = computed(() =>
    choice.value === 'system' ? (systemDark.value ? 'dark' : 'light') : choice.value,
  )
  return { choice, resolved, setTheme }
}
