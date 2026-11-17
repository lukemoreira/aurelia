// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { fixture, id } from '../../tests/helpers/index-fixture'
import { appearances } from './appearances'
import { WorkspaceIndex } from './workspace-index'

const ELENA = { n: 1, title: 'Elena Vasquez', aliases: [{ text: 'Elena' }] }
const books = [
  { id: id('bok', 1), title: 'Book 1' },
  { id: id('bok', 2), title: 'Book 2' },
]
const indexOf = (data: ReturnType<typeof fixture>) => {
  const index = new WorkspaceIndex()
  index.sync(data)
  return index
}

describe('a shared record across the books of one universe', () => {
  const data = fixture(
    [
      { n: 1, title: 'The Gate', body: 'Elena came to the gate. [[Elena Vasquez]] waited.' },
      { n: 2, title: 'The Quay', body: 'Elena sat. No one else.' },
      { n: 3, title: 'The Return', book: 2, body: 'Elena came back to Saltmarch.' },
      { n: 4, title: 'Elsewhere', book: 2, body: 'Nothing here.' },
    ],
    [ELENA],
  )
  const index = indexOf(data)

  it('is in the backlinks and the appearances of both books, each scene once, with how often', () => {
    const groups = appearances(index.backlinks(id('chr', 1)), books)
    expect(
      groups.map((g) => [g.book.title, g.scenes.map((s) => [s.target.title, s.count]), g.count]),
    ).toEqual([
      [
        'Book 1',
        [
          ['The Gate', 2], // the name and the link
          ['The Quay', 1],
        ],
        3,
      ],
      ['Book 2', [['The Return', 1]], 1],
    ])
  })

  it('leaves out records that name it (only scenes are appearances) and books without it', () => {
    const withNote = fixture(
      [{ n: 1, body: 'x' }],
      [
        ELENA,
        { n: 2, type: 'item', title: 'Letter', scope: 1, body: 'Held by [[Elena Vasquez]].' },
      ],
    )
    expect(appearances(indexOf(withNote).backlinks(id('chr', 1)), books)).toEqual([])
  })

  it('orders books as the universe lists them, whatever order the backlinks came in', () => {
    const reversed = [books[1]!, books[0]!]
    expect(appearances(index.backlinks(id('chr', 1)), reversed).map((g) => g.book.title)).toEqual([
      'Book 2',
      'Book 1',
    ])
  })
})

describe('search finds what a sheet says', () => {
  const data = fixture(
    [{ n: 1, body: 'x' }],
    [
      ELENA,
      { n: 2, type: 'research', title: 'Tidal ports' },
      { n: 3, type: 'place', title: 'Greywater' },
    ],
  )
  const [elena, research, place] = data.records
  elena!.meta = {
    ...elena!.meta,
    fear: 'Deep water, and the colour amber',
    relationships: [{ with: id('nte', 2), type: 'apprentice of the harbour-mistress' }],
  }
  research!.meta = {
    ...research!.meta,
    sources: [
      { title: 'The Ledger of Tides', author: 'Corvin Hale', url: 'https://example.org/ledger' },
    ],
  }
  place!.meta = { ...place!.meta, smell: 'Tar and wet rope', sight: 'Grey light on a long quay' }
  const index = indexOf(data)
  const hits = (q: string) => index.search(q).map((h) => h.id)

  it('a character’s inner life and relationships', () => {
    expect(hits('amber')).toContain(id('chr', 1))
    expect(hits('harbour-mistress')).toContain(id('chr', 1))
  })

  it('a research note’s sources: title, author and address', () => {
    expect(hits('Ledger of Tides')).toContain(id('nte', 2))
    expect(hits('Corvin')).toContain(id('nte', 2))
    expect(hits('example.org')).toContain(id('nte', 2))
  })

  it('a place’s sensory details', () => {
    expect(hits('wet rope')).toContain(id('plc', 3))
    expect(hits('long quay')).toContain(id('plc', 3))
  })

  it('and finds nothing for words that are not there', () => {
    expect(hits('zeppelin')).toEqual([])
  })
})
