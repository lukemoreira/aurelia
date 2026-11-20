// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Editor } from '@tiptap/core'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeSpeech, removeFakeSpeech } from '../../../tests/helpers/fake-speech'
import SceneEditor from './SceneEditor.vue'

// One reader per test, in place of the page-wide one, so each test starts from a fresh fake.
const hold = vi.hoisted(() => ({ reader: null as unknown }))
vi.mock('@/composables/useReadAloud', async (original) => ({
  ...(await original<typeof import('@/composables/useReadAloud')>()),
  useReadAloud: () => hold.reader,
}))
const { createReadAloud } = await import('@/composables/useReadAloud')

let wrapper: VueWrapper | undefined
let speech: ReturnType<typeof installFakeSpeech>
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  removeFakeSpeech(window)
  localStorage.clear()
})

async function show(speaks = true) {
  if (speaks) speech = installFakeSpeech(window)
  hold.reader = createReadAloud()
  document.body.innerHTML = '<h1 id="scene-title">A scene</h1>'
  const target = document.createElement('div')
  document.body.append(target)
  wrapper = mount(SceneEditor, {
    props: {
      body: 'One.\n\nTwo.\n',
      readonly: false,
      titleId: 'scene-title',
      toolbarTarget: target,
    },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper.find<HTMLElement & { editor: Editor }>('[role="textbox"]').element.editor
}
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((b) =>
    b.getAttribute('aria-label')?.startsWith(name),
  )
const bar = () => document.querySelector('[role="group"][aria-label="Reading aloud"]')
const marked = () => document.querySelector('.reading-now')?.textContent ?? null

describe('read aloud in the scene editor', () => {
  it('reads from the toolbar: the paragraph is marked, a control shows, and nothing is edited', async () => {
    const editor = await show()
    editor.commands.setTextSelection(1)
    button('Read aloud')!.click()
    await flushPromises()
    expect(speech.texts()).toEqual(['One.', 'Two.'])
    expect(marked()).toBe('One.')
    expect(button('Read aloud')!.getAttribute('aria-pressed')).toBe('true')
    expect(bar()?.textContent).toContain('Reading aloud')
    speech.finish()
    expect(marked()).toBe('Two.')
    expect(wrapper!.emitted('edit') ?? []).toEqual([])
  })

  it('pauses and resumes from the control, and Stop ends it and gives the text the keyboard', async () => {
    const editor = await show()
    button('Read aloud')!.click()
    await flushPromises()
    button('Pause')!.click()
    await flushPromises()
    expect(speech.paused).toBe(true)
    expect(bar()?.textContent).toContain('Paused')
    button('Resume')!.click()
    await flushPromises()
    expect(speech.paused).toBe(false)
    button('Stop')!.click()
    await flushPromises()
    expect(bar()).toBeNull()
    expect(marked()).toBeNull()
    expect(editor.isFocused).toBe(true)
    expect(wrapper!.emitted('edit') ?? []).toEqual([])
  })

  it('stops when the author types in the text', async () => {
    const editor = await show()
    button('Read aloud')!.click()
    await flushPromises()
    editor.commands.insertContent('x')
    await flushPromises()
    expect(bar()).toBeNull()
    expect(marked()).toBeNull()
    expect(speech.cancels).toBe(1)
  })

  it('stops when the scene is left', async () => {
    await show()
    button('Read aloud')!.click()
    await flushPromises()
    wrapper!.unmount()
    wrapper = undefined
    expect(speech.cancels).toBe(1)
    expect(document.querySelector('.reading-now')).toBeNull()
  })

  it('has no button where the browser cannot speak', async () => {
    await show(false)
    expect(button('Read aloud')).toBeUndefined()
  })
})
