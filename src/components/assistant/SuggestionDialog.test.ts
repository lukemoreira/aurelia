// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { Proposal } from '@/domain/proposals'

const state = {
  all: shallowRef<Proposal[]>([]),
  outOfDate: ref(new Set<string>()),
  working: ref<string | null>(null),
  accept: vi.fn(async () => undefined),
  reject: vi.fn(async () => undefined),
  askChanges: vi.fn(async () => undefined),
}
vi.mock('@/composables/useProposals', () => ({ useProposals: () => state }))
import SuggestionDialog from './SuggestionDialog.vue'

const EDIT: Proposal = {
  schemaVersion: 1,
  id: 'prp_aaaaaaaaaa',
  createdAt: '2026-11-21T10:00:00Z',
  by: 'Claude',
  why: 'Dusk clashes with chapter 7.',
  kind: 'edit',
  sceneId: 'scn_x',
  sceneTitle: 'The quay',
  baseHash: 'x',
  changes: [
    {
      block: 'b0-1',
      before: 'Tomas came at dusk.',
      after: 'Tomas came in the afternoon.',
      occurrence: 0,
      copies: 1,
    },
    {
      block: 'b1-2',
      before: 'The clerk counted.',
      after: 'The clerk counted twice.',
      occurrence: 0,
      copies: 1,
    },
  ],
}
const REMOVAL: Proposal = {
  ...EDIT,
  id: 'prp_bbbbbbbbbb',
  changes: [{ block: 'b0-1', before: 'Tomas came at dusk.', after: '', occurrence: 0, copies: 1 }],
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await flushPromises()
}
const body = () => document.body
const button = (name: string) =>
  [...body().querySelectorAll('button')].find((b) => b.textContent?.trim() === name)
const boxes = () => [...body().querySelectorAll('textarea')] as HTMLTextAreaElement[]

async function open(p: Proposal, change = 0, outOfDate = false) {
  state.all.value = [p]
  state.outOfDate.value = new Set(outOfDate ? [p.id] : [])
  const closed = vi.fn()
  const w = mount(SuggestionDialog, {
    props: { target: { id: p.id, change }, onClose: closed },
    attachTo: document.body,
  })
  mounted.push(w)
  await settle()
  return { w, closed }
}
async function type(box: HTMLTextAreaElement, text: string) {
  box.value = text
  box.dispatchEvent(new Event('input'))
  await settle()
}

beforeEach(() => {
  state.accept.mockClear()
  state.reject.mockClear()
  state.askChanges.mockClear()
})
const mounted: { unmount: () => void }[] = []
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount()
  document.body.innerHTML = ''
})

describe('the suggestion popup', () => {
  it('shows what changes, with Approve, Edit, Dismiss and Ask for changes, and marks the paragraph clicked', async () => {
    await open(EDIT, 1)
    const dialog = body().querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Suggestion for “The quay”')
    expect(dialog.textContent).toContain('Dusk clashes with chapter 7.')
    expect(dialog.querySelectorAll('del, ins').length).toBeGreaterThan(0)
    for (const n of ['Approve', 'Edit', 'Dismiss', 'Ask for changes'])
      expect(button(n)).toBeTruthy()
    const marked = dialog.querySelectorAll('[data-focused]')
    expect(marked).toHaveLength(1)
    expect(marked[0]!.textContent).toContain('counted')
  })

  it('Approve accepts the suggestion as it is; Dismiss rejects it', async () => {
    await open(EDIT)
    button('Approve')!.click()
    await settle()
    expect(state.accept).toHaveBeenCalledWith(EDIT, undefined)
    button('Dismiss')!.click()
    await settle()
    expect(state.reject).toHaveBeenCalledWith(EDIT)
  })

  it('Edit shows one text box per changed paragraph, and Approve hands over the author’s text', async () => {
    await open(EDIT)
    button('Edit')!.click()
    await settle()
    expect(boxes().map((b) => b.value)).toEqual([
      'Tomas came in the afternoon.',
      'The clerk counted twice.',
    ])
    expect(document.activeElement).toBe(boxes()[0])
    await type(boxes()[0]!, 'Tomas came in the evening.')
    button('Approve my text')!.click()
    await settle()
    expect(state.accept).toHaveBeenCalledWith(EDIT, [
      'Tomas came in the evening.',
      'The clerk counted twice.',
    ])
  })

  it('Cancel goes back to the suggestion without changing anything', async () => {
    await open(EDIT)
    button('Edit')!.click()
    await settle()
    await type(boxes()[0]!, 'Something else')
    button('Cancel')!.click()
    await settle()
    expect(boxes()).toHaveLength(0)
    expect(state.accept).not.toHaveBeenCalled()
    expect(state.reject).not.toHaveBeenCalled()
    expect(body().querySelector('[role="dialog"]')!.textContent).toContain('afternoon')
    // Editing again starts from the assistant's text, not the abandoned edit.
    button('Edit')!.click()
    await settle()
    expect(boxes()[0]!.value).toBe('Tomas came in the afternoon.')
  })

  it('an emptied paragraph cannot be approved unless the suggestion removes it', async () => {
    await open(EDIT)
    button('Edit')!.click()
    await settle()
    await type(boxes()[1]!, '  ')
    expect(button('Approve my text')!.disabled).toBe(true)
    expect(body().textContent).toContain('A paragraph can only be left empty')
    await type(boxes()[1]!, 'Fine.')
    expect(button('Approve my text')!.disabled).toBe(false)
    for (const w of mounted.splice(0)) w.unmount()
    await open(REMOVAL)
    button('Edit')!.click()
    await settle()
    await type(boxes()[0]!, '')
    expect(button('Approve my text')!.disabled).toBe(false)
  })

  it('an out-of-date suggestion says so and offers only Dismiss and Ask again', async () => {
    await open(EDIT, 0, true)
    expect(body().textContent).toContain('Out of date')
    expect(button('Approve')).toBeUndefined()
    expect(button('Edit')).toBeUndefined()
    expect(button('Dismiss')).toBeTruthy()
    expect(button('Ask again')).toBeTruthy()
  })

  it('Escape closes it and changes nothing', async () => {
    const { closed } = await open(EDIT)
    body()
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(closed).toHaveBeenCalled()
    expect(state.accept).not.toHaveBeenCalled()
    expect(state.reject).not.toHaveBeenCalled()
  })

  it('closes itself once the suggestion is gone', async () => {
    const { closed } = await open(EDIT)
    state.all.value = []
    await settle()
    expect(closed).toHaveBeenCalled()
  })
})
