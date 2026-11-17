// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { relationshipsOf } from './relationships'
import type { RecordDoc } from './workspace-data'

const id = (prefix: string, n: number) => `${prefix}_${String(n).padStart(10, '0')}`
const rec = (n: number, title: string, relationships?: { with: string; type: string }[]) =>
  ({
    universe: id('unv', 1),
    meta: {
      title,
      schemaVersion: 1,
      id: id('chr', n),
      type: 'character',
      scope: 'universe',
      ...(relationships ? { relationships } : {}),
    },
  }) as RecordDoc

describe('relationships are shown on both sides', () => {
  const elena = rec(1, 'Elena', [{ with: id('chr', 2), type: 'mentor' }])
  const mirela = rec(2, 'Mirela')
  const tomas = rec(3, 'Tomas', [{ with: id('chr', 1), type: 'creditor' }])
  const records = [elena, mirela, tomas]

  it('the record that lists it sees it as its own', () => {
    expect(relationshipsOf(records, elena.meta.id).filter((r) => r.side === 'own')).toEqual([
      {
        other: { id: mirela.meta.id, title: 'Mirela', type: 'character' },
        type: 'mentor',
        holder: elena.meta.id,
        index: 0,
        with: mirela.meta.id,
        side: 'own',
      },
    ])
  })

  it('the other end sees it too, and knows where it is written (so Edit and Remove write the right file)', () => {
    expect(relationshipsOf(records, mirela.meta.id)).toEqual([
      {
        other: { id: elena.meta.id, title: 'Elena', type: 'character' },
        type: 'mentor',
        holder: elena.meta.id,
        index: 0,
        with: mirela.meta.id,
        side: 'other',
      },
    ])
  })

  it('lists both what a record lists and what is listed about it, own first', () => {
    const rows = relationshipsOf(records, elena.meta.id)
    expect(rows.map((r) => [r.other.title, r.type, r.side])).toEqual([
      ['Mirela', 'mentor', 'own'],
      ['Tomas', 'creditor', 'other'],
    ])
  })

  it('keeps two relationships to one record apart, each at its own place in the list', () => {
    const twice = rec(4, 'Corin', [
      { with: id('chr', 2), type: 'brother' },
      { with: id('chr', 2), type: 'rival' },
    ])
    const rows = relationshipsOf([...records, twice], mirela.meta.id)
    expect(rows.map((r) => [r.type, r.index])).toEqual([
      ['mentor', 0],
      ['brother', 0],
      ['rival', 1],
    ])
  })

  it('leaves out a relationship with a record that is no longer there', () => {
    const lonely = rec(5, 'Wren', [{ with: id('chr', 99), type: 'friend' }])
    expect(relationshipsOf([...records, lonely], lonely.meta.id)).toEqual([])
  })
})
