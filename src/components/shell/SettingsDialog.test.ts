// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { storageBlocked } from '@/composables/usePersisted'
import SettingsDialog from './SettingsDialog.vue'

beforeEach(() => {
  storageBlocked.value = false
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
})
