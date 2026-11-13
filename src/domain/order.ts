// SPDX-License-Identifier: AGPL-3.0-or-later

// Digits < capitals < lowercase is also the order `<` gives, which is how the outline sorts keys.
const SYMBOLS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** An order key that sorts after `last` ("a" → "b", "z" → "za"). The first key is "a". */
export function keyAfter(last?: string): string {
  if (!last) return 'a'
  const next = SYMBOLS.indexOf(last.at(-1) ?? '') + 1
  return next > 0 && next < SYMBOLS.length ? last.slice(0, -1) + SYMBOLS[next] : `${last}a`
}
