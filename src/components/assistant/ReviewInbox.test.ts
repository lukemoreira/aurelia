// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { useAppUpdate } from '@/composables/useAppUpdate'
import { useProposals } from '@/composables/useProposals'
import ReviewInbox from './ReviewInbox.vue'

async function inbox(unreadable: number) {
  setActivePinia(createPinia())
  const w = mount(ReviewInbox)
  await flushPromises()
  useProposals().unreadable.value = unreadable
  await flushPromises()
  return w
}

describe('suggestions this version cannot read', () => {
  it('are said in plain words instead of "No suggestions waiting"', async () => {
    const w = await inbox(3)
    expect(w.text()).toContain(
      '3 suggestions could not be read (a newer Aurelia may have written them, or the files are damaged).',
    )
    expect(w.text()).not.toContain('No suggestions waiting')
    expect(w.text()).not.toContain('Update Aurelia')
    expect((await inbox(1)).text()).toContain(
      '1 suggestion could not be read (a newer Aurelia may have written it, or the file is damaged).',
    )
    expect((await inbox(0)).text()).toContain('No suggestions waiting.')
  })

  it('offer the update beside them when one is waiting', async () => {
    const update = useAppUpdate()
    update.updateReady.value = true
    try {
      const w = await inbox(2)
      expect(w.find('button').text()).toBe('Update Aurelia to see them')
      update.dismiss() // "Later" on the toast: the update still waits, so the inbox still offers it
      await flushPromises()
      expect(w.find('button').text()).toBe('Update Aurelia to see them')
    } finally {
      update.updateReady.value = false
    }
  })
})
