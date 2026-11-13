// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import App from '@/App.vue'
import { createAppRouter } from '@/router'

let app: VueWrapper | undefined
beforeEach(() => localStorage.clear())
afterEach(() => {
  app?.unmount()
  app = undefined
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
})

async function welcome() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push('/')
  app = mount(App, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
}
const card = (title: string) =>
  [...document.querySelectorAll('main ul button')].find((b) => b.textContent?.includes(title))!
const isRecommended = (title: string) => card(title).className.includes('border-gold')

describe('the Welcome screen', () => {
  it('gives only the folder card the gold border and tag where a folder can be picked', async () => {
    window.showDirectoryPicker = async () => {
      throw new DOMException('closed', 'AbortError')
    }
    await welcome()
    expect(isRecommended('Choose a folder')).toBe(true)
    expect(isRecommended('Keep it in this browser')).toBe(false)
    expect(isRecommended('Open the sample universe')).toBe(false)
    expect(card('Choose a folder').className).toContain('shadow-card')
    expect(card('Keep it in this browser').className).not.toContain('shadow')
    const tags = [...document.querySelectorAll('main ul .rounded-full')].map((t) => t.textContent)
    expect(tags.filter((t) => t === 'Recommended')).toHaveLength(1)
    expect(card('Choose a folder').textContent).toContain('Chrome and Edge.')
  })

  it('recommends browser storage where there is no folder picker, and says nothing twice', async () => {
    await welcome()
    expect(isRecommended('Keep it in this browser')).toBe(true)
    expect(isRecommended('Choose a folder')).toBe(false)
    expect(card('Keep it in this browser').textContent).toContain('Recommended')
    expect(card('Choose a folder').textContent).toContain('Needs Chrome or Edge')
    expect(card('Choose a folder').textContent).not.toContain('Chrome and Edge.')
  })

  it('does not promise a cloud copy that does not exist yet', async () => {
    await welcome()
    expect(document.body.textContent).not.toMatch(/cloud account|comes later/i)
  })

  describe('on an http page, where the browser gives no file access', () => {
    const REASON =
      'Open Aurelia at its https:// address. On http, the browser does not let it keep files.'
    const secure = (value: boolean | undefined) =>
      Object.defineProperty(window, 'isSecureContext', { value, configurable: true })
    afterEach(() => secure(true))

    it('says the real reason once at the top, and recommends neither card', async () => {
      secure(false)
      window.showDirectoryPicker = async () => {
        throw new DOMException('closed', 'AbortError')
      }
      await welcome()
      expect(document.querySelectorAll('main [role="status"]')).toHaveLength(1)
      expect(document.querySelector('main [role="status"]')?.textContent?.trim()).toBe(REASON)
      expect(card('Choose a folder').textContent).toContain('Needs https')
      expect(card('Choose a folder').textContent).not.toContain('Needs Chrome or Edge')
      expect(card('Keep it in this browser').textContent).toContain('Needs https')
      expect(isRecommended('Choose a folder')).toBe(false)
      expect(isRecommended('Keep it in this browser')).toBe(false)
      expect(document.querySelector('main ul .bg-gold-soft')).toBeNull() // no "Recommended" tag
    })

    it('uses that reason, not the generic error, when a card is pressed', async () => {
      secure(false)
      await welcome()
      card('Keep it in this browser').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      expect(document.body.textContent).toContain(REASON)
      expect(document.body.textContent).not.toContain('cannot keep files')
      card('Choose a folder').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      expect(document.body.textContent).not.toContain('Needs Chrome or Edge. In this browser')
    })
  })

  it('names the other common cause, a private window, when browser storage is missing on a secure page', async () => {
    const real = navigator.storage
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
    try {
      await welcome()
      card('Keep it in this browser').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      expect(document.body.textContent).toContain(
        'This browser cannot keep files for Aurelia. It may be a private window.',
      )
    } finally {
      Object.defineProperty(navigator, 'storage', { value: real, configurable: true })
    }
  })
})
