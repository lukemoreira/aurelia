// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { diffWords } from '@/domain/word-diff'
import WordDiff from './WordDiff.vue'

/** What a sighted reader sees: the text without the words only a screen reader hears. */
function seen(w: ReturnType<typeof mount>) {
  const copy = w.element.cloneNode(true) as HTMLElement
  copy.querySelectorAll('.sr-only').forEach((e) => e.remove())
  return copy.textContent
}

describe('WordDiff', () => {
  it('marks removed and added words in words for a screen reader, not by colour alone', () => {
    const w = mount(WordDiff, {
      props: { parts: diffWords('She ran to the gate.', 'She walked to the gate.') },
    })
    expect(w.find('del').text()).toBe('[Removed: ran]')
    expect(w.find('ins').text()).toBe('[Added: walked]')
    expect(w.find('del').classes()).toContain('line-through') // a mark that is not a colour
    expect(w.find('ins').classes()).toContain('underline')
    expect(w.find('del .sr-only').exists()).toBe(true)
    expect(w.text()).toBe('She [Removed: ran] [Added: walked] to the gate.')
  })

  it('shows every word once and the spaces as they are: no stray or doubled spaces', () => {
    const w = mount(WordDiff, {
      props: { parts: diffWords('One two three.\n\nFour five.', 'One 2 three.\n\nFour five six.') },
    })
    expect(seen(w)).toBe('One two 2 three.\n\nFour five. five six.')
  })

  it('shows unchanged text plainly', () => {
    const w = mount(WordDiff, { props: { parts: diffWords('Same.', 'Same.') } })
    expect(w.find('del, ins').exists()).toBe(false)
    expect(w.text()).toBe('Same.')
  })

  it('a change in spacing alone is marked, never invisible: a line break, a paragraph split, a hard break', () => {
    const joined = mount(WordDiff, { props: { parts: diffWords('a\nb', 'a b') } })
    expect(joined.find('del').text()).toBe('↵[Removed: line break]')
    expect(joined.find('ins').text()).toBe('·[Added: space]')
    expect(seen(joined)).toBe('a↵· b')
    const split = mount(WordDiff, { props: { parts: diffWords('A B', 'A\n\nB') } })
    expect(split.find('ins').text()).toBe('↵↵[Added: line break]')
    expect(seen(split)).toBe('A·↵↵\n\nB') // the new break itself follows its mark
    const hard = mount(WordDiff, { props: { parts: diffWords('a  \nb', 'a\nb') } })
    expect(hard.find('del').text()).toBe('··↵[Removed: line break]')
    expect(hard.find('ins').text()).toBe('↵[Added: line break]')
  })
})
