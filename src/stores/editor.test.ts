// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { DEFAULT_EDITOR_SETTINGS, useEditorStore } from './editor'

const KEY = 'aurelia.v1.editor-settings'
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('the editor settings', () => {
  it('start at the design: a serif, indented paragraphs', () => {
    expect(useEditorStore().settings).toEqual({
      font: 'serif',
      size: 'medium',
      leading: 'normal',
      paragraphs: 'indent',
    })
  })

  it('are kept on this device and read back', async () => {
    const store = useEditorStore()
    store.settings.font = 'sans'
    store.settings.paragraphs = 'wide'
    await nextTick()
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      font: 'sans',
      paragraphs: 'wide',
    })
    setActivePinia(createPinia())
    expect(useEditorStore().settings).toMatchObject({ font: 'sans', paragraphs: 'wide' })
  })

  it('read a saved value that is no longer a choice as the default, field by field', () => {
    localStorage.setItem(KEY, JSON.stringify({ font: 'comic', size: 'large', leading: 3 }))
    expect(useEditorStore().settings).toEqual({ ...DEFAULT_EDITOR_SETTINGS, size: 'large' })
  })

  it('read something that is not an object as the defaults', () => {
    localStorage.setItem(KEY, '"loud"')
    expect(useEditorStore().settings).toEqual(DEFAULT_EDITOR_SETTINGS)
  })

  it('go back to the defaults, which a change never touches', () => {
    const store = useEditorStore()
    store.settings.size = 'larger'
    expect(DEFAULT_EDITOR_SETTINGS.size).toBe('medium')
    store.reset()
    expect(store.settings).toEqual({ ...DEFAULT_EDITOR_SETTINGS, size: 'medium' })
    expect(store.settings.size).toBe('medium')
  })
})
