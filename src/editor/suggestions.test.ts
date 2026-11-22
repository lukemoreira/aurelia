// SPDX-License-Identifier: AGPL-3.0-or-later
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editorExtensions } from './extensions'
import { bodyToDoc } from './markdown/body'
import { createSuggestions, setSuggestions, type InTextSuggestion } from './suggestions'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

const BODY =
  'Tomas came down to the quay at dusk.\n\nThe clerk counted the crates.\n\nThe clerk counted the crates.'
function start(items: InTextSuggestion[]) {
  const open = vi.fn()
  editor = new Editor({
    extensions: [...editorExtensions, createSuggestions(open)],
    content: bodyToDoc(BODY),
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
  it('frames each changed paragraph and puts one labelled button after each, not a card', () => {
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
    // Right after the framed paragraph.
    expect(dom.children[0]!.classList.contains('suggestion-target')).toBe(true)
    expect(dom.children[1]!.classList.contains('suggestion-chip-row')).toBe(true)
    chips[0]!.click()
    expect(open).toHaveBeenCalledWith('prp_aaaaaaaaaa', 0)
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
    expect(open).toHaveBeenLastCalledWith('prp_aaaaaaaaaa', 2)
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
    expect(chip.textContent).toBe('Out of date')
    expect(chip.getAttribute('aria-label')).toContain('out-of-date suggestion')
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
  })
})
