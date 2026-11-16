// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { setBookMode } from '@/storage/story-actions'
import { storyRig } from '../../tests/helpers/story-rig'
import { addChoice } from '@/storage/story-actions'
import MapView from './MapView.vue'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace: push, currentRoute: { value: { name: 'map' } } }),
}))
beforeEach(() => {
  localStorage.clear()
  push.mockReset()
})
afterEach(() => (document.body.innerHTML = ''))

const button = (name: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)
const press = (key: string, extra: KeyboardEventInit = {}) =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
  )

describe('the story map of a straight book', () => {
  it('says the book is a straight story, and (for the author) offers the way to a branching one', async () => {
    const r = await storyRig()
    await setBookMode(r.session, r.book, 'linear')
    mount(MapView, { attachTo: document.body })
    expect(document.body.textContent).toContain('This book is a straight story')
    expect(document.body.querySelector('[aria-label="Story map"]')).toBeNull() // no canvas
    button('Make it a branching story')!.click()
    await vi.waitFor(() => expect(r.session.data.books[0]!.mode).toBe('branching'))
    await flushPromises()
    expect(document.body.textContent).not.toContain('This book is a straight story')
    expect(document.body.querySelector('[aria-label="Story map"]')).not.toBeNull()
  })
})

describe('Play mode in the view', () => {
  async function playing() {
    const r = await storyRig()
    await addChoice(r.session, r.start, { label: 'Go left', target: r.left })
    mount(MapView, { attachTo: document.body })
    button('Play from start')!.click()
    await nextTick()
    return r
  }

  it('Escape leaves Play and shows the map again; the first scene has no previous scene', async () => {
    await playing()
    expect(document.body.querySelector('section[aria-label="Play"]')).not.toBeNull()
    expect(button('Previous scene')!.hasAttribute('disabled')).toBe(true)
    press('Escape')
    await nextTick()
    expect(document.body.querySelector('section[aria-label="Play"]')).toBeNull()
    expect(document.body.querySelector('[aria-label="Story map"]')).not.toBeNull()
  })

  it('Escape that something else has already used does not leave Play', async () => {
    await playing()
    const used = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    used.preventDefault()
    document.dispatchEvent(used)
    await nextTick()
    expect(document.body.querySelector('section[aria-label="Play"]')).not.toBeNull()
  })

  it('the scene is a level-two heading under the page’s one level-one, and a choice is followed', async () => {
    const r = await playing()
    const play = document.body.querySelector('section[aria-label="Play"]')!
    expect(play.querySelector('h1')).toBeNull()
    expect(play.querySelector('h2')!.textContent).toContain('Start')
    button('Go left')!.click()
    await nextTick()
    expect(play.querySelector('h2')!.textContent).toContain('Left')
    expect(r.start).toBeTruthy()
  })

  it('"Show" on a problem while playing leaves Play and selects the scene', async () => {
    const r = await playing()
    const hide = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Show',
    )!
    hide.click()
    await nextTick()
    expect(document.body.querySelector('section[aria-label="Play"]')).toBeNull()
    expect(r.session.data.scenes.length).toBe(3)
  })
})
