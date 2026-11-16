// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { countWords, readableParagraphs } from './prose'

describe('readableParagraphs', () => {
  it('splits on blank lines, shows link names and drops Markdown’s marks', () => {
    expect(
      readableParagraphs(
        'She met [[id:chr_8f3k2m9q1x|Tomas]] and [[Elena Vasquez|Elena]], a **bold** and *quiet* pair.\n\nThe [[Lantern Gate]] closed. ^blk-a1b2c3',
      ),
    ).toEqual(['She met Tomas and Elena, a bold and quiet pair.', 'The Lantern Gate closed.'])
  })

  it('a scene break is one mark, and nothing is HTML', () => {
    expect(readableParagraphs('One.\n\n* * *\n\nTwo <u>under</u> <script>x</script>.')).toEqual([
      'One.',
      '⁂',
      'Two under <script>x</script>.', // shown as text, never run
    ])
    expect(readableParagraphs('')).toEqual([])
  })

  it('leaves a lone star and an escaped one alone', () => {
    expect(readableParagraphs('a * b and 2 * 3 and \\*literal\\*')).toEqual([
      'a * b and 2 * 3 and *literal*',
    ])
  })
})

describe('countWords', () => {
  it('counts words across paragraphs and ignores scene breaks', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('One two  three\n\nfour')).toBe(4)
    expect(countWords('Before.\n\n* * *\n\nAfter it.')).toBe(3)
    expect(countWords('Before.\n\n---\n\nAfter.')).toBe(2)
    expect(countWords('[[id:chr_x|Elena]] waited — then left.')).toBe(5)
  })

  it('does not count what Markdown puts in front of a line', () => {
    expect(countWords('# Chapter heading')).toBe(2)
    expect(countWords('- one\n- two words\n1. three\n- [x] four')).toBe(5)
    expect(countWords('> quoted words here')).toBe(3)
    expect(countWords('> [!note] Heads up\n> The warden knows.')).toBe(5)
  })

  it('does not count emphasis marks or table rules, and counts the word inside them', () => {
    expect(countWords('a **bold** and *italic* and <u>under</u> word')).toBe(7)
    expect(countWords('a * b')).toBe(2)
    expect(countWords('| a | b |\n| - | - |\n| 1 | 2 |')).toBe(4)
  })
})
