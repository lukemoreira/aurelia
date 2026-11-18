// SPDX-License-Identifier: AGPL-3.0-or-later
// Names found in a text (ADR-0010). A pure function of the text, the names and the author's
// answers, so every device and any other tool get the same result from the same files.
import type { MatchMode } from '@/domain/schema/record'
import { codeRanges, type LinkRef, type Range } from './links'

/** A name a record goes by: its title, or one of its aliases. */
export interface NameForm {
  recordId: string
  text: string
  mode: MatchMode
  /** A short form taken from a character's title, not typed by the author. */
  derived?: true
}

interface Owner {
  recordId: string
  mode: MatchMode
}
interface Candidate {
  text: string
  owners: Owner[]
}

/** Every name of a scope, looked up by the first word of each. */
export interface NameMatcher {
  byWord: Map<string, Candidate[]>
  size: number
}

/** Letters with their accents, and digits. An underscore is not one: `_Elena_` is Elena in italics. */
const WORD = /[\p{L}\p{M}\p{N}]/u
const LEADING_WORD = /^[\p{L}\p{M}\p{N}]+/u

/** Names that are also ordinary words: at the start of a sentence the author is asked ("Will you…"). */
const COMMON_WORDS = new Set(
  'will mark grace rose hope may bill art faith joy pat rob ray sue dawn summer autumn june april frank jack bob rich bell wren sage ash brook lane drew chase miles page grant rush young little long white black brown green grey gray hill wood stone'.split(
    ' ',
  ),
)

/** A name that is also an ordinary word ("Will", "Rose"). */
export const isCommonWord = (text: string) =>
  !/\s/.test(text) && COMMON_WORDS.has(text.toLowerCase())

/** Words of a name that are never a name on their own: how a person is addressed, particles, suffixes. */
const NOT_ALONE = new Set(
  'mr mrs ms miss mx dr doctor sir dame lady lord madam professor prof major captain capt corporal cpl sergeant sgt colonel col general gen lieutenant lt private pte admiral commander officer inspector detective constable father mother sister brother uncle aunt saint st king queen prince princess duke duchess earl count countess baron baroness emperor empress rev reverend pastor bishop judge de du van von der den da di del della la le el al bin ibn the jr sr ii iii iv'.split(
    ' ',
  ),
)

/**
 * The short forms a character's title gives (ADR-0010, 2026-11-18): a nickname in quotes, the
 * first name and the last name. "“Archie” Archibald Collins" gives Archie, Archibald and Collins;
 * "Major Dempsey" gives Dempsey. A rank, a particle, a suffix or an initial is never one, and
 * nothing after "of" is ("Arthur of Camelot" is Arthur). A one-word title gives nothing.
 */
export function shortForms(title: string): string[] {
  const out = new Set<string>()
  const quoted =
    /["“”]([^"“”]+)["“”]|(?<![\p{L}\p{M}\p{N}])['‘]([\p{L}\p{M}]+)['’](?![\p{L}\p{M}\p{N}])/gu
  for (const m of title.matchAll(quoted)) out.add((m[1] ?? m[2]!).trim())
  const words = title
    .replace(quoted, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, ''))
  const end = words.findIndex((w) => w.toLowerCase() === 'of')
  const name = (end < 0 ? words : words.slice(0, end)).filter(
    (w) => /^\p{Lu}/u.test(w) && !/^\p{L}(\.\p{L})*$/u.test(w) && !NOT_ALONE.has(w.toLowerCase()),
  )
  if (name.length) out.add(name[0]!).add(name.at(-1)!)
  out.delete(title.trim())
  return [...out].filter((f) => [...f].length > 1 && !NOT_ALONE.has(f.toLowerCase()))
}

/** The names to look for, grouped by exact text so two records with one name are known. */
export function buildMatcher(forms: NameForm[]): NameMatcher {
  const byText = new Map<string, Candidate>()
  for (const f of forms) {
    const text = f.text.trim()
    if (!text || !LEADING_WORD.test(text)) continue
    const c = byText.get(text) ?? { text, owners: [] }
    // A record that names itself twice the same way is one owner (the stricter mode wins).
    const own = c.owners.find((o) => o.recordId === f.recordId)
    if (!own) c.owners.push({ recordId: f.recordId, mode: f.mode })
    else if (RANK[f.mode] > RANK[own.mode]) own.mode = f.mode
    byText.set(text, c)
  }
  const byWord = new Map<string, Candidate[]>()
  for (const c of byText.values()) {
    const word = LEADING_WORD.exec(c.text)![0]
    byWord.set(word, [...(byWord.get(word) ?? []), c])
  }
  for (const list of byWord.values()) list.sort((a, b) => b.text.length - a.text.length) // longest first
  return { byWord, size: byText.size }
}
const RANK: Record<MatchMode, number> = { auto: 0, ask: 1, never: 2 }

/** Whether `[start, end)` is a whole word: no letter, digit or `@` against it, and no `.x` or `-x` after it. */
export function isWholeAt(text: string, start: number, end: number): boolean {
  const before = text[start - 1]
  if (before && (WORD.test(before) || before === '@')) return false
  if ((before === '-' || before === '.') && WORD.test(text[start - 2] ?? '')) return false
  const after = text[end]
  if (after && (WORD.test(after) || after === '@')) return false
  if ((after === '-' || after === '.') && WORD.test(text[end + 1] ?? '')) return false
  return true
}

