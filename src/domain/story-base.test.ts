// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { mergeBase, proposalSchema } from './proposals'
import { bookSchema } from './schema/book'
import { baseOf, sameName } from './story-base'

const EMPTY = { objectives: '', world: '', narrative: '' }

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
