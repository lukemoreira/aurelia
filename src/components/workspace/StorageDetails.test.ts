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
})
