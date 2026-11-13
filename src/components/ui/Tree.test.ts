// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { TreeNode } from '@/composables/useTree'
import Tree from './Tree.vue'

const items: TreeNode[] = [
  { id: 'a', label: 'Alpha', children: [{ id: 'a1', label: 'Alpha one' }] },
  { id: 'b', label: 'Beta' },
]

const press = async (el: Element, key: string) => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Tree', () => {
  it('opens a branch with ArrowRight and closes it with ArrowLeft', async () => {
    const wrapper = mount(Tree, {
      props: {
        items,
        label: 'Workspace',
        expanded: [],
        'onUpdate:expanded': (v: string[]) => wrapper.setProps({ expanded: v }),
      },
      attachTo: document.body,
    })
    const rows = () => wrapper.findAll('[role="treeitem"]')
    expect(rows()).toHaveLength(2)

    const alpha = rows()[0]!
    ;(alpha.element as HTMLElement).focus()
    await press(alpha.element, 'ArrowRight')
    expect(rows()).toHaveLength(3)
    expect(rows()[0]!.attributes('aria-expanded')).toBe('true')

    await press(rows()[0]!.element, 'ArrowLeft')
    expect(rows()).toHaveLength(2)
    expect(rows()[0]!.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('selects a row on Enter and reports its id', async () => {
    const wrapper = mount(Tree, { props: { items, label: 'Workspace' }, attachTo: document.body })
    const beta = wrapper.findAll('[role="treeitem"]')[1]!
    ;(beta.element as HTMLElement).focus()
    await press(beta.element, 'Enter')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['b'])
    wrapper.unmount()
  })

  describe('row actions from the keyboard', () => {
    const menu = () => [
      { id: 'rename', label: 'Rename…' },
      { id: 'up', label: 'Move up' },
      { id: 'down', label: 'Move down', disabled: true },
      { id: 'delete', label: 'Delete' },
    ]
    const key = async (el: Element, init: KeyboardEventInit) => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      el.dispatchEvent(e)
      await nextTick()
      return e
    }
    async function row() {
      const wrapper = mount(Tree, {
        props: { items, label: 'Workspace', menu },
        attachTo: document.body,
      })
      const beta = wrapper.findAll('[role="treeitem"]')[1]!
      ;(beta.element as HTMLElement).focus()
      return { wrapper, beta: beta.element }
    }

    it('F2 renames, and Alt+↑ moves up', async () => {
      const { wrapper, beta } = await row()
      await key(beta, { key: 'F2' })
      await key(beta, { key: 'ArrowUp', altKey: true })
      expect(wrapper.emitted('action')).toEqual([
        ['b', 'rename', true],
        ['b', 'up', true],
      ])
      wrapper.unmount()
    })

    it('Delete deletes, and so does Backspace (a Mac’s delete key) and ⌘⌫', async () => {
      const { wrapper, beta } = await row()
      await key(beta, { key: 'Delete' })
      await key(beta, { key: 'Backspace' })
      await key(beta, { key: 'Backspace', metaKey: true })
      expect(wrapper.emitted('action')).toEqual([
        ['b', 'delete', true],
        ['b', 'delete', true],
        ['b', 'delete', true],
      ])
      wrapper.unmount()
    })

    it('does nothing for a move the menu has disabled, or for Alt+Backspace, or while typing in a field', async () => {
      const { wrapper, beta } = await row()
      await key(beta, { key: 'ArrowDown', altKey: true }) // "Move down" is disabled
      await key(beta, { key: 'Backspace', altKey: true })
      const input = document.createElement('input')
      beta.appendChild(input)
      await key(input, { key: 'Backspace' })
      await key(input, { key: 'F2' })
      expect(wrapper.emitted('action')).toBeUndefined()
      wrapper.unmount()
    })

    it('the context-menu key (and Shift+F10) opens the row’s menu', async () => {
      const { wrapper, beta } = await row()
      const opener = beta.querySelector<HTMLElement>('[data-row-menu]')!
      const clicked = vi.fn()
      opener.addEventListener('click', clicked)
      await key(beta, { key: 'ContextMenu' })
      await key(beta, { key: 'F10', shiftKey: true })
      expect(clicked).toHaveBeenCalledTimes(2)
      wrapper.unmount()
    })

    it('has no actions, no menu button and no drag without a menu', async () => {
      const wrapper = mount(Tree, { props: { items, label: 'Workspace' }, attachTo: document.body })
      const beta = wrapper.findAll('[role="treeitem"]')[1]!
      await key(beta.element, { key: 'Delete' })
      expect(wrapper.emitted('action')).toBeUndefined()
      expect(wrapper.find('[data-row-menu]').exists()).toBe(false)
      wrapper.unmount()
    })
  })
})
