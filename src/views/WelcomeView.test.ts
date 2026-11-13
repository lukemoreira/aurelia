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
})
