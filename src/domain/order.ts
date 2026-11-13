// SPDX-License-Identifier: AGPL-3.0-or-later

// Digits < capitals < lowercase is also the order `<` gives, which is how the outline sorts keys.
const SYMBOLS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = SYMBOLS.length

/** An order key that sorts after `last` ("a" → "b", "z" → "za"). The first key is "a". */
export function keyAfter(last?: string): string {
  if (!last) return 'a'
  const next = SYMBOLS.indexOf(last.at(-1) ?? '') + 1
  return next > 0 && next < SYMBOLS.length ? last.slice(0, -1) + SYMBOLS[next] : `${last}a`
}

/**
 * An order key strictly between `before` and `after` (either may be missing: the start or the end
 * of the list), so a move rewrites only the moved file. Keys are fractions read digit by digit in
 * `SYMBOLS` order; a key never ends in the first symbol, which is what always leaves room.
 */
export function keyBetween(before?: string, after?: string): string | undefined {
  const key = between(before ?? '', after)
  // No room (two siblings share a key, or nothing sorts before "0"): undefined, and the caller
  // gives the siblings fresh keys. A key is never returned that sorts anywhere but between.
  return key > (before ?? '') && (after === undefined || key < after) ? key : undefined
}

/** `n` increasing keys, the first one "a": fresh keys for a whole list of siblings. */
export function freshKeys(n: number): string[] {
  const keys: string[] = []
  for (let i = 0; i < n; i++) keys.push(keyAfter(keys.at(-1)))
  return keys
}

function between(a: string, b: string | undefined): string {
  if (b !== undefined) {
    let n = 0
    while ((a[n] ?? SYMBOLS[0]) === b[n]) n++ // the shared start, with `a` padded by zeros
    if (n > 0) return b.slice(0, n) + between(a.slice(n), b.slice(n))
  }
  const low = a ? SYMBOLS.indexOf(a[0]!) : 0
  const high = b === undefined ? BASE : SYMBOLS.indexOf(b[0]!)
  if (high - low > 1) return SYMBOLS[Math.round((low + high) / 2)]!
  if (b !== undefined && b.length > 1) return b.slice(0, 1) // `a` is just below this digit
  return SYMBOLS[low]! + between(a.slice(1), undefined)
}
