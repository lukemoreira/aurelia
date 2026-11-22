// SPDX-License-Identifier: AGPL-3.0-or-later
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editorExtensions } from './extensions'
import { bodyToDoc } from './markdown/body'
import {
  caretNear,
  createSuggestions,
  findChip,
  setSuggestions,
  type InTextSuggestion,
} from './suggestions'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

const BODY =
  'Tomas came down to the quay at dusk.\n\nThe clerk counted the crates.\n\nThe clerk counted the crates.'
function start(items: InTextSuggestion[], body = BODY) {
  const open = vi.fn()
  editor = new Editor({
    extensions: [...editorExtensions, createSuggestions(open)],
    content: bodyToDoc(body),
  })
  setSuggestions(editor.view, items)
  return { open, dom: editor.view.dom as HTMLElement }
}
const anchor = (change: number, before: string, occurrence = 0, copies = 1) => ({
  change,
  before,
  occurrence,
  copies,
})

describe('suggestions in the text', () => {
  it('frames each changed paragraph and puts one labelled button on each frame, not a card', () => {
    const { dom, open } = start([
      {
        id: 'prp_aaaaaaaaaa',
        outOfDate: false,
        anchors: [
          anchor(0, 'Tomas came down to the quay at dusk.'),
          anchor(2, 'Nothing like this'),
        ],
      },
    ])
    expect(dom.querySelectorAll('.suggestion-target')).toHaveLength(1)
    expect(dom.querySelector('.suggestion-card')).toBeNull()
    const chips = dom.querySelectorAll<HTMLButtonElement>('button.suggestion-chip')
    expect(chips).toHaveLength(1)
    expect(chips[0]!.getAttribute('aria-label')).toBe(
      'Show the suggestion for this paragraph: “Tomas came down to the quay…”',
    )
    expect(chips[0]!.textContent).toBe('Suggestion')
    // Inside the framed paragraph, out of the text's way: nothing is put between the paragraphs.
    expect(dom.children[0]!.classList.contains('suggestion-target')).toBe(true)
    expect(dom.children[0]!.querySelector('.suggestion-chip-anchor button')).toBe(chips[0])
    expect([...dom.children].map((c) => c.tagName)).toEqual(['P', 'P', 'P'])
    chips[0]!.click()
    expect(open).toHaveBeenCalledWith([{ id: 'prp_aaaaaaaaaa', change: 0 }], 0)
  })

  it('gives every framed paragraph its own button, all naming the same suggestion and their own change', () => {
    const { dom, open } = start([
      {
        id: 'prp_aaaaaaaaaa',
        outOfDate: false,
        anchors: [
          anchor(0, 'Tomas came down to the quay at dusk.'),
          anchor(1, 'The clerk counted the crates.', 0, 2),
          anchor(2, 'The clerk counted the crates.', 1, 2),
        ],
      },
    ])
    expect(dom.querySelectorAll('.suggestion-target')).toHaveLength(3)
    const chips = [...dom.querySelectorAll<HTMLButtonElement>('button.suggestion-chip')]
    expect(chips).toHaveLength(3)
    chips[2]!.click()
    expect(open).toHaveBeenLastCalledWith([{ id: 'prp_aaaaaaaaaa', change: 2 }], expect.any(Number))
    // One Tab stop per suggestion: its first button; the others are still buttons, clickable.
    expect(chips.map((c) => c.tabIndex)).toEqual([0, -1, -1])
    // Every paragraph is still a paragraph next to a paragraph (`p + p`: the indent and the spacing).
    expect([...dom.children].map((c) => c.tagName)).toEqual(['P', 'P', 'P'])
  })

  it('does not frame a paragraph that no longer reads as the suggestion saw it (or whose twins changed in number)', () => {
    const { dom } = start([
      {
        id: 'prp_aaaaaaaaaa',
        outOfDate: false,
        // Two of these were there when it was suggested; now there are two still, but it saw three.
        anchors: [
          anchor(0, 'The clerk counted the crates.', 0, 3),
          anchor(1, 'Tomas came down to the quay at night.'),
        ],
      },
    ])
    expect(dom.querySelectorAll('.suggestion-target')).toHaveLength(0)
    // Nothing to frame: one button at the end of the scene, so it can still be dismissed.
    const chips = dom.querySelectorAll<HTMLButtonElement>('button.suggestion-chip')
    expect(chips).toHaveLength(1)
    expect(chips[0]!.getAttribute('aria-label')).toBe('Show the suggestion for this scene')
    expect(dom.lastElementChild!.classList.contains('suggestion-chip-row')).toBe(true)
  })

  it('draws an out-of-date suggestion quietly and says so on its button', () => {
    const { dom } = start([
      {
        id: 'prp_cccccccccc',
        outOfDate: true,
        anchors: [anchor(0, 'Tomas came down to the quay at dusk.')],
      },
    ])
    expect(dom.querySelector('.suggestion-target')!.classList.contains('is-stale')).toBe(true)
    const chip = dom.querySelector<HTMLButtonElement>('button.suggestion-chip')!
    expect(chip.classList.contains('is-stale')).toBe(true)
    expect(chip.textContent).toBe('Suggestion · out of date')
    expect(chip.getAttribute('aria-label')).toMatch(/^Suggestion · out of date/)
  })

  it('never touches the text', () => {
    const { dom } = start([
      {
        id: 'prp_aaaaaaaaaa',
        outOfDate: false,
        anchors: [anchor(0, 'Tomas came down to the quay at dusk.')],
      },
    ])
    expect(dom.querySelectorAll('p')).toHaveLength(3)
    expect(dom.textContent).toContain('Tomas came down to the quay at dusk.')
    expect(editor!.getText()).not.toContain('Suggestion')
  })

  it('leaves typing and the caret as they are: text typed at either end of a framed paragraph goes into it', () => {
    start([
      {
        id: 'prp_aaaaaaaaaa',
        outOfDate: false,
        anchors: [anchor(0, 'Tomas came down to the quay at dusk.')],
      },
    ])
    const first = editor!.state.doc.firstChild!
    editor!.chain().setTextSelection(1).insertContent('Then ').run()
    editor!
      .chain()
      .setTextSelection(first.nodeSize + 4)
      .insertContent(' Late.')
      .run()
    expect(editor!.state.doc.firstChild!.textContent).toBe(
      'Then Tomas came down to the quay at dusk. Late.',
    )
    // The typed words are text of the paragraph; the button stays drawn before them, not in them.
    const p = editor!.view.dom.firstElementChild!
    expect(p.firstElementChild!.classList.contains('suggestion-chip-anchor')).toBe(true)
    expect(p.textContent).toBe('SuggestionThen Tomas came down to the quay at dusk. Late.')
  })

  it('puts ONE button on a paragraph two suggestions change, reading the count, and opens both', () => {
    const { dom, open } = start([
      {
        id: 'prp_aaaaaaaaaa',
        outOfDate: false,
        anchors: [anchor(0, 'Tomas came down to the quay at dusk.')],
      },
      {
        id: 'prp_bbbbbbbbbb',
        outOfDate: false,
        anchors: [anchor(3, 'Tomas came down to the quay at dusk.')],
      },
    ])
    expect(dom.querySelectorAll('.suggestion-target')).toHaveLength(1)
    const chips = dom.querySelectorAll<HTMLButtonElement>('button.suggestion-chip')
    expect(chips).toHaveLength(1)
    expect(chips[0]!.textContent).toBe('2 suggestions')
    expect(chips[0]!.getAttribute('aria-label')).toBe(
      'Show 2 suggestions for this paragraph: “Tomas came down to the quay…”',
    )
    chips[0]!.click()
    expect(open).toHaveBeenCalledWith(
      [
        { id: 'prp_aaaaaaaaaa', change: 0 },
        { id: 'prp_bbbbbbbbbb', change: 3 },
      ],
      0,
    )
  })

  it('says "out of date" on a shared button only when every suggestion on it is', () => {
    const both = (a: boolean, b: boolean) =>
      start([
        {
          id: 'prp_aaaaaaaaaa',
          outOfDate: a,
          anchors: [anchor(0, 'Tomas came down to the quay at dusk.')],
        },
        {
          id: 'prp_bbbbbbbbbb',
          outOfDate: b,
          anchors: [anchor(0, 'Tomas came down to the quay at dusk.')],
        },
      ]).dom.querySelector<HTMLButtonElement>('button.suggestion-chip')!
    const stale = both(true, true)
    expect(stale.textContent).toBe('2 suggestions · out of date')
    expect(stale.getAttribute('aria-label')).toMatch(/^2 suggestions · out of date/)
    expect(stale.classList.contains('is-stale')).toBe(true)
    editor!.destroy()
    const some = both(true, false)
    expect(some.textContent).toBe('2 suggestions')
    expect(some.classList.contains('is-stale')).toBe(false)
  })

  it('makes a shared button a Tab stop only when it is some suggestion’s first framed paragraph', () => {
    const { dom } = start([
      {
        id: 'prp_aaaaaaaaaa',
        outOfDate: false,
        anchors: [
          anchor(0, 'Tomas came down to the quay at dusk.'),
          anchor(1, 'The clerk counted the crates.', 0, 2),
        ],
      },
      {
        id: 'prp_bbbbbbbbbb',
        outOfDate: false,
        anchors: [anchor(0, 'The clerk counted the crates.', 0, 2)],
      },
    ])
    const chips = [...dom.querySelectorAll<HTMLButtonElement>('button.suggestion-chip')]
    // Paragraph 1: A's first. Paragraph 2: A's second, but B's first. Every suggestion has one Tab stop.
    expect(chips.map((c) => c.textContent)).toEqual(['Suggestion', '2 suggestions'])
    expect(chips.map((c) => c.tabIndex)).toEqual([0, 0])
    editor!.destroy()
    const { dom: d2 } = start([
      {
        id: 'prp_aaaaaaaaaa',
        outOfDate: false,
        anchors: [
          anchor(0, 'Tomas came down to the quay at dusk.'),
          anchor(1, 'The clerk counted the crates.', 0, 2),
        ],
      },
      {
        id: 'prp_bbbbbbbbbb',
        outOfDate: false,
        anchors: [
          anchor(0, 'Tomas came down to the quay at dusk.'),
          anchor(1, 'The clerk counted the crates.', 0, 2),
        ],
      },
    ])
    const c2 = [...d2.querySelectorAll<HTMLButtonElement>('button.suggestion-chip')]
    expect(c2.map((c) => c.tabIndex)).toEqual([0, -1])
  })

  it('puts the scene-end suggestions on one button with their count', () => {
    const { dom, open } = start([
      { id: 'prp_aaaaaaaaaa', outOfDate: false, anchors: [anchor(0, 'Gone one')] },
      { id: 'prp_bbbbbbbbbb', outOfDate: false, anchors: [anchor(0, 'Gone two')] },
    ])
    const chips = dom.querySelectorAll<HTMLButtonElement>('.suggestion-chip-row button')
    expect(chips).toHaveLength(1)
    expect(chips[0]!.textContent).toBe('2 suggestions')
    expect(chips[0]!.getAttribute('aria-label')).toBe('Show 2 suggestions for this scene')
    expect(chips[0]!.tabIndex).toBe(0)
    chips[0]!.click()
    expect(open).toHaveBeenCalledWith(
      [
        { id: 'prp_aaaaaaaaaa', change: 0 },
        { id: 'prp_bbbbbbbbbb', change: 0 },
      ],
      null,
    )
  })

  it("the scene-end button is told apart from a paragraph's change 0, so the caret goes back to the right one", () => {
    const { dom } = start([
      { id: 'prp_aaaaaaaaaa', outOfDate: false, anchors: [anchor(0, 'Gone one')] },
      {
        id: 'prp_bbbbbbbbbb',
        outOfDate: false,
        anchors: [anchor(0, 'Tomas came down to the quay at dusk.')],
      },
    ])
    const end = dom.querySelector<HTMLElement>('.suggestion-chip-row button')!
    expect(end.dataset.hits).toBe('prp_aaaaaaaaaa:end')
    // The scene's own target finds the scene's button; a paragraph's target for the same id does not.
    expect(findChip(dom, { hits: [{ id: 'prp_aaaaaaaaaa', change: 0 }], pos: null })).toBe(end)
    expect(findChip(dom, { hits: [{ id: 'prp_aaaaaaaaaa', change: 0 }], pos: 0 })).toBeUndefined()
    const para = dom.querySelector<HTMLElement>('.suggestion-chip-anchor button')!
    expect(findChip(dom, { hits: [{ id: 'prp_bbbbbbbbbb', change: 0 }], pos: 0 })).toBe(para)
  })

  it('puts the button of a table or a list just before the block, outside anything that clips', () => {
    const body = 'Intro.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- one\n- two\n'
    const { dom } = start(
      [
        {
          id: 'prp_aaaaaaaaaa',
          outOfDate: false,
          anchors: [anchor(0, '| a | b |\n| - | - |\n| 1 | 2 |'), anchor(1, '- one\n- two')],
        },
      ],
      body,
    )
    const anchors = [...dom.querySelectorAll('.suggestion-chip-anchor')]
    expect(anchors).toHaveLength(2)
    for (const a of anchors) expect(a.parentElement).toBe(dom)
  })

  it('finds a place for the caret near any block, text or not', () => {
    start([], 'Intro.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- one\n- two\n\n***\n')
    const doc = editor!.state.doc
    doc.forEach((node, offset) => {
      expect(caretNear(doc, offset).$from.parent.inlineContent, node.type.name).toBe(true)
    })
    expect(caretNear(doc, null).from).toBeLessThanOrEqual(doc.content.size)
  })
})
