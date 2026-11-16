// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ArcPicker from './ArcPicker.vue'

const options = [
  { id: 'arc_aaaaaaaaaa', name: 'Alpha', colour: 'var(--ember)' },
  { id: 'arc_bbbbbbbbbb', name: 'Beta', colour: 'var(--tide)' },
]
afterEach(() => (document.body.innerHTML = ''))

async function tick(id: string, stored: string[]) {
  const wrapper = mount(ArcPicker, {
    props: { options, modelValue: stored, label: 'Arcs of Gate' },
    attachTo: document.body,
  })
  await wrapper.find('button').trigger('click')
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
  const box = [...document.body.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((b) =>
    b.parentElement?.textContent?.includes(options.find((o) => o.id === id)!.name),
  )!
  box.click()
  await nextTick()
  return wrapper.emitted('update:modelValue')?.at(-1)?.[0]
}

describe('the arc picker', () => {
  it('ticks an arc on the stored list: one it cannot show stays, and the author’s order is kept', async () => {
    expect(await tick('arc_aaaaaaaaaa', ['arc_zzzzzzzzzz', 'arc_bbbbbbbbbb'])).toEqual([
      'arc_zzzzzzzzzz',
      'arc_bbbbbbbbbb',
      'arc_aaaaaaaaaa',
    ])
  })

  it('unticks only that arc', async () => {
    expect(
      await tick('arc_bbbbbbbbbb', ['arc_zzzzzzzzzz', 'arc_bbbbbbbbbb', 'arc_aaaaaaaaaa']),
    ).toEqual(['arc_zzzzzzzzzz', 'arc_aaaaaaaaaa'])
  })
})
