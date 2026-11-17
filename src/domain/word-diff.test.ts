// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { diffCounts, diffInfo, diffWords, type DiffPart } from './word-diff'

/** The text of the pieces that are not of this kind: dropping the added ones leaves `before`. */
const without = (parts: DiffPart[], drop: DiffPart['kind']) =>
  parts
    .filter((p) => p.kind !== drop)
    .map((p) => p.text)
    .join('')

const words = (s: string) => s.match(/\S+/g) ?? []

/** Length of the longest common run of words, the slow and certain way. */
function lcs(a: string[], b: string[]) {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      t[i]![j] =
        a[i - 1] === b[j - 1] ? t[i - 1]![j - 1]! + 1 : Math.max(t[i - 1]![j]!, t[i]![j - 1]!)
  return t[a.length]![b.length]!
}

describe('diffWords', () => {
  it('marks what was removed and what was added, word by word', () => {
    expect(diffWords('The bells had started.', 'The bells had already started.')).toEqual([
      { kind: 'same', text: 'The bells had' },
      { kind: 'added', text: ' already' },
      { kind: 'same', text: ' started.' },
    ])
    expect(diffWords('She ran to the gate.', 'She walked to the gate.')).toEqual([
      { kind: 'same', text: 'She' },
      { kind: 'removed', text: ' ran' },
      { kind: 'added', text: ' walked' },
      { kind: 'same', text: ' to the gate.' },
    ])
  })

  it('a changed phrase is one piece, not split at the spaces between its words', () => {
    const parts = diffWords(
      'The bells had already started.',
      'The bells started. Elena ran to the gate.',
    )
    expect(parts).toEqual([
      { kind: 'same', text: 'The bells' },
      { kind: 'removed', text: ' had already' },
      { kind: 'same', text: ' started.' },
      { kind: 'added', text: ' Elena ran to the gate.' },
    ])
  })

  it('says nothing changed when nothing did, and handles an empty side', () => {
    expect(diffWords('same words', 'same words')).toEqual([{ kind: 'same', text: 'same words' }])
    expect(diffWords('', '')).toEqual([])
    expect(diffWords('', 'new')).toEqual([{ kind: 'added', text: 'new' }])
    expect(diffWords('old', '')).toEqual([{ kind: 'removed', text: 'old' }])
  })

  it('shows a changed paragraph break, and a changed end of text', () => {
    const parts = diffWords('One.\n\nTwo.', 'One. Two.\n')
    expect(parts.some((p) => p.kind !== 'same')).toBe(true)
    expect(without(parts, 'added')).toBe('One.\n\nTwo.')
    expect(without(parts, 'removed')).toBe('One. Two.\n')
  })

  it('counts words, not spaces', () => {
    expect(diffCounts(diffWords('a b c', 'a x y c'))).toEqual({ added: 2, removed: 1 })
    expect(diffCounts(diffWords('a\nb', 'a b'))).toEqual({ added: 0, removed: 0 })
  })

  it('over the edit limit, still reads back as both texts (coarser, never wrong)', () => {
    const before = Array.from({ length: 50 }, (_, i) => `a${i}`).join(' ')
    const after = Array.from({ length: 50 }, (_, i) => `b${i}`).join(' ')
    const parts = diffWords(before, after, 5)
    expect(without(parts, 'added')).toBe(before)
    expect(without(parts, 'removed')).toBe(after)
  })

  it('says when the counts are only about: past the edit limit, never for an exact diff', () => {
    const before = Array.from({ length: 50 }, (_, i) => `a${i}`).join(' ')
    const after = Array.from({ length: 50 }, (_, i) => `b${i}`).join(' ')
    expect(diffInfo(before, after, 5).rough).toBe(true)
    expect(diffInfo(before, after).rough).toBe(false)
    expect(diffInfo('same', 'same').rough).toBe(false)
  })

  it('a book-length scene with a few edits is quick', () => {
    const base = Array.from({ length: 40_000 }, (_, i) => `w${i % 997}`)
    const edited = base.slice()
    for (let i = 100; i < 40_000; i += 4000) edited[i] = 'EDIT'
    const start = performance.now()
    const parts = diffWords(base.join(' '), edited.join(' '))
    expect(performance.now() - start).toBeLessThan(1000)
    expect(diffCounts(parts)).toEqual({ added: 10, removed: 10 })
  })

  it('fuzz: both texts read back exactly, and the words in common are as many as the longest common run', () => {
    let seed = 7
    const rand = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n
    const vocab = ['the', 'bell', 'rang', 'Elena', 'gate', 'a', 'and', '\n\n', 'dusk', 'he', ' ']
    const text = () =>
      Array.from({ length: rand(24) }, () => vocab[rand(vocab.length)]!).join(rand(5) ? ' ' : '  ')
    for (let i = 0; i < 500; i++) {
      const [a, b] = [text(), text()]
      const parts = diffWords(a, b)
      expect(without(parts, 'added')).toBe(a)
      expect(without(parts, 'removed')).toBe(b)
      parts.slice(1).forEach((p, j) => expect(p.kind).not.toBe(parts[j]!.kind)) // never two neighbours of one kind
      const same = parts
        .filter((p) => p.kind === 'same')
        .reduce((n, p) => n + words(p.text).length, 0)
      expect(same).toBe(lcs(words(a), words(b)))
    }
  })
})
