// SPDX-License-Identifier: AGPL-3.0-or-later
import { ref, watch, type Ref } from 'vue'

/** Bump the version when the shape of anything saved changes. */
const PREFIX = 'aurelia.v1.'

/** True once a save failed: the browser blocks storage, so nothing is kept after this visit. */
export const storageBlocked = ref(false)

function readPersisted<T>(
  key: string,
  fallback: T,
  isValid: (v: unknown) => v is T,
  normalize: (v: T) => T,
): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    const value: unknown = JSON.parse(raw)
    return isValid(value) ? normalize(value) : fallback
  } catch {
    return fallback
  }
}

function writePersisted(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage blocked or full: the value still applies until the page closes.
    storageBlocked.value = true
  }
}

/** A ref that is saved per device and read back on the next visit. */
export function usePersisted<T>(
  key: string,
  fallback: T,
  isValid: (v: unknown) => v is T,
  normalize: (v: T) => T = (v) => v,
): Ref<T> {
  const state = ref(readPersisted(key, fallback, isValid, normalize)) as Ref<T>
  watch(state, (v) => writePersisted(key, v), { deep: true })
  return state
}

export const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

/** Each string once, first occurrence kept: a hand-edited or doubled list reads cleanly. */
export const uniqueStrings = (v: string[]): string[] => Array.from(new Set(v))

export const isString = (v: unknown): v is string => typeof v === 'string'
