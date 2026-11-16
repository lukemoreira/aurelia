// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { storyRig } from '../../../tests/helpers/story-rig'
import OutlineTable from './OutlineTable.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: { name: 'plan' } } }),
}))
beforeEach(() => localStorage.clear())
afterEach(() => (document.body.innerHTML = ''))

describe('a long outline table', () => {
  it('draws only the rows near the top, and the arrow keys reach a row that is not drawn yet', async () => {
    const r = await storyRig()
    for (let i = 0; i < 60; i++) await r.session.createScene(r.chapter)
    const wrapper = mount(OutlineTable, { attachTo: document.body })
    await nextTick()
    const drawn = () => [...document.body.querySelectorAll<HTMLElement>('[data-row]')]
    expect(drawn().length).toBeLessThan(40) // 63 scenes and a chapter, but not all in the page
    const last = drawn().at(-1)!
    const rowsBefore = drawn().map((e) => e.dataset.row)
    last.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    )
    await vi.waitFor(() => {
      const now = drawn().map((e) => e.dataset.row)
      expect(now).toContain(
        document.activeElement && (document.activeElement as HTMLElement).dataset.row,
      )
      expect(document.activeElement).not.toBe(last)
      expect(rowsBefore).not.toContain((document.activeElement as HTMLElement).dataset.row)
    })
    wrapper.unmount()
  })
})
