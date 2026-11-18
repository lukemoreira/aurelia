// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import type { Proposal } from '@/domain/proposals'
import { outOfDateWords } from './proposal-view'

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
