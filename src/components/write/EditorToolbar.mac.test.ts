// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Editor } from '@tiptap/core'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

// On a Mac the shortcut modifier is Command, and a screen reader should be told so.
const keys = vi.hoisted(() => ({ mac: false }))
vi.mock('@/composables/useKeyboardShortcuts', async (original) => ({
  ...(await original<typeof import('@/composables/useKeyboardShortcuts')>()),
  get isMac() {
    return keys.mac
  },
}))

import SceneEditor from './SceneEditor.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

async function shortcuts(mac: boolean) {
  keys.mac = mac
  setActivePinia(createPinia())
  document.body.innerHTML = '<h1 id="scene-title">A scene</h1>'
  const target = document.createElement('div')
  document.body.append(target)
  const wrapper = mount(SceneEditor, {
    props: { body: 'x\n', readonly: false, titleId: 'scene-title', toolbarTarget: target },
    attachTo: document.body,
  })
  await flushPromises()
  const out = Object.fromEntries(
    [...target.querySelectorAll('button[aria-keyshortcuts]')].map((b) => [
      b.getAttribute('aria-label'),
      b.getAttribute('aria-keyshortcuts'),
    ]),
  )
  const editor = wrapper.find<HTMLElement & { editor: Editor }>('[role="textbox"]').element.editor
  wrapper.unmount()
  expect(editor).toBeDefined()
  return out
}

describe('the formatting bar’s keyboard shortcuts, as a screen reader hears them', () => {
  it('say Control on Windows and Linux', async () => {
    expect(await shortcuts(false)).toMatchObject({
      Bold: 'Control+B',
      Italic: 'Control+I',
      Strikethrough: 'Control+Shift+S',
    })
  })
  it('say Meta (Command) on a Mac', async () => {
    const out = await shortcuts(true)
    expect(out).toMatchObject({ Bold: 'Meta+B', Undo: 'Meta+Z', Redo: 'Meta+Shift+Z' })
    expect(Object.values(out).join(' ')).not.toContain('Control')
  })
})
