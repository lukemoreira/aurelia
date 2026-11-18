// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import type { Proposal } from '@/domain/proposals'
import type { Backlink } from '@/index/types'
import { deleteWords, outOfDateWords, targetOf } from './proposal-view'

const common = {
  schemaVersion: 1 as const,
  id: 'prp_abcdefghjk',
  createdAt: '2026-11-18T00:00:00Z',
  by: 'Claude',
  why: 'w',
}

describe('why a suggestion is out of date', () => {
  it('says a character’s name is taken, and a text that changed for the others', () => {
    const character: Proposal = {
      ...common,
      kind: 'character',
      bookId: 'bok_abcdefghjk',
      name: 'Tomas',
      fields: {},
    }
    expect(outOfDateWords(character)).toContain(
      'a character with this name is already in this world',
    )
    const base: Proposal = {
      ...common,
      kind: 'base',
      bookId: 'bok_abcdefghjk',
      bookTitle: 'B',
      sections: { world: { before: '', after: 'W' } },
    }
    expect(outOfDateWords(base)).toContain('the text changed after this was suggested')
  })
})

describe('a suggested record delete', () => {
  const del: Proposal = {
    ...common,
    kind: 'delete-record',
    recordId: 'chr_abcdefghjk',
    recordType: 'character',
    title: 'Archie Collins',
    fingerprint: '0123abcd',
  }
  const from = (kind: 'scene' | 'record', links: number) =>
    ({ from: { kind, id: 'x', title: 'X' }, links, names: 0 }) as unknown as Backlink

  it('says plainly what goes, where to, and what links to it', () => {
    expect(targetOf(del)).toBe('Delete character: “Archie Collins”')
    expect(outOfDateWords(del)).toContain('this record was changed or deleted')
    expect(deleteWords([])).toBe(
      'Accept moves it to Recently deleted, where you can bring it back.',
    )
    expect(deleteWords([from('scene', 2)])).toContain('1 scene links to it')
    expect(
      deleteWords([from('scene', 1), from('scene', 1), from('record', 1), from('scene', 0)]),
    ).toContain('2 scenes and 1 record link to it or name it')
    // A tagged name counts as much as a link; a world of several books says it leaves them all.
    expect(deleteWords([{ ...from('scene', 0), names: 2 }])).toContain(
      '1 scene links to it or names it',
    )
    expect(deleteWords([], 1)).not.toContain('books')
    expect(deleteWords([], 3)).toContain('It is in the world of 3 books, so it leaves all of them.')
  })
})
