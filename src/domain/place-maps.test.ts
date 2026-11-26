// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { addPin, clamp01, movePin, removePin, scenesSetHere, shownPins } from './place-maps'
import { placeWithin } from './places'
import type { MapPin } from './schema/record'
import type { RecordDoc, SceneDoc } from './workspace-data'

const id = (prefix: string, n: number) => `${prefix}_${String(n).padStart(10, '0')}`
const make = (
  n: number,
  title: string,
  extra: Partial<RecordDoc['meta']> = {},
  type: 'place' | 'world' | 'character' = 'place',
): RecordDoc => ({
  universe: id('unv', 1),
  meta: {
    title,
    schemaVersion: 1,
    id: id({ place: 'plc', world: 'wld', character: 'chr' }[type], n),
    type,
    scope: 'universe',
    ...extra,
  },
})
const scene = (n: number, title: string, location?: string): SceneDoc => ({
  meta: {
    title,
    schemaVersion: 1,
    id: id('scn', n),
    chapter: id('chp', 1),
    order: 'a',
    ...(location ? { location } : {}),
  },
  body: '',
  words: 0,
  book: id('bok', 1),
})

const earth = make(1, 'Earth', { kind: 'Planet' }, 'world')
const france = make(2, 'France', { parent: earth.meta.id, kind: 'Country' })
const paris = make(3, 'Paris', { parent: france.meta.id })
const louvre = make(4, 'Louvre', { parent: paris.meta.id })
const mars = make(5, 'Mars', {}, 'world')
const elena = make(6, 'Elena', {}, 'character')
const all = [earth, france, paris, louvre, mars, elena]

describe('pins that show', () => {
  const pins: MapPin[] = [
    { place: france.meta.id, x: 0.2, y: 0.3 },
    { place: id('plc', 99), x: 0.5, y: 0.5 }, // a place that is gone
    { place: paris.meta.id, x: 0.6, y: 0.7 },
  ]

  it('names each pin by its place, with the level name when it has one', () => {
    expect(shownPins(pins, all)).toEqual([
      { place: france.meta.id, x: 0.2, y: 0.3, title: 'France', kind: 'Country' },
      { place: paris.meta.id, x: 0.6, y: 0.7, title: 'Paris' },
    ])
  })

  it('hides a pin whose place is gone, and the list it came from still holds it', () => {
    expect(shownPins(pins, all)).toHaveLength(2)
    expect(pins).toHaveLength(3)
    // Restored (here: back in the records), it shows again.
    const lyon = make(99, 'Lyon') // the id the pin points at
    expect(shownPins(pins, [...all, lyon]).map((p) => p.title)).toEqual(['France', 'Lyon', 'Paris'])
  })

  it('does not draw a pin to something that is not a place', () => {
    expect(shownPins([{ place: elena.meta.id, x: 0, y: 0 }], all)).toEqual([])
    expect(shownPins(undefined, all)).toEqual([])
  })
})

