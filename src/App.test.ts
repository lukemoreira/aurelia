// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import App from './App.vue'
import { createAppRouter } from './router'
import { useWorkspaceStore } from './stores/workspace'
import { SAMPLE_START } from './sample/saltmarch'

beforeEach(() => localStorage.clear())

async function start(path: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  const app = mount(App, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return { app, router, ws: useWorkspaceStore() }
}

describe('App', () => {
  it('shows the welcome screen on the home route', async () => {
    const { app } = await start('/')
    expect(app.get('h1').text()).toBe('Welcome')
  })

  it('sends a workspace route to the welcome screen when nothing is open', async () => {
    const { router } = await start(`/w/${SAMPLE_START.book}/${SAMPLE_START.scene}`)
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('opens the sample from the welcome screen on Curfew Bells', async () => {
    const { app, router } = await start('/')
    await app
      .findAll('button')
      .find((b) => b.text().includes('Open the sample universe'))!
      .trigger('click')
    await vi.waitFor(() => expect(app.find('h1').text()).toBe('Curfew Bells'), { timeout: 10_000 })
    expect(router.currentRoute.value.path).toBe(`/w/${SAMPLE_START.book}/${SAMPLE_START.scene}`)
  })

  it('says plainly that a folder needs Chrome or Edge where the picker does not exist', async () => {
    const { app } = await start('/')
    const folder = app.findAll('button').find((b) => b.text().includes('Choose a folder'))!
    expect(folder.attributes('aria-disabled')).toBe('true')
    await folder.trigger('click')
    expect(app.get('[role="status"]').text()).toContain('needs Chrome or Edge')
  })
})

describe('route guard', () => {
  it('reopens the sample after a reload, and mends a scene that is not in the book', async () => {
    const first = await start('/')
    first.ws.loadSample()
    const { router, ws } = await start(`/w/${SAMPLE_START.book}/scn_zzzzzzzzzz`)
    expect(ws.loaded).toBe(true)
    expect(router.currentRoute.value.path).toBe(
      `/w/${SAMPLE_START.book}/${ws.sceneFor(SAMPLE_START.book)}`,
    )
  })

  it('sends an unknown book home', async () => {
    const first = await start('/')
    first.ws.loadSample()
    const { router } = await start('/w/bok_zzzzzzzzzz/plan')
    expect(router.currentRoute.value.path).toBe('/')
  })
})
