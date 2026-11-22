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
    props: { target: { hits: [{ id: p.id, change }], pos: 0 }, onClose: closed },
    attachTo: document.body,
  })
  mounted.push(w)
  await settle()
  return { w, closed }
}
const SECOND: Proposal = {
  ...EDIT,
  id: 'prp_cccccccccc',
  why: 'A second thought.',
  changes: [
    {
      block: 'b0-1',
      before: 'Tomas came at dusk.',
      after: 'Tomas came at noon.',
      occurrence: 0,
      copies: 1,
    },
  ],
}
async function openBoth() {
  state.all.value = [EDIT, SECOND]
  state.outOfDate.value = new Set()
  const closed = vi.fn()
  const w = mount(SuggestionDialog, {
    props: {
      target: {
        hits: [
          { id: EDIT.id, change: 0 },
          { id: SECOND.id, change: 0 },
        ],
        pos: 0,
      },
      onClose: closed,
    },
    attachTo: document.body,
  })
  mounted.push(w)
  await settle()
  return { w, closed }
}
const cardOf = (id: string) => body().querySelector(`[data-proposal="${id}"]`)!
const within = (id: string, name: string) =>
  [...cardOf(id).querySelectorAll('button')].find((b) => b.textContent?.trim() === name)
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
  it('shows what changes, with Accept, Edit, Dismiss and Ask for changes, and marks the paragraph clicked', async () => {
    await open(EDIT, 1)
    const dialog = body().querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Suggestion for “The quay”')
    expect(dialog.textContent).toContain('Dusk clashes with chapter 7.')
    expect(dialog.querySelectorAll('del, ins').length).toBeGreaterThan(0)
    for (const n of ['Accept', 'Edit', 'Dismiss', 'Ask for changes']) expect(button(n)).toBeTruthy()
    const marked = dialog.querySelectorAll('[data-focused]')
    expect(marked).toHaveLength(1)
    expect(marked[0]!.textContent).toContain('counted')
  })

  it('Accept accepts the suggestion as it is; Dismiss dismisses it', async () => {
    await open(EDIT)
    button('Accept')!.click()
    await settle()
    expect(state.accept).toHaveBeenCalledWith(EDIT, undefined)
    button('Dismiss')!.click()
    await settle()
    expect(state.reject).toHaveBeenCalledWith(EDIT)
  })

  it('Edit shows one text box per changed paragraph, and Accept my text hands over the author’s text', async () => {
    await open(EDIT)
    button('Edit')!.click()
    await settle()
    expect(boxes().map((b) => b.value)).toEqual([
      'Tomas came in the afternoon.',
      'The clerk counted twice.',
    ])
    expect(document.activeElement).toBe(boxes()[0])
    // Each box is named by the paragraph it is for.
    const label = (b: HTMLTextAreaElement) =>
      body().querySelector(`label[for="${b.id}"]`)?.textContent
    expect(boxes().map(label)).toEqual(['Your text, paragraph 1', 'Your text, paragraph 2'])
    await type(boxes()[0]!, 'Tomas came in the evening.')
    button('Accept my text')!.click()
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
    const accept = button('Accept my text')!
    expect(accept.disabled).toBe(true)
    // Why it cannot be accepted is said, and tied to the button.
    const why = document.getElementById(accept.getAttribute('aria-describedby')!)!
    expect(why.textContent?.trim()).toBe(
      "This can't be empty unless the suggestion deletes the paragraph.",
    )
    await type(boxes()[1]!, 'Fine.')
    expect(button('Accept my text')!.disabled).toBe(false)
    for (const w of mounted.splice(0)) w.unmount()
    await open(REMOVAL)
    button('Edit')!.click()
    await settle()
    await type(boxes()[0]!, '')
    expect(button('Accept my text')!.disabled).toBe(false)
  })

  it('an out-of-date suggestion says so and offers only Dismiss and Ask again', async () => {
    await open(EDIT, 0, true)
    expect(body().textContent).toContain('Out of date')
    expect(button('Accept')).toBeUndefined()
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

  it('with edited text, Escape asks first: Keep editing keeps it, Discard closes', async () => {
    const { closed } = await open(EDIT)
    button('Edit')!.click()
    await settle()
    await type(boxes()[0]!, 'Tomas came in the evening.')
    const esc = () =>
      body()
        .querySelector('[role="dialog"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    esc()
    await settle()
    expect(closed).not.toHaveBeenCalled()
    expect(body().querySelector('[role="alert"]')!.textContent).toContain(
      'Discard your edited text?',
    )
    expect(document.activeElement).toBe(button('Keep editing'))
    button('Keep editing')!.click()
    await settle()
    expect(boxes()[0]!.value).toBe('Tomas came in the evening.')
    esc()
    await settle()
    button('Discard')!.click()
    await settle()
    expect(closed).toHaveBeenCalled()
    expect(state.accept).not.toHaveBeenCalled()
  })

  it('a suggestion that goes while the author edits it stays open with their text, to copy', async () => {
    const { closed } = await open(EDIT)
    button('Edit')!.click()
    await settle()
    await type(boxes()[0]!, 'Tomas came in the evening.')
    state.all.value = [] // replaced by a revision, or cleared on another device
    await settle()
    expect(closed).not.toHaveBeenCalled()
    expect(boxes()[0]!.value).toBe('Tomas came in the evening.')
    expect(boxes()[0]!.readOnly).toBe(true)
    expect(body().textContent).toContain('This suggestion changed while you were editing it')
    expect(button('Accept my text')).toBeUndefined()
    button('Discard my text')!.click()
    await settle()
    expect(closed).toHaveBeenCalled()
  })

  it('an edited suggestion the author accepts closes as usual: nothing is held', async () => {
    const { closed } = await open(EDIT)
    button('Edit')!.click()
    await settle()
    await type(boxes()[0]!, 'Tomas came in the evening.')
    state.accept.mockImplementationOnce(async () => {
      state.all.value = []
    })
    button('Accept my text')!.click()
    await settle()
    expect(closed).toHaveBeenCalled()
  })

  it('closes itself once the suggestion is gone', async () => {
    const { closed } = await open(EDIT)
    state.all.value = []
    await settle()
    expect(closed).toHaveBeenCalled()
  })

  it('with several suggestions on one paragraph lists them one above the other, each with its own actions', async () => {
    await openBoth()
    const dialog = body().querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Suggestions for this paragraph')
    expect(dialog.textContent).toContain('Suggestion 1 of 2')
    expect(dialog.textContent).toContain('Suggestion 2 of 2')
    expect(dialog.querySelectorAll('[data-proposal]')).toHaveLength(2)
    expect(cardOf(EDIT.id).textContent).toContain('Dusk clashes')
    expect(cardOf(SECOND.id).textContent).toContain('A second thought.')
    for (const id of [EDIT.id, SECOND.id])
      for (const n of ['Accept', 'Edit', 'Dismiss', 'Ask for changes'])
        expect(within(id, n)).toBeTruthy()
  })

  it('accepting or dismissing one keeps the other, and the popup closes when none is left', async () => {
    const { closed } = await openBoth()
    within(EDIT.id, 'Accept')!.click()
    await settle()
    expect(state.accept).toHaveBeenCalledWith(EDIT, undefined)
    state.all.value = [SECOND] // the accepted one is gone
    await settle()
    expect(closed).not.toHaveBeenCalled()
    expect(body().querySelectorAll('[data-proposal]')).toHaveLength(1)
    expect(cardOf(SECOND.id)).toBeTruthy()
    within(SECOND.id, 'Dismiss')!.click()
    await settle()
    expect(state.reject).toHaveBeenCalledWith(SECOND)
    state.all.value = []
    await settle()
    expect(closed).toHaveBeenCalled()
  })

  it('shows the other suggestion as out of date once accepting one made it so', async () => {
    await openBoth()
    expect(within(SECOND.id, 'Accept')).toBeTruthy()
    state.outOfDate.value = new Set([SECOND.id])
    await settle()
    expect(cardOf(SECOND.id).textContent).toContain('Out of date')
    expect(within(SECOND.id, 'Accept')).toBeUndefined()
    expect(within(SECOND.id, 'Dismiss')).toBeTruthy()
    expect(within(SECOND.id, 'Ask again')).toBeTruthy()
  })

  it('closing asks first when either card has unsaved edits', async () => {
    for (const id of [EDIT.id, SECOND.id]) {
      const { closed, w } = await openBoth()
      within(id, 'Edit')!.click()
      await settle()
      await type(cardOf(id).querySelector('textarea')!, 'Something of mine.')
      body()
        .querySelector('[role="dialog"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await settle()
      expect(closed).not.toHaveBeenCalled()
      expect(body().querySelector('[role="alert"]')!.textContent).toContain(
        'Discard your edited text?',
      )
      button('Discard')!.click()
      await settle()
      expect(closed).toHaveBeenCalled()
      w.unmount()
      document.body.innerHTML = ''
    }
  })

  it('a card whose suggestion went keeps the author’s text while the other stays', async () => {
    const { closed } = await openBoth()
    within(SECOND.id, 'Edit')!.click()
    await settle()
    await type(cardOf(SECOND.id).querySelector('textarea')!, 'Mine.')
    state.all.value = [EDIT]
    await settle()
    expect(cardOf(SECOND.id).querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Mine.')
    expect(cardOf(EDIT.id)).toBeTruthy()
    expect(closed).not.toHaveBeenCalled()
  })
})
