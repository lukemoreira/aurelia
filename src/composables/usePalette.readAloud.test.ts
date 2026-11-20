// SPDX-License-Identifier: AGPL-3.0-or-later
import { Editor } from '@tiptap/core'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { editorExtensions } from '@/editor/extensions'
import { bodyToDoc } from '@/editor/markdown/body'
import { SAMPLE_START } from '@/sample/saltmarch'
import { useWorkspaceStore } from '@/stores/workspace'
import { installFakeSpeech, removeFakeSpeech } from '../../tests/helpers/fake-speech'
import { usePalette } from './usePalette'

// One reader per test, in place of the page-wide one, so each test starts from a fresh fake.
const hold = vi.hoisted(() => ({ reader: null as unknown }))
vi.mock('@/composables/useReadAloud', async (original) => ({
  ...(await original<typeof import('@/composables/useReadAloud')>()),
  useReadAloud: () => hold.reader,
}))
const { createReadAloud } = await import('@/composables/useReadAloud')

let editor: Editor | undefined
beforeEach(() => localStorage.clear())
afterEach(() => {
  editor?.destroy()
  editor = undefined
  removeFakeSpeech(window)
})

async function setup(speaks = true) {
  const speech = speaks ? installFakeSpeech(window) : undefined
  const reader = createReadAloud()
  hold.reader = reader
  const pinia = createPinia()
  setActivePinia(pinia)
  const ws = useWorkspaceStore()
  ws.loadSample()
  ws.select(SAMPLE_START.book, SAMPLE_START.scene)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/write', name: 'write', component: { render: () => null } }],
  })
  let palette!: ReturnType<typeof usePalette>
  mount(defineComponent({ setup: () => ((palette = usePalette()), () => h('div')) }), {
    global: { plugins: [pinia, router] },
  })
  await router.push('/write')
  await flushPromises()
  editor = new Editor({ extensions: editorExtensions, content: bodyToDoc('One.\n\nTwo.\n') })
  const entry = () => {
    palette.query.value = 'aloud'
    return palette.items.value.find((i) => i.id === 'action:read-aloud')
  }
  return { reader, speech, entry, palette }
}

describe('the Read this scene aloud command', () => {
  it('is offered once a scene is on screen, reads it, and then offers to stop', async () => {
    const { reader, speech, entry, palette } = await setup()
    expect(entry()).toBeUndefined() // no scene text yet
    reader.attach(editor!)
    expect(entry()!.title).toBe('Read this scene aloud')
    palette.choose(entry()!)
    expect(speech!.texts()).toEqual(['One.', 'Two.'])
    expect(entry()!.title).toBe('Stop reading aloud')
    palette.choose(entry()!)
    expect(reader.status.value).toBe('idle')
  })

  it('is not offered where the browser cannot speak', async () => {
    const { reader, entry } = await setup(false)
    reader.attach(editor!)
    expect(entry()).toBeUndefined()
  })
})
