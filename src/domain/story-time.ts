// SPDX-License-Identifier: AGPL-3.0-or-later
// Story time (ADR-0003, ADR-0006 §3): a sortable key with granularity in a named calendar —
// `412`, `412-03`, `412-03-14`, `412-03-14T18:00` — and an optional `until` that makes a span.
// A negative year is before the calendar's epoch (BCE): `-44` is 44 BCE, and the signed numbers sort
// in time order. Times in different calendars are never compared. Plain TS.
import type { Calendar } from './schema/universe'

export type Granularity = 'year' | 'month' | 'day' | 'minute'

const KEY = /^(-?\d+)(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2}))?)?)?$/

/** A key as numbers: year, month, day, hour, minute (as many as it has). */
export function parseTimeKey(
  key: string,
): { parts: number[]; granularity: Granularity } | undefined {
  const m = KEY.exec(key.trim())
  if (!m) return undefined
  const parts = m
    .slice(1)
    .filter((x) => x !== undefined)
    .map(Number)
  const granularity: Granularity =
    parts.length === 1
      ? 'year'
      : parts.length === 2
        ? 'month'
        : parts.length === 3
          ? 'day'
          : 'minute'
  return { parts, granularity }
}

export interface TimeLike {
  calendar: string
  at: string
  until?: string | undefined
  label?: string | undefined
}

/** The stretch of story time a scene covers, as numbers that compare the same in every calendar. */
export interface Span {
  calendar: string
  lo: number[]
  hi: number[]
  /** A single moment known to the minute: the only kind that can be "the same time" as another. */
  exact: boolean
}

const fill = (parts: number[], value: number) => [
  ...parts,
  ...Array<number>(5 - parts.length).fill(value),
]
const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1
  return 0
}

/** The span of a scene's time; undefined when its key does not read. A bad `until` is ignored. */
export function spanOf(time: TimeLike | undefined): Span | undefined {
  const at = time ? parseTimeKey(time.at) : undefined
  if (!time || !at) return undefined
  const until = time.until ? parseTimeKey(time.until) : undefined
  const lo = fill(at.parts, 0)
  let hi = fill((until ?? at).parts, Infinity)
  let ranged = !!until
  if (compare(lo, hi) > 0) {
    hi = fill(at.parts, Infinity)
    ranged = false
  }
  return { calendar: time.calendar, lo, hi, exact: at.granularity === 'minute' && !ranged }
}

/** `b` is certainly before `a` begins: the only order a check may complain about. */
export const certainlyBefore = (b: Span, a: Span) =>
  b.calendar === a.calendar && compare(b.hi, a.lo) < 0

export const overlaps = (a: Span, b: Span) =>
  a.calendar === b.calendar && compare(a.lo, b.hi) <= 0 && compare(b.lo, a.hi) <= 0

/** The same moment, known to the minute on both sides. */
export const sameMoment = (a: Span, b: Span) =>
  a.exact && b.exact && a.calendar === b.calendar && compare(a.lo, b.lo) === 0

/** Orders by the start of the span; spans of one calendar only. */
export const byStart = (a: Span, b: Span) => compare(a.lo, b.lo)

/** The word after a year before the epoch: BCE, or "before TR" for a calendar with an era of its own. */
export function beforeWords(calendar?: Pick<Calendar, 'era'>): string {
  const era = calendar?.era?.trim()
  return !era || era === 'CE' ? 'BCE' : era === 'AD' ? 'BC' : `before ${era}`
}

/** A key in words: "14 Thaw 412 TR, 18:00" with a calendar that names its months, else "412-03-14 18:00"; "44 BCE" before the epoch. */
export function keyWords(key: string, calendar?: Pick<Calendar, 'era' | 'months'>): string {
  const k = parseTimeKey(key)
  if (!k) return key
  const [signed, month, day, hour, minute] = k.parts
  const year = Math.abs(signed!)
  const suffix = signed! < 0 ? beforeWords(calendar) : calendar?.era
  const clock =
    hour === undefined ? '' : ` ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const monthName = month === undefined ? undefined : calendar?.months?.[month - 1]
  if (!monthName) {
    const rest = key.replace(/^-?\d+/, '').replace('T', ' ')
    return `${year}${rest}${suffix ? ` ${suffix}` : ''}`
  }
  const date = day === undefined ? `${monthName} ${year}` : `${day} ${monthName} ${year}`
  return `${date}${suffix ? ` ${suffix}` : ''}${clock ? `,${clock}` : ''}`
}

/** A year counted on one line: 1 BCE is 0, 2 BCE is -1. There is no year 0, so a stored 0 counts as 1 BCE. */
const counted = (y: number) => (y < 0 ? y + 1 : y)

/** Whole years from a birth to a moment: years are counted as numbers, and 1 BCE is followed by 1 CE. */
export function yearsBetween(born: number[], at: number[]): number {
  const [by, bm = 0, bd = 0] = born as [number, number?, number?]
  const [y, m = 0, d = 0] = at as [number, number?, number?]
  const early = m < bm || (m === bm && d < bd) ? 1 : 0
  return counted(y) - counted(by) - early
}

/** What is wrong with a typed key, in the author's words; undefined when it can be saved. */
export function timeKeyProblem(key: string): string | undefined {
  const k = parseTimeKey(key)
  if (!k) return 'That date is not complete. Fill the year first, then the month, day and time.'
  if (k.parts[0] === 0) return 'There is no year 0. The year before year 1 is 1 before.'
  return undefined
}

/** A scene's time as the author reads it: the date in the calendar's words, a span, and the label. */
export function timeWords(time: TimeLike | undefined, calendars: readonly Calendar[] = []): string {
  if (!time) return ''
  const cal = calendars.find((c) => c.id === time.calendar)
  const at = keyWords(time.at, cal)
  const when = time.until ? `${at} – ${keyWords(time.until, cal)}` : at
  return [when, time.label].filter(Boolean).join(' · ')
}

export const GRANULARITY_WORDS: Record<Granularity, string> = {
  year: 'the year',
  month: 'the month',
  day: 'the day',
  minute: 'the minute',
}
