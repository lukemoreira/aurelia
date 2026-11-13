// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useLayoutStore } from '@/stores/layout'
import { useFocusMode } from './useFocusMode'

let unmount = () => {}
afterEach(() => unmount())
beforeEach(() => localStorage.clear())

async function setup(path = '/write') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/write', name: 'write', component: { render: () => null } },
      { path: '/plan', name: 'plan', component: { render: () => null } },
    ],
  })
  await router.push(path)
  const wrapper = mount(defineComponent({ setup: () => (useFocusMode(), () => h('div')) }), {
    global: { plugins: [pinia, router] },
  })
  unmount = () => wrapper.unmount()
  return { layout: useLayoutStore(), router }
}
const press = (key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  window.dispatchEvent(e)
  return e
}

describe('useFocusMode', () => {
  it('turns on and off with F11 on the writing screen, and stops the browser taking the key', async () => {
    const { layout } = await setup()
    expect(press('F11').defaultPrevented).toBe(true)
    expect(layout.focus).toBe(true)
    press('F11')
    expect(layout.focus).toBe(false)
  })

  it('turns on and off with Ctrl+Shift+F too, because Chrome and Edge keep F11 for themselves', async () => {
    const { layout } = await setup()
    const chord = { code: 'KeyF', shiftKey: true, ctrlKey: true }
    expect(press('F', chord).defaultPrevented).toBe(true)
    expect(layout.focus).toBe(true)
    press('F', chord)
    expect(layout.focus).toBe(false)
    // Not without Shift, not with Alt, not with the other modifier.
    press('f', { code: 'KeyF', ctrlKey: true })
    press('F', { ...chord, altKey: true })
    press('F', { code: 'KeyF', shiftKey: true, metaKey: true })
    expect(layout.focus).toBe(false)
  })

  it('leaves F11 to the browser on any other screen', async () => {
    const { layout } = await setup('/plan')
    expect(press('F11').defaultPrevented).toBe(false)
    expect(layout.focus).toBe(false)
  })

  it('leaves on Escape, unless a menu or dialog took the Escape first', async () => {
    const { layout } = await setup()
    layout.focus = true
    press('Escape')
    expect(layout.focus).toBe(false)
    layout.focus = true
    const taken = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    taken.preventDefault()
    window.dispatchEvent(taken)
    expect(layout.focus).toBe(true)
    // An open dialog (the palette, settings) keeps the Escape for itself.
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog"></div>')
    press('Escape')
    expect(layout.focus).toBe(true)
    document.body.innerHTML = ''
    press('Escape')
    expect(layout.focus).toBe(false)
  })

  it('leaves when the writing screen is left, so no screen is left without its bars', async () => {
    const { layout, router } = await setup()
    layout.focus = true
    await router.push('/plan')
    await flushPromises()
    expect(layout.focus).toBe(false)
  })
})
