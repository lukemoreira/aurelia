// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { storageBlocked } from '@/composables/usePersisted'
import { useEditorStore } from '@/stores/editor'
import SettingsDialog from './SettingsDialog.vue'

beforeEach(() => {
  storageBlocked.value = false
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => {
  document.body.innerHTML = ''
})

const open = async () => {
  const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
  }
  return wrapper
}

describe('SettingsDialog', () => {
  it('says settings are kept on this device', async () => {
    const wrapper = await open()
    expect(document.body.textContent).toContain('Kept on this device.')
    wrapper.unmount()
  })

  it('says nothing is kept when the browser blocks storage', async () => {
    storageBlocked.value = true
    const wrapper = await open()
    expect(document.body.textContent).toContain('Not kept — this browser blocks storage')
    expect(document.body.textContent).not.toContain('Kept on this device.')
    wrapper.unmount()
  })

  it('offers the font, size, line height and paragraph spacing of the text, and applies a choice', async () => {
    const reset = vi.spyOn(useEditorStore(), 'reset')
    const wrapper = await open()
    for (const name of ['Font', 'Text size', 'Line height', 'Paragraphs'])
      expect(
        document.querySelector(`[role="radiogroup"][aria-label="${name}"]`),
        name,
      ).not.toBeNull()
    const radio = (group: string, label: string) =>
      [
        ...document.querySelectorAll(`[role="radiogroup"][aria-label="${group}"] [role="radio"]`),
      ].find((r) => r.textContent?.trim() === label) as HTMLElement
    expect(radio('Font', 'Serif').getAttribute('aria-checked')).toBe('true')
    radio('Font', 'Mono').click()
    radio('Text size', 'Large').click()
    radio('Line height', 'Roomy').click()
    radio('Paragraphs', 'Space').click()
    await nextTick()
    expect(useEditorStore().settings).toEqual({
      font: 'mono',
      size: 'large',
      leading: 'roomy',
      paragraphs: 'space',
    })
    ;(
      [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Back to the defaults'),
      ) as HTMLElement
    ).click()
    await nextTick()
    expect(reset).toHaveBeenCalled()
    expect(useEditorStore().settings.font).toBe('serif')
    wrapper.unmount()
  })
})
