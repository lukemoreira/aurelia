// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { isStringArray, uniqueStrings, usePersisted } from '@/composables/usePersisted'

export const MAX_RECENT = 8

/** Recently opened and pinned items, as palette entry keys. Saved per device. */
export const useShortcutsStore = defineStore('shortcuts', () => {
  const recent = usePersisted<string[]>('recent', [], isStringArray, uniqueStrings)
  const pinned = usePersisted<string[]>('pinned', [], isStringArray, uniqueStrings)

  const touch = (key: string) => {
    recent.value = [key, ...recent.value.filter((k) => k !== key)].slice(0, MAX_RECENT)
  }
  const isPinned = (key: string) => pinned.value.includes(key)
  const togglePin = (key: string) => {
    pinned.value = isPinned(key) ? pinned.value.filter((k) => k !== key) : [...pinned.value, key]
  }

  return { recent, pinned, touch, isPinned, togglePin }
})
