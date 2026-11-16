// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardView } from '@/editor/link-env'
import type { Target } from '@/index/workspace-index'
import { useWorkspaceStore } from '@/stores/workspace'
import { fixture } from '../../../tests/helpers/index-fixture'
import LinkCard from './LinkCard.vue'

const will: Target = {
  kind: 'record',
  id: 'chr_0000000002',
  title: 'Will Ashby',
  label: 'Character',
  recordType: 'character',
  summary: 'A cousin of the warden.',
  tone: 'ember',
}
const place: Target = {
  ...will,
  id: 'plc_0000000004',
  title: 'Corin',
  label: 'Place',
  tone: 'moss',
}

const card = (over: Partial<CardView> = {}): CardView => ({
  rect: new DOMRect(40, 100, 80, 20),
  kind: 'ask',
  text: 'Will',
  targets: [will],
  status: 'ok',
  reason: 'sentence-start',
  writable: true,
  open: vi.fn(),
  pick: (q) => (q ? [place] : []).map((p) => ({ ...p, byId: false })),
  returnFocus: vi.fn(),
  accept: vi.fn(),
  notAName: vi.fn(),
  ...over,
})

beforeEach(() => {
  setActivePinia(createPinia())
  useWorkspaceStore().load(fixture([{ n: 1, body: 'x' }]))
})
afterEach(() => (document.body.innerHTML = ''))

const show = (c: CardView) => {
  mount(LinkCard, { props: { card: c }, attachTo: document.body })
  return document.body.querySelector('aside')!
}
const button = (root: Element, text: RegExp) =>
  [...root.querySelectorAll('button')].find((b) => text.test(b.textContent ?? ''))

describe('the card on a name Aurelia asks about', () => {
  it('asks who it is, says why, and offers the answers', () => {
    const c = card()
    const root = show(c)
    expect(root.getAttribute('aria-label')).toBe('Preview of Will Ashby')
    expect(root.textContent).toContain('Is this Will Ashby?')
    expect(root.textContent).toContain('also an ordinary word at the start of a sentence')
    button(root, /Yes — Will Ashby/)!.click()
    expect(c.accept).toHaveBeenCalledWith(will)
    button(root, /Not a name/)!.click()
    expect(c.notAName).toHaveBeenCalled()
  })

  it('asks which one when two share the name, one button each, with what each is', () => {
    const c = card({ text: 'Corin', targets: [will, place], reason: 'shared' })
    const root = show(c)
    expect(root.textContent).toContain('Which one is “Corin”?')
    expect(button(root, /Yes — Corin\s*· Place/)).toBeTruthy()
    button(root, /Yes — Corin\s*· Place/)!.click()
    expect(c.accept).toHaveBeenCalledWith(place)
  })

  it('only asks, without answers, where the text cannot be changed', () => {
    const root = show(card({ writable: false }))
    expect(root.textContent).toContain('only asks')
    expect(root.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('the card on a link', () => {
  it('shows what it points at and opens it', () => {
    const c = card({ kind: 'link', reason: undefined, text: 'Will' })
    const root = show(c)
    expect(root.textContent).toContain('Will Ashby')
    expect(root.textContent).toContain('A cousin of the warden.')
    button(root, /Open/)!.click()
    expect(c.open).toHaveBeenCalledWith(will)
  })

  it('says so when it points nowhere, with nothing to open', () => {
    const root = show(
      card({ kind: 'link', reason: undefined, text: 'Nobody', targets: [], status: 'missing' }),
    )
    expect(root.textContent).toContain('Nothing is called “Nobody”')
    expect(root.querySelectorAll('button')).toHaveLength(0)
  })

  it('lists each thing when more than one has the name', () => {
    const root = show(
      card({
        kind: 'link',
        reason: undefined,
        text: 'Corin',
        targets: [will, place],
        status: 'ambiguous',
      }),
    )
    expect(root.textContent).toContain('More than one thing is called “Corin”')
    expect([...root.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Open character “Will Ashby”',
      'Open place “Corin”',
    ])
  })

  it('keeps the pointer’s hold: entering the card holds it, leaving lets it go, and Escape closes it', async () => {
    const w = mount(LinkCard, {
      props: { card: card({ kind: 'link', reason: undefined }) },
      attachTo: document.body,
    })
    const root = document.body.querySelector('aside')!
    root.dispatchEvent(new MouseEvent('mouseenter'))
    root.dispatchEvent(new MouseEvent('mouseleave'))
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(w.emitted()).toMatchObject({ hold: [[]], leave: [[]], close: [[]] })
  })

  it('moves the keyboard into the first button, and says whether there was one', () => {
    const w = mount(LinkCard, { props: { card: card() }, attachTo: document.body })
    expect((w.vm as unknown as { focus(): boolean }).focus()).toBe(true)
    expect(document.activeElement?.textContent).toContain('Yes — Will Ashby')
    w.unmount()
    const none = mount(LinkCard, {
      props: { card: card({ kind: 'link', reason: undefined, targets: [], status: 'missing' }) },
      attachTo: document.body,
    })
    expect((none.vm as unknown as { focus(): boolean }).focus()).toBe(false)
  })

  it('Escape gives the keyboard back to the text this card is about', () => {
    const c = card({ kind: 'link', reason: undefined })
    mount(LinkCard, { props: { card: c }, attachTo: document.body })
    document.body
      .querySelector('aside')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(c.returnFocus).toHaveBeenCalled()
  })

  it('offers "Someone or somewhere else…": find a record, and that one is the answer', async () => {
    const c = card()
    const w = mount(LinkCard, { props: { card: c }, attachTo: document.body })
    button(document.body, /Someone or somewhere else/)!.click()
    await w.vm.$nextTick()
    const input = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Find a record or scene"]',
    )!
    input.value = 'co'
    input.dispatchEvent(new Event('input'))
    await w.vm.$nextTick()
    button(document.body, /Corin\s*· Place/)!.click()
    expect(c.accept).toHaveBeenCalledWith(expect.objectContaining({ id: place.id }))
  })

  it('says what a screen reader needs, on the scene’s status line, not in the card', async () => {
    const { cardAnnouncement } = await import('./card-words')
    const keys = { answer: 'Alt Down', open: 'Ctrl Enter' }
    expect(cardAnnouncement(card(), keys)).toBe(
      'Is this Will Ashby? “Will” is also an ordinary word at the start of a sentence, so Aurelia asks. Press Alt Down to answer.',
    )
    expect(cardAnnouncement(card({ writable: false }), keys)).not.toContain('Press')
    expect(cardAnnouncement(card({ kind: 'link', reason: undefined }), keys)).toBe(
      'Will Ashby, character. A cousin of the warden. Press Ctrl Enter to open it.',
    )
    expect(cardAnnouncement(null, keys)).toBe('')
  })
})