/** Why a name is a question, not an answer. */
export type SuggestReason = 'shared' | 'ask' | 'sentence-start'

export interface Mention {
  start: number
  end: number
  /** The text as written ("Elena"). */
  text: string
  /** The records that own this name, never-tagged ones left out. */
  recordIds: string[]
  /** `tagged`: counts everywhere. `suggest`: asked first. */
  status: 'tagged' | 'suggest'
  reason?: SuggestReason
}

const OPENING_QUOTE = /["“«]/
const SKIPPED_BEFORE = /[\s“”"‘’'(«[—–-]/

/** The word starts a sentence: at the start of a block, after `. ! ?`, or right after an opening quote. */
export function startsSentence(text: string, start: number): boolean {
  if (start > 0 && OPENING_QUOTE.test(text[start - 1]!)) return true
  let i = start - 1
  while (i >= 0 && SKIPPED_BEFORE.test(text[i]!)) {
    if (text[i] === '\n') return true
    i--
  }
  return i < 0 || '.!?…'.includes(text[i]!)
}

/**
 * Zones where no name is looked for: code, links (the link decides), web and email addresses, and
 * a footnote's label (`[^Elena]` is the file's own, and renaming it would tie a note to nothing).
 */
export function skipZones(text: string, links: LinkRef[]): Range[] {
  const zones = [...codeRanges(text), ...links.map((l): Range => [l.start, l.end])]
  if (text.includes('[^'))
    for (const m of text.matchAll(/\[\^[^\]\n]*\]/g)) zones.push([m.index, m.index + m[0].length])
  if (text.includes('@') || text.includes('://') || text.includes(']('))
    for (const m of text.matchAll(
      /\b[a-z][a-z0-9+.-]*:\/\/\S+|\]\([^)\s]*\)|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
    ))
      zones.push([m.index, m.index + m[0].length])
  return zones.sort((a, b) => a[0] - b[0])
}

/**
 * The names in a text, in order: whole words only, the author's capitals, the longest name where
 * two start at one place, nothing inside `skip`. A possessive ("Elena’s") is the name; the `’s`
 * is not part of it.
 */
export function findNames(text: string, matcher: NameMatcher, skip: Range[] = []): Mention[] {
  if (!matcher.size) return []
  const out: Mention[] = []
  let resume = 0
  let zone = 0
  for (const token of text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    const start = token.index
    if (start < resume) continue
    const candidates = matcher.byWord.get(token[0])
    if (!candidates) continue
    while (zone < skip.length && skip[zone]![1] <= start) zone++
    // Zones may overlap (a link inside a code span): look at each that could hold this word.
    if (skip.some(([a, b], i) => i >= zone && a <= start && start < b)) continue
    const found = candidates.find(
      (c) => text.startsWith(c.text, start) && isWholeAt(text, start, start + c.text.length),
    )
    if (!found) continue
    const mention = classify(text, start, found)
    resume = start + found.text.length
    if (mention) out.push(mention)
  }
  return out
}

function classify(text: string, start: number, c: Candidate): Mention | undefined {
  const owners = c.owners.filter((o) => o.mode !== 'never')
  if (!owners.length) return undefined
  const base = {
    start,
    end: start + c.text.length,
    text: c.text,
    recordIds: owners.map((o) => o.recordId),
  }
  if (owners.length > 1) return { ...base, status: 'suggest', reason: 'shared' }
  if (owners[0]!.mode === 'ask') return { ...base, status: 'suggest', reason: 'ask' }
  if (!/\s/.test(c.text) && COMMON_WORDS.has(c.text.toLowerCase()) && startsSentence(text, start))
    return { ...base, status: 'suggest', reason: 'sentence-start' }
  return { ...base, status: 'tagged' }
}

// ---- the author's "not a name" answers -------------------------------------------------------

/** How many times `word` stands whole in `text` up to and including the one at `at`. */
function occurrenceAt(text: string, word: string, at: number): number {
  let n = 0
  for (let i = text.indexOf(word); i >= 0 && i <= at; i = text.indexOf(word, i + 1))
    if (isWholeAt(text, i, i + word.length)) n++
  return n
}

/**
 * The key a "not a name" answer is kept under in a scene's `ignoreNames`: `Will:2` is the second
 * whole-word "Will" in the scene (ADR-0010). A block is not given an ID just to answer a question,
 * so an answer is never a write into the manuscript. The count is of the word wherever it stands
 * (in a link, in italics), so the editor, which reads the text on screen, and the index, which
 * reads the file, number the same places; and an accepted place keeps its number.
 */
export const ignoreKey = (text: string, m: Pick<Mention, 'start' | 'text'>) =>
  `${m.text}:${occurrenceAt(text, m.text, m.start)}`

/**
 * What the author's answers leave of the mentions. An answer hides only a name Aurelia was asking
 * about: words added since can move a number onto a different, real name, and that one must stay.
 */
export function withoutIgnored(
  text: string,
  mentions: Mention[],
  ignored: ReadonlySet<string>,
): Mention[] {
  if (!ignored.size) return mentions
  return mentions.filter((m) => m.status !== 'suggest' || !ignored.has(ignoreKey(text, m)))
}
