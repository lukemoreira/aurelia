// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
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
})
