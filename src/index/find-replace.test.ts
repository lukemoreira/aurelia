// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { findPattern, keepCase, planReplace, skippedWords, type FindOptions } from './find-replace'
import { applyPlaces } from './rename'

const OFF: FindOptions = { matchCase: false, wholeWords: false }
const doc = (body: string, id = 'scn_a') => ({ id, where: `1.1 · ${id}`, body })
/** The text after every place is replaced. */
const replaced = (body: string, find: string, to: string, o = OFF) =>
  applyPlaces(body, planReplace([doc(body)], find, to, o).plan.places)

describe('find and replace: finding', () => {
  it('finds nothing for an empty or blank search', () => {
    expect(findPattern('', OFF)).toBeUndefined()
    expect(findPattern('  ', OFF)).toBeUndefined()
    expect(planReplace([doc('a b')], ' ', 'x', OFF).plan.places).toEqual([])
  })

  it('reads what is typed as plain text, never a pattern', () => {
    expect(replaced('a.b axb (c)', 'a.b', 'z')).toBe('z axb (c)')
    expect(replaced('a.b axb (c)', '(c)', 'd')).toBe('a.b axb d')
  })

  it('ignores case unless Match case is on', () => {
    expect(replaced('Lamp lamp LAMP', 'lamp', 'torch')).toBe('Torch torch TORCH')
    expect(replaced('Lamp lamp LAMP', 'lamp', 'torch', { ...OFF, matchCase: true })).toBe(
      'Lamp torch LAMP',
    )
  })

  it('finds a match at the very start and the very end, and every repeated one', () => {
    expect(replaced('cat and cat', 'cat', 'dog')).toBe('dog and dog')
    expect(replaced('catcatcat', 'cat', 'dog')).toBe('dogdogdog')
    expect(replaced('aaaa', 'aa', 'b')).toBe('bb')
  })

  it('whole words only: a Unicode letter is part of the word', () => {
    const o = { ...OFF, wholeWords: true }
    expect(replaced('cat cats scat cat’s cat.', 'cat', 'dog', o)).toBe('dog cats scat dog’s dog.')
    expect(replaced('café caféine écafé', 'café', 'bar', o)).toBe('bar caféine écafé')
    expect(replaced('Straße Straßen', 'Straße', 'Weg', o)).toBe('Weg Straßen')
    expect(replaced('Åsa Åsaby', 'åsa', 'Eva', o)).toBe('Eva Åsaby')
    // A combining accent after the letter makes it another word.
    expect(replaced('café cafe', 'cafe', 'bar', o)).toBe('café bar')
  })

  it('never changes anything inside a link, its target or its text, and counts what it left', () => {
    const body = 'Elena met [[Elena Vasquez|Elena]] and [[id:chr_x|Elena]]. Elena left.'
    const { plan, skipped } = planReplace([doc(body)], 'Elena', 'Helena', OFF)
    expect(applyPlaces(body, plan.places)).toBe(
      'Helena met [[Elena Vasquez|Elena]] and [[id:chr_x|Elena]]. Helena left.',
    )
    expect(skipped.link).toBe(3)
    expect(skippedWords(skipped)).toBe('3 inside links, not changed.')
  })

  it('leaves code, raw HTML, link definitions, addresses and note labels as written', () => {
    const body = [
      'The lamp is `lamp` here.',
      '',
      '```',
      'lamp',
      '```',
      '',
      '<div>lamp</div>',
      '',
      'See https://lamp.example.com and <span title="lamp">x</span>.',
      '',
      '[lamp]: https://example.com',
    ].join('\n')
    const { plan, skipped } = planReplace([doc(body)], 'lamp', 'torch', OFF)
    expect(plan.places.map((p) => p.before + p.old)).toEqual(['The lamp'])
    expect(skipped).toEqual({ link: 0, code: 5, other: 1 })
  })

  it('writes what Markdown would read escaped, so the text shows what was typed', () => {
    expect(replaced('a star', 'star', '*star*')).toBe('a \\*star\\*')
  })

  it('a match that would read the same is not a place', () => {
    expect(planReplace([doc('Elena')], 'elena', 'elena', OFF).plan.places).toEqual([])
  })

  it('lists places in reading order, by scene, with the words around each and the text it was found in', () => {
    const { plan } = planReplace(
      [doc('One lamp.', 'scn_a'), doc('No match.', 'scn_b'), doc('Two lamp lamp.', 'scn_c')],
      'lamp',
      'torch',
      OFF,
      'bok_1',
    )
    expect(plan.places.map((p) => [p.docId, p.start, p.before, p.after])).toEqual([
      ['scn_a', 4, 'One ', '.'],
      ['scn_c', 4, 'Two ', ' lamp.'],
      ['scn_c', 9, 'Two lamp ', '.'],
    ])
    expect(plan.places.every((p) => p.kind === 'scene' && p.bookId === 'bok_1')).toBe(true)
    expect([...plan.bodies.keys()]).toEqual(['scn_a', 'scn_c'])
  })
})

describe('find and replace: keeping the case shape', () => {
  it('keeps ALL CAPS, a capital first letter, and otherwise writes it as typed', () => {
    expect(keepCase('LAMP', 'torch')).toBe('TORCH')
    expect(keepCase('Lamp', 'torch')).toBe('Torch')
    expect(keepCase('lamp', 'Torch')).toBe('Torch')
    expect(keepCase('lamp', 'torch')).toBe('torch')
    expect(keepCase('lAMP', 'torch')).toBe('torch')
    expect(keepCase('Élan', 'émoi')).toBe('Émoi')
    expect(keepCase('ÅSA', 'eva')).toBe('EVA')
    // One capital letter is a capital first letter, not shouting.
    expect(keepCase('I', 'we')).toBe('We')
    // Leading punctuation does not hide the first letter.
    expect(keepCase('“Lamp', '“torch')).toBe('“Torch')
  })
})
