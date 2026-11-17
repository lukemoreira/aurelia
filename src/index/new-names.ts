// SPDX-License-Identifier: AGPL-3.0-or-later
// Find new names (ADR-0010 §5): capitalised words that recur in the writing and are not a record
// yet. A pure function of the texts, the names already known and the author's answers; nothing is
// written into a text, and nothing is created without a click.
import type { Range } from './links'
import { startsSentence } from './names'

/** A word is offered when it stands this many times, away from the start of a sentence. */
export const MIN_TIMES = 3

export interface NewName {
  word: string
  count: number
  /** Where it stands, in reading order: the first is "first in …". */
  places: { id: string; title: string; count: number }[]
}

export interface NameText {
  id: string
  title: string
  body: string
  /** Where no name is looked for: names already found, links, code, addresses. */
  skip: Range[]
}

/** Capitalised words that are not names however often they stand: days, months, how people are addressed. */
const NOT_NAMES = new Set(
  'monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december mr mrs ms miss dr sir madam god'.split(
    ' ',
  ),
)

const WORD = /[\p{L}\p{M}\p{N}]+/gu
/** Starts with a capital and has a small letter after it: not an acronym, not a lone "I". */
const CAPITALISED = /^\p{Lu}[\p{L}\p{M}]*\p{Ll}/u

/** "Mr. Brandt": the full stop ends an abbreviation, not a sentence. */
const AFTER_HONORIFIC = /\b(?:Mr|Mrs|Ms|Dr|St|Prof)\.\s*$/

const inside = (zones: Range[], at: number) => zones.some(([a, b]) => a <= at && at < b)

/**
 * The recurring capitalised words of `texts`, most often first. `known` is every word of every name
 * a record already goes by (folded to lower case): such a word is a name already. `dismissed` is
 * what the author said is not a name.
 */
export function findNewNames(
  texts: NameText[],
  known: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
  fold: (s: string) => string,
): NewName[] {
  const found = new Map<string, NewName>()
  for (const text of texts) {
    for (const token of text.body.matchAll(WORD)) {
      const word = token[0]
      if (!CAPITALISED.test(word) || dismissed.has(word)) continue
      const folded = fold(word)
      if (known.has(folded) || NOT_NAMES.has(folded)) continue
      if (inside(text.skip, token.index)) continue
      if (
        startsSentence(text.body, token.index) &&
        !AFTER_HONORIFIC.test(text.body.slice(Math.max(0, token.index - 8), token.index))
      )
        continue
      const name = found.get(word) ?? { word, count: 0, places: [] }
      found.set(word, name)
      name.count++
      const here = name.places.at(-1)
      if (here?.id === text.id) here.count++
      else name.places.push({ id: text.id, title: text.title, count: 1 })
    }
  }
  return [...found.values()]
    .filter((n) => n.count >= MIN_TIMES)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
}
