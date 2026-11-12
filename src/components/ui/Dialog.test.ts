// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import Dialog from './Dialog.vue'

const Host = defineComponent({
  setup() {
    const open = ref(false)
    return () =>
      h('div', [
        h('button', { id: 'opener', onClick: () => (open.value = true) }, 'Open'),
        h(
          Dialog,
          {
            open: open.value,
            title: 'Delete scene?',
            'onUpdate:open': (v: boolean) => (open.value = v),
          },
          () => h('p', 'Body'),
        ),
      ])
  },
})

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Dialog', () => {
  it('shows its title, closes on Esc and returns focus to the opener', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    const opener = document.getElementById('opener') as HTMLButtonElement
    opener.focus()
    opener.click()
    await settle()
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Delete scene?')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
  })

  it('does not compile without a title', () => {
    // @ts-expect-error `title` is required
    const props: InstanceType<typeof Dialog>['$props'] = { open: false }
    expect(props.title).toBeUndefined()
  })
})
