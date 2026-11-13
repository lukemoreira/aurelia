// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { keyAfter } from './order'

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
