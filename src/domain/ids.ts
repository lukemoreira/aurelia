// SPDX-License-Identifier: AGPL-3.0-or-later

export const ID_PREFIXES = [
  'wsp',
  'unv',
  'bok',
  'prt',
  'chp',
  'scn',
  'chr',
  'plc',
  'itm',
  'evt',
  'arc',
  'lor',
  'res',
  'nte',
  'fac',
  'cul',
  'sys',
  'wld',
  'stp',
  'chc',
  'cal',
  'med',
  'blk',
] as const

export type IdPrefix = (typeof ID_PREFIXES)[number]
export type Id<P extends IdPrefix = IdPrefix> = `${P}_${string}`

// 32 symbols, so one random byte maps evenly (byte & 31). Reading accepts any [a-z0-9].
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const ID_LENGTH = 10
const ID_PATTERN = new RegExp(`^(${ID_PREFIXES.join('|')})_[a-z0-9]{${ID_LENGTH}}$`)

export function newId<P extends IdPrefix>(prefix: P): Id<P> {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH))
  return `${prefix}_${Array.from(bytes, (b) => ALPHABET[b & 31]).join('')}`
}

export function isId<P extends IdPrefix = IdPrefix>(value: unknown, prefix?: P): value is Id<P> {
  const match = typeof value === 'string' ? ID_PATTERN.exec(value) : null
  return match !== null && (prefix === undefined || match[1] === prefix)
}
