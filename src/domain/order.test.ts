// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { freshKeys, keyAfter, keyBetween } from './order'

describe('keyAfter', () => {
  it('starts at "a" and always sorts after the key it follows', () => {
    expect(keyAfter()).toBe('a')
    let key = 'a'
    for (let i = 0; i < 200; i++) {
      const next = keyAfter(key)
      expect(next > key, `${next} after ${key}`).toBe(true)
      expect(next).toMatch(/^[0-9A-Za-z]+$/)
      key = next
    }
  })

  it('steps through digits, capitals and lowercase, and grows when it runs out', () => {
    expect(keyAfter('a3')).toBe('a4')
    expect(keyAfter('a9')).toBe('aA')
    expect(keyAfter('aZ')).toBe('aa')
    expect(keyAfter('z')).toBe('za')
  })
})

describe('keyBetween', () => {
  it('finds a key between two neighbours, before the first and after the last', () => {
    expect(keyBetween('a', 'c')! > 'a' && keyBetween('a', 'c')! < 'c').toBe(true)
    expect(keyBetween(undefined, 'a')! < 'a').toBe(true)
    expect(keyBetween('a')! > 'a').toBe(true)
    expect(keyBetween()).toMatch(/^[0-9A-Za-z]+$/)
  })

  it('always fits between neighbours, however many times a gap is split (random moves)', () => {
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const keys = ['a', 'b', 'c']
    for (let i = 0; i < 2000; i++) {
      const at = Math.floor(random() * (keys.length + 1)) // insert at any position
      const key = keyBetween(keys[at - 1], keys[at])!
      expect(key).toMatch(/^[0-9A-Za-z]+$/)
      expect(
        keys[at - 1] === undefined || keys[at - 1]! < key,
        `${key} after ${keys[at - 1]}`,
      ).toBe(true)
      expect(keys[at] === undefined || key < keys[at]!, `${key} before ${keys[at]}`).toBe(true)
      keys.splice(at, 0, key)
    }
    expect(keys).toEqual([...keys].sort())
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('does not run out of room next to a key that is already at the first symbol', () => {
    expect(keyBetween(undefined, '1')! < '1').toBe(true)
    expect(keyBetween('a0', 'a1')! > 'a0' && keyBetween('a0', 'a1')! < 'a1').toBe(true)
  })

  it('says there is no room, rather than a key in the wrong place', () => {
    expect(keyBetween('a', 'a')).toBeUndefined() // two siblings share a key
    expect(keyBetween(undefined, '0')).toBeUndefined() // nothing sorts before "0"
    expect(keyBetween('b', 'a')).toBeUndefined()
  })

  it('freshKeys are increasing and start at "a"', () => {
    const keys = freshKeys(70)
    expect(keys[0]).toBe('a')
    expect(keys).toEqual([...keys].sort())
    expect(new Set(keys).size).toBe(70)
  })
})
