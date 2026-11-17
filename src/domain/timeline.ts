// SPDX-License-Identifier: AGPL-3.0-or-later
// The timeline (M6b): the scenes and the events of the story on story time, in one calendar at a time
// (times in different calendars are never compared), grouped by era, year, month or day. A scene with
// no time, or one in another calendar, is listed apart rather than guessed into place. Plain TS.
import type { ContinuityModel } from './continuity'
import {
  beforeWords,
  byStart,
  keyWords,
  parseTimeKey,
  spanOf,
  timeWords,
  type Span,
} from './story-time'

export type Zoom = 'era' | 'year' | 'month' | 'day'
export const ZOOMS: { value: Zoom; label: string }[] = [
  { value: 'era', label: 'Era' },
  { value: 'year', label: 'Year' },
  { value: 'month', label: 'Month' },
  { value: 'day', label: 'Day' },
]
/** How many parts of the key (year, month, day) a zoom groups by. */
const DEPTH: Record<Zoom, number> = { era: 0, year: 1, month: 2, day: 3 }

/** How an item is told, in words: nothing for a scene in order. */
export const TOLD = {
  'in order': '',
  flashback: 'Flashback',
  'flash-forward': 'Flash-forward',
} as const

export interface TimelineItem {
  /** The scene's or the record's ID. */
  id: string
  kind: 'scene' | 'event'
  title: string
  /** "7.2" for a scene. */
  ref?: string
  /** The book a scene is in, and its title when a whole universe is shown. */
  bookId?: string
  book?: string
  /** The time in the calendar's words. */
  words: string
  order: 'in order' | 'flashback' | 'flash-forward'
  calendar: string
  span?: Span
  /** How many of the year, month and day the key names (at most 3). */
  known: number
  /** The position in reading order, for ties. */
  index: number
}

export interface TimelineGroup {
  key: string
  label: string
  /** Some of its items do not say the month or the day this zoom groups by. */
  coarse: boolean
  items: TimelineItem[]
}

export interface Timeline {
  calendars: { id: string; name: string; count: number }[]
  calendar?: string
  groups: TimelineGroup[]
  /** Dated in another calendar than the one shown. */
  elsewhere: TimelineItem[]
  /** Scenes with no time listed. */
  untimed: TimelineItem[]
}

const pad = (x: number) => String(x).padStart(2, '0')

/** The events of the books in view: dated records of the universe, or of one of those books. */
function eventItems(m: ContinuityModel, books: ReadonlySet<string>): TimelineItem[] {
  const universe = m.data.universes.find((u) => u.books.includes(m.bookId))?.id
  const items: TimelineItem[] = []
  for (const r of m.data.records) {
    const time = r.meta.time
    if (r.meta.type !== 'event' || !time) continue
    const mine =
      r.meta.scope === 'universe'
        ? r.universe === universe
        : books.has(r.meta.scope.replace('book:', ''))
    const span = spanOf(time)
    if (!mine || !span) continue
    items.push({
      id: r.meta.id,
      kind: 'event',
      title: r.meta.title,
      words: timeWords(time, m.calendars),
      order: 'in order',
      calendar: time.calendar,
      span,
      known: Math.min(3, parseTimeKey(time.at)!.parts.length),
      index: Infinity,
    })
  }
  return items
}

/** The group a span falls in at a zoom: its key, its words and whether the item is too coarse for it. */
function groupOf(item: TimelineItem, zoom: Zoom, m: ContinuityModel) {
  const cal = m.calendars.find((c) => c.id === item.calendar)
  const [y, mo, d] = item.span!.lo as [number, number, number]
  if (zoom === 'era')
    return y < 0
      ? { key: 'before', label: beforeWords(cal), coarse: item.known < 1 }
      : { key: 'after', label: cal?.era || 'CE', coarse: item.known < 1 }
  const have = Math.min(DEPTH[zoom], item.known)
  const key = [String(y), pad(mo), pad(d)].slice(0, have).join('-')
  return { key, label: keyWords(key, cal), coarse: have < DEPTH[zoom] }
}

/**
 * The timeline of a model (a book's, or a universe's books end to end). `calendar` is the one shown;
 * without one it is the calendar with the most dated items, the first of the universe's on a tie.
 */
export function timeline(m: ContinuityModel, calendar: string | undefined, zoom: Zoom): Timeline {
  const books = new Set(m.scenes.map((s) => s.book))
  if (!books.size) books.add(m.bookId)
  const bookTitle = (id: string) => m.data.books.find((b) => b.id === id)?.title
  const multi = books.size > 1
  const all: TimelineItem[] = []
  const untimed: TimelineItem[] = []
  for (const s of m.scenes) {
    const time = s.doc.meta.time
    const item: TimelineItem = {
      id: s.id,
      kind: 'scene',
      title: s.title,
      ref: s.ref,
      bookId: s.book,
      ...(multi ? { book: bookTitle(s.book) ?? '' } : {}),
      words: timeWords(time, m.calendars),
      order: s.doc.meta.flashback
        ? 'flashback'
        : s.doc.meta.flashForward
          ? 'flash-forward'
          : 'in order',
      calendar: time?.calendar ?? '',
      known: time ? Math.min(3, parseTimeKey(time.at)?.parts.length ?? 0) : 0,
      index: s.index,
      ...(s.span ? { span: s.span } : {}),
    }
    if (s.span) all.push(item)
    else untimed.push(item)
  }
  all.push(...eventItems(m, books))

  const counts = new Map<string, number>()
  for (const i of all) counts.set(i.calendar, (counts.get(i.calendar) ?? 0) + 1)
  const order = m.calendars.map((c) => c.id)
  const calendars = [...counts]
    .map(([id, count]) => ({
      id,
      name: m.calendars.find((c) => c.id === id)?.name ?? 'Another calendar',
      count,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        order.indexOf(a.id) - order.indexOf(b.id) ||
        a.name.localeCompare(b.name),
    )
  const shown = calendars.some((c) => c.id === calendar) ? calendar : calendars[0]?.id

  const sorted = all
    .filter((i) => i.calendar === shown)
    .sort(
      (a, b) => byStart(a.span!, b.span!) || a.index - b.index || a.title.localeCompare(b.title),
    )
  const groups: TimelineGroup[] = []
  for (const item of sorted) {
    const g = groupOf(item, zoom, m)
    const last = groups.at(-1)
    if (last && last.key === g.key) {
      last.items.push(item)
      last.coarse ||= g.coarse
    } else groups.push({ ...g, items: [item] })
  }
  return {
    calendars,
    ...(shown ? { calendar: shown } : {}),
    groups,
    elsewhere: all.filter((i) => i.calendar !== shown),
    untimed,
  }
}
