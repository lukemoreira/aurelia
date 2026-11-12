// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { isStringArray, storageBlocked, uniqueStrings, usePersisted } from './usePersisted'

beforeEach(() => {
  localStorage.clear()
  storageBlocked.value = false
})
afterEach(() => vi.unstubAllGlobals())

describe('usePersisted', () => {
  it('reads a saved value back, and falls back on anything that does not fit', () => {
    localStorage.setItem('aurelia.v1.k', JSON.stringify(['a', 'b']))
    expect(usePersisted<string[]>('k', [], isStringArray).value).toEqual(['a', 'b'])
    localStorage.setItem('aurelia.v1.k', JSON.stringify([1]))
    expect(usePersisted<string[]>('k', ['x'], isStringArray).value).toEqual(['x'])
    localStorage.setItem('aurelia.v1.k', '{not json')
    expect(usePersisted<string[]>('k', ['x'], isStringArray).value).toEqual(['x'])
  })

  it('reads a list with each item once, keeping the first', () => {
    localStorage.setItem('aurelia.v1.k', JSON.stringify(['a', 'b', 'a', 'c', 'b']))
    expect(usePersisted<string[]>('k', [], isStringArray, uniqueStrings).value).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('says so when the browser blocks storage, and keeps the value for this visit', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    const state = usePersisted<string[]>('k', [], isStringArray)
    state.value = ['a']
    await nextTick()
    expect(storageBlocked.value).toBe(true)
    expect(state.value).toEqual(['a'])
  })

  it('does not say so while saving works', async () => {
    const state = usePersisted<string[]>('k', [], isStringArray)
    state.value = ['a']
    await nextTick()
    expect(storageBlocked.value).toBe(false)
    expect(localStorage.getItem('aurelia.v1.k')).toBe('["a"]')
  })
})
