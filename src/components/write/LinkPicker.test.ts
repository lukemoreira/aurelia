// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PickerView } from '@/editor/link-env'
import LinkPicker from './LinkPicker.vue'

const item = (n: number, title: string, label: string) => ({
  kind: 'record' as const,
  id: `chr_000000000${n}`,
  title,
  label,
  tone: 'ember' as const,
  byId: false,
})
const picker = (over: Partial<PickerView> = {}): PickerView => ({
  rect: () => new DOMRect(40, 100, 0, 20),
  query: 'co',
  items: [item(1, 'Corin', 'Character'), item(2, 'Corin', 'Place')],
  active: 1,
  choose: vi.fn(),
  ...over,
})
afterEach(() => (document.body.innerHTML = ''))
const show = (p: PickerView) => {
  const w = mount(LinkPicker, { props: { picker: p }, attachTo: document.body })
  return w
}

describe('the picker on [[', () => {
  it('lists each match with what it is, marks the highlighted one, and takes a click without taking focus', () => {
    const p = picker()
    show(p)
    const options = [...document.body.querySelectorAll('[role="option"]')]
    expect(options.map((o) => o.textContent!.replace(/\s+/g, ' ').trim().slice(1))).toEqual([
      'CorinCharacter',
      'CorinPlace',
    ])
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true'])
    expect(options[1]!.id).toBe('link-option-1')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    options[0]!.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true) // the editor keeps the focus
    expect(p.choose).toHaveBeenCalledWith(p.items[0])
  })

  it('says how many matches there are, once, and not which one is highlighted (the editor points at it)', () => {
    show(picker())
    expect(document.body.querySelector('[role="status"]')!.textContent).toBe('2 matches')
    show(picker({ items: [item(1, 'Corin', 'Character')], active: 0 }))
    expect([...document.body.querySelectorAll('[role="status"]')].at(-1)!.textContent).toBe(
      '1 match',
    )
  })

  it('says nothing matches, and offers only the key that is true then', () => {
    show(picker({ items: [], query: 'zz' }))
    const t = document.body.textContent!
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
    expect(t).toContain('Nothing is called “zz”.')
    expect(t).toContain('esc to close')
    expect(t).not.toContain('↵ to link')
  })

  it('asks where the caret is again when the page scrolls, so it follows it', async () => {
    let top = 100
    const w = show(picker({ rect: () => new DOMRect(40, top, 0, 20) }))
    const box = () => (document.body.querySelector('div.fixed') as HTMLElement).style.top
    expect(box()).toBe('126px')
    top = 300
    window.dispatchEvent(new Event('scroll'))
    await w.vm.$nextTick()
    expect(box()).toBe('326px')
  })
})
