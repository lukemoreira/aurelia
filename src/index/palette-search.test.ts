// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { fold, rankByTitle } from './palette-search'

const titles = ['The Warden’s Price', 'Tomas Brandt', 'Tomas’s ledger', 'Élodie', 'Curfew Bells']
const items = titles.map((title) => ({ title }))

describe('palette search', () => {
  it('folds case, accents and apostrophes', () => {
    expect(fold('Élodie')).toBe('elodie')
    expect(fold('Warden’s')).toBe('wardens')
  })

  it('folds runs of white space, so a double space or a tab does not hide a title', () => {
    expect(fold('  The   Warden’s\tPrice ')).toBe('the wardens price')
    expect(rankByTitle([{ title: 'The  Warden’s   Price' }], 'wardens  price')).toHaveLength(1)
  })

  it('finds titles that contain the query, ignoring case and accents', () => {
    expect(rankByTitle(items, 'ELODIE').map((i) => i.title)).toEqual(['Élodie'])
    expect(rankByTitle(items, 'wardens').map((i) => i.title)).toEqual(['The Warden’s Price'])
  })

  it('puts titles that start with the query before those that merely contain it', () => {
    expect(rankByTitle(items, 'to').map((i) => i.title)).toEqual(['Tomas Brandt', 'Tomas’s ledger'])
    expect(rankByTitle(items, 'e').map((i) => i.title)).toEqual([
      'Élodie',
      'The Warden’s Price',
      'Tomas’s ledger',
      'Curfew Bells',
    ])
  })

  it('returns nothing for an empty or unmatched query', () => {
    expect(rankByTitle(items, '  ')).toEqual([])
    expect(rankByTitle(items, 'zzz')).toEqual([])
  })
})
