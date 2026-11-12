// SPDX-License-Identifier: AGPL-3.0-or-later
import { ID_PREFIXES, type Id, type IdPrefix } from '@/domain/ids'

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

function hash32(text: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  h ^= h >>> 15
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  return h >>> 0
}

/**
 * A valid ID that is the same on every load. The sample is rebuilt on each page load, and
 * a random `newId` would change every link, route and saved selection with it.
 */
export function sampleId<P extends IdPrefix>(prefix: P, key: string): Id<P> {
  if (!ID_PREFIXES.includes(prefix)) throw new Error(`Unknown prefix ${prefix}`)
  const a = hash32(key, 2166136261)
  const b = hash32(key, 0x9e3779b9)
  let out = ''
  for (let i = 0; i < 6; i++) out += ALPHABET[(a >>> (i * 5)) & 31]
  for (let i = 0; i < 4; i++) out += ALPHABET[(b >>> (i * 5)) & 31]
  return `${prefix}_${out}`
}
