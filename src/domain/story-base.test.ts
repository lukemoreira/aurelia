// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { mergeBase, proposalSchema } from './proposals'
import { bookSchema } from './schema/book'
import { BASE_SECTIONS, baseOf, sameName } from './story-base'

const EMPTY = {
  genre: '',
  subject: '',
  audience: '',
  volumes: '',
  intentions: '',
  objectives: '',
  world: '',
  narrative: '',
  notes: '',
}

describe('the story base', () => {
  it('reads from book.json; a base written by hand into something else is left out, never a reason to refuse the book', () => {
    const book = {
      title: 'B',
      schemaVersion: 1,
      id: 'bok_abcdefghjk',
      mode: 'linear',
    }
    expect(baseOf(bookSchema.parse({ ...book, storyBase: { world: 'A port.' } }))).toEqual({
      ...EMPTY,
      world: 'A port.',
    })
    expect(baseOf(bookSchema.parse({ ...book, storyBase: 'just words' }))).toEqual(EMPTY)
    expect(bookSchema.parse({ ...book, storyBase: { world: 'x', later: 1 } }).storyBase).toEqual({
      world: 'x',
      later: 1,
    }) // a key a later version adds is kept
    // One section that is not text does not take the others away, and is itself kept.
    const odd = bookSchema.parse({
      ...book,
      storyBase: { objectives: 'Long text', world: { draft: 'x' } },
    })
    // A section that is not text reads as its JSON: a suggestion over it counts as replacing it.
    expect(baseOf(odd)).toEqual({ ...EMPTY, objectives: 'Long text', world: '{"draft":"x"}' })
    expect(odd.storyBase).toEqual({ objectives: 'Long text', world: { draft: 'x' } })
    // An empty value is not written yet, not the word "null".
    expect(baseOf(bookSchema.parse({ ...book, storyBase: { world: null } }))).toEqual(EMPTY)
  })

  it('reads the new sections, and an old book with only the three first keys reads as before', () => {
    const book = { title: 'B', schemaVersion: 1, id: 'bok_abcdefghjk', mode: 'linear' }
    const read = baseOf(
      bookSchema.parse({
        ...book,
        storyBase: {
          genre: 'Military history',
          subject: 'WWII naval warfare',
          volumes: '3, maybe 4',
          notes: 'Check dates',
          later: 1,
        },
      }),
    )
    expect(read).toEqual({
      ...EMPTY,
      genre: 'Military history',
      subject: 'WWII naval warfare',
      volumes: '3, maybe 4', // text, never parsed to a number
      notes: 'Check dates',
    })
    expect(read).not.toHaveProperty('later') // an unknown key is kept in the file, not in the read
    expect(
      baseOf(bookSchema.parse({ ...book, storyBase: { world: 'W', narrative: 'N' } })),
    ).toEqual({
      ...EMPTY,
      world: 'W',
      narrative: 'N',
    })
  })

  it('lists the sections in order, with the one-line ones flagged short', () => {
    expect(BASE_SECTIONS.map((s) => s.key)).toEqual([
      'genre',
      'subject',
      'audience',
      'volumes',
      'intentions',
      'objectives',
      'world',
      'narrative',
      'notes',
    ])
    expect(BASE_SECTIONS.filter((s) => s.short).map((s) => s.key)).toEqual([
      'genre',
      'subject',
      'audience',
      'volumes',
    ])
  })

  it('a name is the same whatever its case and spaces', () => {
    expect(sameName(' Tomas  Brandt', 'tomas brandt')).toBe(true)
    expect(sameName('Tomas', 'Tomasz')).toBe(false)
  })
})

describe('mergeBase', () => {
  it('changes only the sections it names, and says when it replaces the author’s text', () => {
    expect(
      mergeBase({ ...EMPTY, narrative: 'Mine.' }, { objectives: { before: '', after: 'A.' } }),
    ).toEqual({ ok: true, base: { objectives: 'A.' }, replaced: false }) // only what it changes
    expect(
      mergeBase({ ...EMPTY, world: 'Old.' }, { world: { before: 'Old.', after: 'New.' } }),
    ).toMatchObject({ ok: true, replaced: true })
  })

  it('refuses the whole proposal when any section changed since, or was accepted already', () => {
    const sections = {
      objectives: { before: '', after: 'A.' },
      world: { before: '', after: 'W.' },
    }
    expect(mergeBase({ ...EMPTY, world: 'Typed.' }, sections)).toEqual({ ok: false })
    expect(mergeBase({ ...EMPTY, objectives: 'A.', world: 'W.' }, sections)).toEqual({ ok: false })
  })
})

describe('the proposal kinds', () => {
  it('a story-base proposal for a new section is read and merged', () => {
    const sections = { genre: { before: '', after: 'Fantasy' }, notes: { before: '', after: 'N' } }
    const p = proposalSchema.parse({
      schemaVersion: 1,
      id: 'prp_abcdefghjk',
      createdAt: '2026-11-18T00:00:00Z',
      by: 'Claude',
      why: 'w',
      kind: 'base',
      bookId: 'bok_abcdefghjk',
      bookTitle: 'B',
      sections,
    })
    expect(p.kind === 'base' && p.sections).toEqual(sections)
    expect(mergeBase(EMPTY, sections)).toEqual({
      ok: true,
      base: { genre: 'Fantasy', notes: 'N' },
      replaced: false,
    })
  })

  const common = {
    schemaVersion: 1,
    id: 'prp_abcdefghjk',
    createdAt: '2026-11-18T00:00:00Z',
    by: 'Claude',
    why: 'w',
  }
  it('read a base and a character, and refuse a character detail the sheet does not have', () => {
    expect(
      proposalSchema.safeParse({
        ...common,
        kind: 'base',
        bookId: 'bok_abcdefghjk',
        bookTitle: 'B',
        sections: { world: { before: '', after: 'W' } },
      }).success,
    ).toBe(true)
    // A section of any length the author wrote is read: a proposal that replaces it is not hidden.
    expect(
      proposalSchema.safeParse({
        ...common,
        kind: 'base',
        bookId: 'bok_abcdefghjk',
        bookTitle: 'B',
        sections: { world: { before: 'w'.repeat(25_000), after: 'W' } },
      }).success,
    ).toBe(true)
    const character = { ...common, kind: 'character', bookId: 'bok_abcdefghjk', name: 'T' }
    expect(proposalSchema.safeParse({ ...character, fields: { role: 'Hero' } }).success).toBe(true)
    // Unknown detail keys are stripped, never written into a record.
    const parsed = proposalSchema.parse({ ...character, fields: { role: 'Hero', scope: 'x' } })
    expect(parsed.kind === 'character' && parsed.fields).toEqual({ role: 'Hero' })
    expect(proposalSchema.safeParse({ ...character, name: '', fields: {} }).success).toBe(false)
  })
})
