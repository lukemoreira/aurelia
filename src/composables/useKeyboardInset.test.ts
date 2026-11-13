// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { keyboardInset, useKeyboardInset } from './useKeyboardInset'

afterEach(() => vi.unstubAllGlobals())

describe('keyboardInset', () => {
  it('is what the visual viewport leaves of the page: the keyboard’s height', () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0 })).toBe(0)
    expect(keyboardInset(844, { height: 520, offsetTop: 0 })).toBe(324)
  })
  it('allows for the page being scrolled within the visual viewport', () => {
    expect(keyboardInset(844, { height: 520, offsetTop: 100 })).toBe(224)
  })
  it('is never negative (a zoomed page, a bar that hides)', () => {
    expect(keyboardInset(700, { height: 800, offsetTop: 0 })).toBe(0)
    expect(keyboardInset(844, { height: 700.4, offsetTop: 143.9 })).toBe(0)
  })
})

/** A component that uses the composable, and the value it holds. */
function host() {
  let inset!: ReturnType<typeof useKeyboardInset>
  const wrapper = mount(
    defineComponent({ setup: () => ((inset = useKeyboardInset()), () => h('div')) }),
  )
  return { wrapper, inset }
}

describe('useKeyboardInset', () => {
  it('follows the visual viewport as the keyboard opens and closes, and lets go on unmount', async () => {
    const visual = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 })
    vi.stubGlobal('visualViewport', visual)
    vi.stubGlobal('innerHeight', 844)
    const { wrapper, inset } = host()
    expect(inset.value).toBe(0)
    visual.height = 500
    visual.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(inset.value).toBe(344)
    visual.height = 844
    visual.dispatchEvent(new Event('resize'))
    expect(inset.value).toBe(0)
    visual.height = 500
    wrapper.unmount()
    visual.dispatchEvent(new Event('resize'))
    expect(inset.value).toBe(0)
  })

  it('is 0 where there is no visual viewport', () => {
    vi.stubGlobal('visualViewport', undefined)
    expect(host().inset.value).toBe(0)
  })
})
