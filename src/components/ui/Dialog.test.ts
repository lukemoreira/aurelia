// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import Dialog from './Dialog.vue'

const Host = defineComponent({
  props: { locked: Boolean, fallbackFocus: { type: Function, default: undefined } },
  setup(props) {
    const open = ref(false)
    return () =>
      h('div', [
        h('button', { id: 'opener', onClick: () => (open.value = true) }, 'Open'),
        h(
          Dialog,
          {
            open: open.value,
            title: 'Delete scene?',
            locked: props.locked,
            fallbackFocus: props.fallbackFocus as (() => void) | undefined,
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

  it('when the opener is gone on close (its own action removed it), focus goes where the dialog says', async () => {
    const elsewhere = document.createElement('button')
    document.body.append(elsewhere)
    const wrapper = mount(Host, {
      props: { fallbackFocus: () => elsewhere.focus() },
      attachTo: document.body,
    })
    const opener = document.getElementById('opener') as HTMLButtonElement
    opener.focus()
    opener.click()
    await settle()
    opener.remove()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(document.activeElement).toBe(elsewhere)
    wrapper.unmount()
  })

  it('does not compile without a title', () => {
    // @ts-expect-error `title` is required
    const props: InstanceType<typeof Dialog>['$props'] = { open: false }
    expect(props.title).toBeUndefined()
  })

  it('while locked, Esc and the close button leave it open, and it closes again once it is not', async () => {
    const wrapper = mount(Host, { attachTo: document.body, props: { locked: true } })
    expect(wrapper.findComponent(Dialog).props('locked')).toBe(true)
    const opener = document.getElementById('opener') as HTMLButtonElement
    opener.focus()
    opener.click()
    await settle()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await settle()
    expect(document.body.textContent).toContain('Delete scene?')
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
    expect(close.disabled).toBe(true)
    await wrapper.setProps({ locked: false })
    await settle()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await settle()
    expect(document.body.textContent).not.toContain('Delete scene?')
    wrapper.unmount()
  })
})