describe('adding, moving and removing a pin', () => {
  it('adds one, and a place already pinned is moved, not pinned twice', () => {
    const one = addPin(undefined, france.meta.id, 0.2, 0.4)
    expect(one).toEqual([{ place: france.meta.id, x: 0.2, y: 0.4 }])
    const moved = addPin(one, france.meta.id, 0.9, 0.1)
    expect(moved).toEqual([{ place: france.meta.id, x: 0.9, y: 0.1 }])
    expect(one[0]).toMatchObject({ x: 0.2 }) // the old list is not changed
  })

  it('keeps the keys of a pin it does not know', () => {
    const pins = [{ place: france.meta.id, x: 0.2, y: 0.2, colour: 'red' }]
    expect(movePin(pins, france.meta.id, 0.5, 0.5)).toEqual([
      { place: france.meta.id, x: 0.5, y: 0.5, colour: 'red' },
    ])
    expect(addPin(pins, france.meta.id, 0.1, 0.1)[0]).toMatchObject({ colour: 'red' })
  })

  it('writes back entries it could not read, and leaves untouched pins as they are stored', () => {
    const odd = { kind: 'route', from: 1, to: 2 } // a kind of pin a later version wrote
    const bad = { place: 'nonsense', x: 0.5, y: 0.5 }
    const second = { place: france.meta.id, x: 0.9, y: 0.9 } // a second pin of the same place
    const stored = [
      odd,
      { place: paris.meta.id, x: 0.123456, y: 2 }, // not rounded, not clamped: it is not touched
      bad,
      { place: france.meta.id, x: 0.3, y: 0.3 },
      second,
    ]
    const moved = movePin(stored, france.meta.id, 0.5, 0.5)
    expect(moved).toEqual([odd, stored[1], bad, { place: france.meta.id, x: 0.5, y: 0.5 }, second])
    expect(addPin(stored, mars.meta.id, 0.1, 0.1)).toEqual([
      ...stored,
      { place: mars.meta.id, x: 0.1, y: 0.1 },
    ])
    // Removing a place takes its hidden second pin too, or that one would show instead.
    expect(removePin(stored, france.meta.id)).toEqual([odd, stored[1], bad])
  })

  it('replaces a pins value that is not a list', () => {
    expect(addPin('here', paris.meta.id, 0.1, 0.1)).toEqual([
      { place: paris.meta.id, x: 0.1, y: 0.1 },
    ])
    expect(removePin({ a: 1 }, paris.meta.id)).toEqual([])
  })

  it('does not pin a place on its own map', () => {
    expect(addPin([], paris.meta.id, 0.5, 0.5, paris.meta.id)).toEqual([])
    const own = [{ place: paris.meta.id, x: 0.5, y: 0.5 }]
    expect(shownPins(own, all, paris.meta.id)).toEqual([])
    expect(shownPins(own, all, france.meta.id)).toHaveLength(1)
  })

  it('keeps every position inside the picture', () => {
    expect(addPin([], paris.meta.id, -3, 7)).toEqual([{ place: paris.meta.id, x: 0, y: 1 }])
    expect(movePin([{ place: paris.meta.id, x: 0, y: 0 }], paris.meta.id, 2, -2)[0]).toMatchObject({
      x: 1,
      y: 0,
    })
    expect(clamp01(Number.NaN)).toBe(0.5)
  })

  it('moves only the pin asked for, and removes only that one', () => {
    const pins = addPin(addPin([], france.meta.id, 0.1, 0.1), paris.meta.id, 0.2, 0.2)
    expect(movePin(pins, paris.meta.id, 0.8, 0.8)[0]).toEqual({
      place: france.meta.id,
      x: 0.1,
      y: 0.1,
    })
    expect(removePin(pins, france.meta.id)).toEqual([{ place: paris.meta.id, x: 0.2, y: 0.2 }])
    expect(removePin(pins, mars.meta.id)).toEqual(pins)
    expect(movePin(pins, mars.meta.id, 0.5, 0.5)).toEqual(pins)
  })
})

describe('scenes set here', () => {
  const scenes = [
    scene(1, 'The arrival', paris.meta.id),
    scene(2, 'At the museum', louvre.meta.id),
    scene(3, 'On the plain', mars.meta.id),
    scene(4, 'Nowhere'),
    scene(5, 'A gap', id('plc', 77)), // a place that is gone
  ]

  it('is the scenes of the place itself and of any place inside it, saying where exactly', () => {
    expect(scenesSetHere(all, scenes, paris.meta.id)).toEqual([
      {
        id: id('scn', 2),
        title: 'At the museum',
        bookId: id('bok', 1),
        at: { id: louvre.meta.id, title: 'Louvre' },
      },
      { id: id('scn', 1), title: 'The arrival', bookId: id('bok', 1) },
    ])
  })

  it('reaches through every level, so a country holds the scenes of its cities and rooms', () => {
    expect(scenesSetHere(all, scenes, france.meta.id).map((s) => s.title)).toEqual([
      'At the museum',
      'The arrival',
    ])
    expect(scenesSetHere(all, scenes, earth.meta.id)).toHaveLength(2)
  })

  it('is empty where nothing is set', () => {
    expect(scenesSetHere(all, scenes, louvre.meta.id).map((s) => s.title)).toEqual([
      'At the museum',
    ])
    expect(scenesSetHere(all, [scene(9, 'x')], paris.meta.id)).toEqual([])
  })

  it('does not hang on two places that were each moved inside the other', () => {
    const a = make(10, 'A', { parent: id('plc', 11) })
    const b = make(11, 'B', { parent: id('plc', 10) })
    const loop = [a, b]
    expect([...placeWithin(loop, a.meta.id)].sort()).toEqual([a.meta.id, b.meta.id].sort())
    expect(scenesSetHere(loop, [scene(1, 's', b.meta.id)], a.meta.id)).toHaveLength(1)
    // The loop is cut at the smaller ID: A stands at the top, B is inside it, not the other way round.
    expect(scenesSetHere(loop, [scene(1, 's', a.meta.id)], b.meta.id)).toHaveLength(0)
  })

  it('asks where a scene is from the book when the scene does not say', () => {
    const loose = [{ ...scene(1, 's', paris.meta.id), book: undefined }]
    expect(scenesSetHere(all, loose, paris.meta.id, () => 'bok_x')[0]!.bookId).toBe('bok_x')
  })
})
