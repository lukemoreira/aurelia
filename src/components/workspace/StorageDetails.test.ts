// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { persistedWords } from '@/backup/words'

const fakeWs = vi.hoisted(() => ({ value: undefined as unknown }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => fakeWs.value }))

import StorageDetails from './StorageDetails.vue'

describe('StorageDetails', () => {
  it.each([true, false, null])(
    'says what the browser answered in the words the Backup screen uses (%s)',
    (persisted) => {
      setActivePinia(createPinia())
      fakeWs.value = reactive({
        view: { kind: 'browser', name: 'My Book', label: 'this browser', persisted },
      })
      const { title, text } = persistedWords(persisted)
      const shown = mount(StorageDetails).text()
      expect(shown).toContain(title)
      expect(shown).toContain(text)
    },
  )

  it('offers Rename workspace…, and when it cannot says why instead', async () => {
    setActivePinia(createPinia())
    fakeWs.value = reactive({ view: { kind: 'browser', name: 'My Book', label: 'this browser' } })
    const open = mount(StorageDetails)
    const button = () => open.findAll('button').find((b) => b.text() === 'Rename workspace…')!
    expect(button().attributes('aria-disabled')).toBeUndefined()
    await button().trigger('click')
    expect(open.emitted('rename')).toHaveLength(1)

    fakeWs.value = reactive({
      view: { kind: 'browser', name: 'My Book', label: 'this browser', otherTab: true },
    })
    const blocked = mount(StorageDetails)
    expect(blocked.text()).toContain('open in another tab')
    const rename = blocked.findAll('button').find((b) => b.text() === 'Rename workspace…')!
    // Still reachable by keyboard (not `disabled`), says it is unavailable, and points at why.
    expect(rename.attributes('disabled')).toBeUndefined()
    expect(rename.attributes('aria-disabled')).toBe('true')
    expect(blocked.find(`#${rename.attributes('aria-describedby')}`).text()).toContain(
      'open in another tab',
    )
    await rename.trigger('click')
    expect(blocked.emitted('rename')).toBeUndefined()
  })
})
