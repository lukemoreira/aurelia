// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_RECENT, useShortcutsStore } from './shortcuts'

const fresh = () => {
  setActivePinia(createPinia())
  return useShortcutsStore()
}
beforeEach(() => localStorage.clear())

describe('recent and pinned', () => {
  it('lists the most recent first, once each, and keeps eight', () => {
    const s = fresh()
    for (let i = 0; i < 10; i++) s.touch(`scene:${i}`)
    s.touch('scene:5')
    expect(s.recent).toHaveLength(MAX_RECENT)
    expect(s.recent[0]).toBe('scene:5')
    expect(s.recent.filter((k) => k === 'scene:5')).toHaveLength(1)
  })

  it('pins and unpins', () => {
    const s = fresh()
    s.togglePin('record:a')
    expect(s.isPinned('record:a')).toBe(true)
    s.togglePin('record:a')
    expect(s.isPinned('record:a')).toBe(false)
  })

  it('keeps both across a reload', async () => {
    const a = fresh()
    a.touch('scene:1')
    a.togglePin('book:2')
    await nextTick()
    const b = fresh()
    expect([b.recent, b.pinned]).toEqual([['scene:1'], ['book:2']])
  })

  it('starts empty when the saved value is damaged', () => {
    localStorage.setItem('aurelia.v1.recent', '{"nope":true}')
    localStorage.setItem('aurelia.v1.pinned', 'not json')
    const s = fresh()
    expect([s.recent, s.pinned]).toEqual([[], []])
  })
})
