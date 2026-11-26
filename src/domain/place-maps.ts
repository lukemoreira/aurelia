// SPDX-License-Identifier: AGPL-3.0-or-later
// Maps on places (ADR-0017): a place or world has a picture used as a map and pins on it, each pin a
// place of the universe. Plain data in, new data out; nothing here writes.
import { placeWithin } from './places'
import { pinSchema, type MapPin } from './schema/record'
import type { RecordDoc, SceneDoc } from './workspace-data'

export type { MapPin }
type Rec = Pick<RecordDoc, 'meta' | 'universe'>

/** A position on the picture: a fraction of its width and height, kept inside the picture, to four places. */
export const clamp01 = (n: number) =>
  Math.round(Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0.5)) * 10000) / 10000

/** A pin with the place it points at, for drawing. */
export interface ShownPin {
  place: string
  x: number
  y: number
  title: string
  /** The author's own level name ("City"), when they gave one. */
  kind?: string
}

/**
 * The pins whose place is still here, and is not the map's own place. A pin to a place that was deleted (it
 * waits in Recently deleted) is not shown, and it is not removed either: it stays in the file, so restoring
 * the place brings it back.
 */
export function shownPins(pins: MapPin[] | undefined, records: Rec[], owner?: string): ShownPin[] {
  const places = new Map(
    records
      .filter((r) => r.meta.type === 'place' || r.meta.type === 'world')
      .map((r) => [r.meta.id, r]),
  )
  return (pins ?? []).flatMap((p) => {
    const r = p.place === owner ? undefined : places.get(p.place)
    const kind = r?.meta.kind?.trim()
    return r
      ? [{ place: p.place, x: p.x, y: p.y, title: r.meta.title, ...(kind ? { kind } : {}) }]
      : []
  })
}

// The three edits below work on the `pins` list as the file has it (`raw`), not on what was read from it: an
// entry that was left out when read (a kind of pin a later version wrote, a bad ID, a second pin of one place)
// is written back as it is. A pin that is not touched keeps its stored values, unrounded.
const list = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : [])
const isPinOf = (entry: unknown, place: string) => {
  const got = pinSchema.safeParse(entry)
  return got.success && got.data.place === place
}

/**
 * The list with this place pinned at x, y. A place already pinned has its pin moved (the keys it has stay),
 * never pinned twice. A place cannot be pinned on its own map: the list comes back as it was.
 */
export function addPin(
  raw: unknown,
  place: string,
  x: number,
  y: number,
  owner?: string,
): unknown[] {
  if (place === owner) return list(raw)
  const at = { x: clamp01(x), y: clamp01(y) }
  const pins = list(raw)
  const shown = pins.findIndex((e) => isPinOf(e, place))
  return shown < 0
    ? [...pins, { place, ...at }]
    : pins.map((e, i) => (i === shown ? { ...(e as object), ...at } : e))
}

/** Another position for the pin of this place (the list as it was when it has none). */
export function movePin(raw: unknown, place: string, x: number, y: number): unknown[] {
  const at = { x: clamp01(x), y: clamp01(y) }
  const shown = list(raw).findIndex((e) => isPinOf(e, place))
  return list(raw).map((e, i) => (i === shown ? { ...(e as object), ...at } : e))
}

/** The list without the pin of this place (a second, hidden pin of it goes too, or it would show instead). */
export const removePin = (raw: unknown, place: string): unknown[] =>
  list(raw).filter((e) => !isPinOf(e, place))

/** A scene set at a place (or inside it). */
export interface SceneHere {
  id: string
  title: string
  bookId: string
  /** Where exactly, when it is a place inside the pinned one. */
  at?: { id: string; title: string }
}

/**
 * The scenes set here: those whose `location` is this place or any place inside it, at any depth. A scene
 * set in a place inside says which one. By title, so the list does not shuffle.
 */
export function scenesSetHere(
  records: Rec[],
  scenes: Pick<SceneDoc, 'meta' | 'book'>[],
  place: string,
  bookOf: (scene: Pick<SceneDoc, 'meta' | 'book'>) => string | undefined = (s) => s.book,
): SceneHere[] {
  const within = placeWithin(records, place)
  const title = new Map(records.map((r) => [r.meta.id, r.meta.title]))
  return scenes
    .filter((s) => s.meta.location && within.has(s.meta.location))
    .map((s): SceneHere => {
      const at = s.meta.location!
      return {
        id: s.meta.id,
        title: s.meta.title,
        bookId: bookOf(s) ?? '',
        ...(at === place ? {} : { at: { id: at, title: title.get(at) ?? at } }),
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}
