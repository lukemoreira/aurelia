// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { fixture, id } from '../../tests/helpers/index-fixture'
import { MIN_TIMES } from './new-names'
import { fold } from './palette-search'
import { WorkspaceIndex } from './workspace-index'

const indexOf = (data: ReturnType<typeof fixture>) => {
  const index = new WorkspaceIndex()
  index.sync(data)
  return index
}
const book1 = id('bok', 1)
const words = (index: WorkspaceIndex, book = book1) => index.newNames(book).map((n) => n.word)

describe('find new names (ADR-0010 §5)', () => {
  it('offers a capitalised word that recurs, with how often and where it stands first', () => {
    const index = indexOf(
      fixture([
        {
          n: 1,
          title: 'The Bridge',
          body: 'They crossed to Greywater at dusk. Then Greywater slept.',
        },
        { n: 2, title: 'The Bells', body: 'The bells of Greywater rang out.' },
      ]),
    )
    expect(index.newNames(book1)).toEqual([
      {
        word: 'Greywater',
        count: 3,
        places: [
          { id: id('scn', 1), title: 'The Bridge', count: 2 },
          { id: id('scn', 2), title: 'The Bells', count: 1 },
        ],
      },
    ])
  })

  it(`needs ${MIN_TIMES} times, not one or two`, () => {
    const index = indexOf(
      fixture([{ n: 1, body: 'They went to Greywater. They left Greywater behind.' }]),
    )
    expect(words(index)).toEqual([])
  })

  it('does not count a word at the start of a sentence, a line or a quote: it is capitalised anyway', () => {
    const index = indexOf(
      fixture([
        {
          n: 1,
          body: 'Greywater is far. Greywater was old.\n\nGreywater again. “Greywater?” she said.',
        },
      ]),
    )
    expect(words(index)).toEqual([])
  })

  it('counts a word after an abbreviation’s full stop ("Mr. Brandt" is a name, not a sentence start)', () => {
    const index = indexOf(
      fixture([{ n: 1, body: 'She met Mr. Brandt. Later Mr. Brandt left. Then Mr. Brandt wept.' }]),
    )
    expect(words(index)).toEqual(['Brandt'])
  })

  it('leaves out a word that is a record already, by its title, an alias, or any word of a longer name', () => {
    const index = indexOf(
      fixture(
        [
          {
            n: 1,
            body: 'Walk with Elena, Lena, Vasquez, Greywater, Greywater, Greywater, and Corin x3: Corin Corin Corin.',
          },
        ],
        [
          { n: 1, title: 'Elena Vasquez', aliases: [{ text: 'Lena' }] },
          { n: 2, type: 'place', title: 'Greywater' },
        ],
      ),
    )
    expect(words(index)).toEqual(['Corin'])
  })

  it('does not look inside links, web and email addresses or code', () => {
    const index = indexOf(
      fixture([
        {
          n: 1,
          body: 'See [[Greywater]] and [[Greywater]] and [[Greywater]]; and https://Greywater.example/Greywater, mail Greywater@x.org, `Greywater`.',
        },
      ]),
    )
    expect(words(index)).toEqual([])
  })

  it('is not fooled by days, months, acronyms or a lone I', () => {
    const index = indexOf(
      fixture([
        {
          n: 1,
          body: 'on Monday and on Monday and on Monday; in March in March in March; the NASA NASA NASA; so I I I.',
        },
      ]),
    )
    expect(words(index)).toEqual([])
  })

  it('reads only the open book’s scenes', () => {
    const data = fixture([
      { n: 1, body: 'x Ashcombe y Ashcombe.' },
      { n: 2, book: 2, body: 'x Ashcombe y Ashcombe.' },
    ])
    const index = indexOf(data)
    // four times in all, but two in each book: neither book offers it
    expect(words(index, book1)).toEqual([])
    expect(words(index, id('bok', 2))).toEqual([])
  })

  it('sorts the most frequent first, then by word', () => {
    const index = indexOf(
      fixture([{ n: 1, body: 'a Zed b Zed c Zed d Abel e Abel f Abel g Abel' }]),
    )
    expect(words(index)).toEqual(['Abel', 'Zed'])
  })

  it('leaves out what the book says is not a name, and nothing else', () => {
    const data = fixture([
      { n: 1, body: 'a Greywater b Greywater c Greywater d Ashcombe e Ashcombe f Ashcombe' },
    ])
    data.books[0] = { ...data.books[0]!, notNames: ['Greywater'] }
    expect(words(indexOf(data))).toEqual(['Ashcombe'])
  })

  it('once a record has the word, the word is a name and leaves the list', () => {
    const body = 'a Greywater b Greywater c Greywater'
    expect(words(indexOf(fixture([{ n: 1, body }])))).toEqual(['Greywater'])
    expect(
      words(indexOf(fixture([{ n: 1, body }], [{ n: 1, type: 'place', title: 'Greywater' }]))),
    ).toEqual([])
  })

  it('folds accents and capitals when asking whether a word is known', () => {
    expect(fold('Éowyn')).toBe(fold('eowyn'))
    const index = indexOf(
      fixture([{ n: 1, body: 'a Éowyn b Éowyn c Éowyn' }], [{ n: 1, title: 'Eowyn' }]),
    )
    expect(words(index)).toEqual([])
  })
})
