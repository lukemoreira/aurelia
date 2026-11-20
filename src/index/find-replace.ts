// SPDX-License-Identifier: AGPL-3.0-or-later
// Find and replace in a book: every place a word or phrase is written in the scene text, as a plan
// the rename writer (`applyRename`) can change and undo. Pure: nothing here reads or writes a file.
import { codeRanges, parseLinks, type Range } from './links'
import { skipZones } from './names'
import { around, atLineStart, escapeMarkdown, keptAsWritten, type RenamePlan } from './rename'

export interface FindOptions {
  matchCase: boolean
  wholeWords: boolean
}

/** One scene to look in: its text without the details at the top. */
export interface FindDoc {
  id: string
  /** "2.1 · The Gate": the scene's number and title. */
  where: string
  body: string
}

/** Matches that are never changed, by why. */
export interface Skipped {
  link: number
  code: number
  other: number
}

/** A letter, a mark or a digit in any script: what a word is made of (é, ß and Å included). */
const WORD = '[\\p{L}\\p{M}\\p{N}]'
/** Scripts written without spaces between words: "whole words" means nothing there. */
const NO_SPACES =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u

/** What is found must hold a letter or a digit: `*` or `#` alone would find the file's own marks. */
export const hasWord = (find: string) => /[\p{L}\p{N}]/u.test(find)
/** Whether "Whole words only" can apply to this search. */
export const wordsApply = (find: string) => !NO_SPACES.test(find)

/**
 * Each character as the file holds it. The text is Markdown, and the editor writes a character
 * that would read as a mark escaped (`a\*b`), and leaves it bare where it cannot (`a * b`,
 * `snake_case`): both forms are found, and a bare mark (`*very*`) never is.
 */
const SOURCE: Record<string, string> = {
  '\\': '\\\\\\\\',
  '`': '\\\\`',
  '[': '\\\\\\[',
  ']': '\\\\\\]',
  '*': '(?:\\\\\\*|(?<=\\s)\\*(?=\\s))',
  _: `(?:\\\\_|(?<=${WORD})_(?=${WORD}))`,
  '<': '(?:\\\\<|<(?![A-Za-z/!?]))',
  '~': '\\\\?~',
  '&': '\\\\?&',
  '|': '\\\\?\\|',
  '>': '\\\\?>',
}
const sourceOf = (c: string) => SOURCE[c] ?? c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The pattern for what the author typed: plain text, never a regular expression, and never inside another escape. */
export function findPattern(find: string, o: FindOptions): RegExp | undefined {
  if (!hasWord(find)) return undefined
  const core = `(?<!\\\\)${[...find].map(sourceOf).join('')}`
  // A word goes on through an apostrophe (`don't`), except a trailing `'s` (`cat's`).
  const whole = `(?<!${WORD})(?<!${WORD}['’])${core}(?!${WORD})(?!['’](?![sS](?!${WORD}))${WORD})`
  return new RegExp(o.wholeWords && wordsApply(find) ? whole : core, o.matchCase ? 'gu' : 'giu')
}

/** The replacement in the case shape of the match: ALL CAPS stays all caps, a capital first letter stays capital, else as typed. */
export function keepCase(match: string, typed: string): string {
  const cased = (match.match(/\p{L}/gu) ?? []).filter((c) => c.toLowerCase() !== c.toUpperCase())
  if (cased.length > 1 && cased.every((c) => c === c.toUpperCase())) return typed.toUpperCase()
  const first = match.match(/\p{L}/u)?.[0]
  if (first && first !== first.toLowerCase()) return typed.replace(/\p{L}/u, (c) => c.toUpperCase())
  return typed
}

/** An inline HTML tag: kept as written by the editor, like code. */
const htmlTags = (text: string): Range[] =>
  text.includes('<')
    ? [...text.matchAll(/<\/?[A-Za-z][^>\n]*>/g)].map((m): Range => [
        m.index,
        m.index + m[0].length,
      ])
    : []

/** The text as it reads: escapes taken away. */
const visible = (md: string) => md.replace(/\\(.)/g, '$1')

const touches = (zones: Range[], start: number, end: number) =>
  zones.some(([a, b]) => a < end && start < b)

/**
 * Every place `find` is written in the scenes, in reading order, each with what it becomes. A
 * match is never changed inside a `[[link]]` (its target or its text), in code, raw HTML or a link
 * definition (kept as written), nor in a web or email address or a footnote's label; those are
 * counted in `skipped`. A match that would read the same after is not a place.
 */
export function planReplace(
  docs: FindDoc[],
  find: string,
  replace: string,
  o: FindOptions,
  bookId?: string,
): { plan: RenamePlan; skipped: Skipped } {
  const plan: RenamePlan = { forms: [], places: [], bodies: new Map() }
  const skipped: Skipped = { link: 0, code: 0, other: 0 }
  const re = findPattern(find, o)
  if (!re) return { plan, skipped }
  for (const doc of docs) {
    const matches = [...doc.body.matchAll(re)]
    if (!matches.length) continue
    const links = parseLinks(doc.body).map((l): Range => [l.start, l.end])
    const code = [...codeRanges(doc.body), ...keptAsWritten(doc.body), ...htmlTags(doc.body)]
    const other = skipZones(doc.body, [])
    let found = 0
    for (const m of matches) {
      const [start, end] = [m.index, m.index + m[0].length]
      if (touches(links, start, end)) skipped.link++
      else if (touches(code, start, end)) skipped.code++
      else if (touches(other, start, end)) skipped.other++
      else {
        const typed = o.matchCase ? replace : keepCase(m[0], replace)
        const next = escapeMarkdown(typed, atLineStart(doc.body, start))
        if (visible(next) === visible(m[0])) continue
        found++
        plan.places.push({
          key: `${doc.id}:${start}`,
          docId: doc.id,
          kind: 'scene',
          where: doc.where,
          ...(bookId ? { bookId } : {}),
          start,
          end,
          old: m[0],
          next,
          ...around(doc.body, start, end),
        })
      }
    }
    if (found) plan.bodies.set(doc.id, doc.body)
  }
  return { plan, skipped }
}

/** "3 inside links, 1 in code, not changed": what was found and left alone. Empty when nothing was. */
export function skippedWords(s: Skipped): string {
  const parts = [
    s.link && `${s.link} inside links`,
    s.code && `${s.code} in code or raw HTML`,
    s.other && `${s.other} in web addresses or note labels`,
  ].filter(Boolean)
  return parts.length ? `${parts.join(', ')}, not changed.` : ''
}
