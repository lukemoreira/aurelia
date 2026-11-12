// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { ID_PREFIXES, isId, newId } from './ids'

describe('newId', () => {
  it('is the prefix, an underscore and 10 lowercase base-32 characters', () => {
    expect(newId('chr')).toMatch(/^chr_[0-9a-hjkmnp-tv-z]{10}$/)
  })

  it('makes a valid id for every prefix', () => {
    for (const prefix of ID_PREFIXES) expect(isId(newId(prefix), prefix)).toBe(true)
  })

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId('scn')))
    expect(ids.size).toBe(1000)
  })
})

describe('isId', () => {
  it('accepts the ids used in the ADRs', () => {
    expect(isId('chr_8f3k2m9q1x')).toBe(true)
    expect(isId('chc_5g2h8j3k1l', 'chc')).toBe(true)
  })

  it('checks the prefix when one is given', () => {
    expect(isId('chr_8f3k2m9q1x', 'plc')).toBe(false)
  })

  it('rejects wrong shapes', () => {
    for (const bad of [
      '',
      'chr_',
      'chr_SHORT',
      'xyz_8f3k2m9q1x',
      'chr_8f3k2m9q1xx',
      'chr-8f3k2m9q1x',
      42,
      null,
    ])
      expect(isId(bad)).toBe(false)
  })
})
