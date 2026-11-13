// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useEditsStore } from '@/stores/edits'
import ActionToast from './ActionToast.vue'

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  document.body.innerHTML = ''
})

const keydown = async (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  await nextTick()
  return e
}
/** The shortcut modifier the test environment reads as "the" modifier (Ctrl, off a Mac). */
const mod = { ctrlKey: true, metaKey: false }

function show(undo = vi.fn(async () => undefined), focusUndo = false) {
  const wrapper = mount(ActionToast, { attachTo: document.body })
  const edits = useEditsStore()
  edits.toast = { text: 'Moved “Gate” to Recently deleted.', undo, focusUndo }
  return { wrapper, edits, undo }
}

describe('the action toast', () => {
  it('sits in the page’s own flow (absolute inside the main column), not fixed over the status bar', async () => {
    const { wrapper } = show()
    await nextTick()
    const toast = wrapper.find('[role="status"].absolute')
    expect(toast.exists()).toBe(true)
    expect(toast.classes()).not.toContain('fixed')
    wrapper.unmount()
  })

  it('puts focus on Undo after a delete made from the keyboard, and not after one made with the mouse', async () => {
    const keyboard = show(undefined, true)
    await nextTick()
    await nextTick()
    expect(document.activeElement?.textContent?.trim()).toBe('Undo')
    keyboard.wrapper.unmount()
    document.body.innerHTML = ''
    const mouse = show(undefined, false)
    await nextTick()
    await nextTick()
    expect(document.activeElement?.textContent?.trim()).not.toBe('Undo')
    mouse.wrapper.unmount()
  })

  it('Esc dismisses it, but leaves it when a dialog is open (Esc closes that first)', async () => {
    const { wrapper, edits } = show()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    await keydown({ key: 'Escape' })
    expect(edits.toast).not.toBeNull()
    dialog.remove()
    await keydown({ key: 'Escape' })
    expect(edits.toast).toBeNull()
    wrapper.unmount()
  })

  it('Ctrl/⌘+Z undoes the delete — but not while typing in a field, where Z is the text’s own undo', async () => {
    const { wrapper, edits, undo } = show()
    const field = document.createElement('textarea')
    document.body.appendChild(field)
    await keydown({ code: 'KeyZ', key: 'z', ...mod }, field)
    expect(undo).not.toHaveBeenCalled()
    expect(edits.toast).not.toBeNull()
    const e = await keydown({ code: 'KeyZ', key: 'z', ...mod })
    expect(e.defaultPrevented).toBe(true)
    expect(undo).toHaveBeenCalledOnce()
    expect(edits.toast).toBeNull()
    wrapper.unmount()
  })

  it('does not take Ctrl+Z when there is nothing to undo (an error toast)', async () => {
    const wrapper = mount(ActionToast, { attachTo: document.body })
    const edits = useEditsStore()
    edits.toast = { text: 'A workspace keeps at least one book. Add another first.', error: true }
    const e = await keydown({ code: 'KeyZ', key: 'z', ...mod })
    expect(e.defaultPrevented).toBe(false)
    expect(edits.toast).not.toBeNull()
    wrapper.unmount()
  })

  it('has a status line for moves that is read out and never shown', async () => {
    const wrapper = mount(ActionToast, { attachTo: document.body })
    const edits = useEditsStore()
    await edits.announce('Moved “Gate” after “Arrival”.')
    await nextTick()
    const line = wrapper.find('p[role="status"]')
    expect(line.classes()).toContain('sr-only')
    expect(line.text()).toBe('Moved “Gate” after “Arrival”.')
    wrapper.unmount()
  })
})
