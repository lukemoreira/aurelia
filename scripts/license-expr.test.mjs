// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { isAllowedExpression } from './license-expr.mjs'

const allowed = [/^MIT$/, /^ISC$/, /^Apache-2\.0$/]
const ok = (expr) => isAllowedExpression(expr, allowed)

describe('isAllowedExpression', () => {
  it('accepts a single allowed licence and refuses one that is not', () => {
    expect(ok('MIT')).toBe(true)
    expect(ok('GPL-2.0-only')).toBe(false)
  })

  it('needs either side of OR', () => {
    expect(ok('MIT OR GPL-2.0-only')).toBe(true)
    expect(ok('GPL-2.0-only OR MIT')).toBe(true)
    expect(ok('GPL-2.0-only OR SSPL-1.0')).toBe(false)
  })

  it('needs both sides of AND', () => {
    expect(ok('MIT AND ISC')).toBe(true)
    expect(ok('MIT AND GPL-2.0-only')).toBe(false)
    expect(ok('GPL-2.0-only AND MIT')).toBe(false)
  })

  it('does not fail open for (A OR B) AND C', () => {
    expect(ok('(MIT OR ISC) AND SSPL-1.0')).toBe(false)
    expect(ok('(MIT OR SSPL-1.0) AND ISC')).toBe(true)
    expect(ok('(SSPL-1.0 OR GPL-2.0-only) AND MIT')).toBe(false)
  })

  it('binds AND tighter than OR', () => {
    expect(ok('MIT OR GPL-2.0-only AND SSPL-1.0')).toBe(true)
    expect(ok('GPL-2.0-only AND SSPL-1.0 OR ISC')).toBe(true)
    expect(ok('GPL-2.0-only AND MIT OR SSPL-1.0')).toBe(false)
  })

  it('handles nesting and spacing', () => {
    expect(ok('  ((MIT))  ')).toBe(true)
    expect(ok('(MIT AND (ISC OR GPL-2.0-only))')).toBe(true)
    expect(ok('(MIT AND (SSPL-1.0 OR GPL-2.0-only))')).toBe(false)
  })

  it('refuses shapes it does not know instead of guessing', () => {
    for (const bad of [
      '',
      'MIT AND',
      'OR MIT',
      'MIT OR OR ISC',
      '(MIT',
      'MIT)',
      'MIT ISC',
      'Apache-2.0 WITH LLVM-exception',
      '()',
    ])
      expect(() => ok(bad), bad).toThrow('Cannot read licence expression')
    expect(() => ok(undefined)).toThrow()
  })

  it('reads the right side of AND even when the left already failed', () => {
    expect(() => ok('GPL-2.0-only AND (')).toThrow()
  })
})
