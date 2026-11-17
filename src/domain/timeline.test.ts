// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { cal, story, type Sc } from '../../tests/helpers/continuity-fixture'
import type { Calendar } from './schema/universe'
import { timeline, type Zoom } from './timeline'

const tide: Calendar = { id: cal, name: 'Tide', months: ['Thaw', 'Bloom', 'Heat'], era: 'TR' }
const moon = 'cal_moonxxxxxx'
const calendars: Calendar[] = [tide, { id: moon, name: 'Moon count' }]
const s = (key: string, at?: string, over: Partial<Sc> = {}): Sc => ({
  key,
  ch: key,
  ...(at ? { at } : {}),
  ...over,
})
const run = (scenes: Sc[], opts: Parameters<typeof story>[1] = {}) =>
  story(scenes, { calendars, ...opts })
const titles = (f: ReturnType<typeof run>, zoom: Zoom = 'day', calendar?: string) =>
  timeline(f.m, calendar, zoom).groups.flatMap((g) => g.items.map((i) => i.title))

describe('the timeline orders by story time, not by reading order', () => {
  it('puts a scene told late but set early first, and marks it a flashback', () => {
    const f = run([
      s('now', '412-03-14'),
      s('then', '400-01-02', { flashback: true }),
      s('later', '420', { flashForward: true }),
    ])
    const t = timeline(f.m, undefined, 'day')
    expect(t.groups.flatMap((g) => g.items.map((i) => [i.title, i.order]))).toEqual([
      ['then', 'flashback'],
      ['now', 'in order'],
      ['later', 'flash-forward'],
    ])
  })

  it('orders years before the epoch before the ones after it, and 1 BCE right before 1 CE', () => {
    const f = run([s('c', '412'), s('a', '-500'), s('d', '1'), s('b', '-44-03-15'), s('e', '-1')])
    expect(titles(f)).toEqual(['a', 'b', 'e', 'd', 'c'])
    const t = timeline(f.m, undefined, 'era')
    expect(t.groups.map((g) => [g.label, g.items.length])).toEqual([
      ['before TR', 3],
      ['TR', 2],
    ])
    expect(t.groups[0]!.items.map((i) => i.words)).toEqual([
      '500 before TR',
      '15 Heat 44 before TR',
      '1 before TR',
    ])
  })

  it('says BCE and CE for a calendar with no era of its own', () => {
    const f = run([s('a', '-44', { calendar: moon }), s('b', '30', { calendar: moon })])
    const t = timeline(f.m, moon, 'era')
    expect(t.groups.map((g) => g.label)).toEqual(['BCE', 'CE'])
    expect(t.groups[0]!.items[0]!.words).toBe('44 BCE')
  })

  it('breaks a tie by reading order, and puts a coarse time beside the finer ones inside it', () => {
    const f = run([
      s('x', '412-03-14'),
      s('y', '412-03-14'),
      s('whole', '412-03'),
      s('year', '412'),
    ])
    expect(titles(f)).toEqual(['year', 'whole', 'x', 'y'])
  })
})

describe('the timeline groups by the zoom, and says when a time is too coarse for it', () => {
  const f = run([
    s('a', '411-02-03'),
    s('b', '412-01-02T09:00'),
    s('c', '412-01-20'),
    s('d', '412-02'),
    s('e', '412'),
    s('f', '413-03-01'),
  ])
  const at = (zoom: Zoom) =>
    timeline(f.m, undefined, zoom).groups.map((g) => [g.label, g.items.length, g.coarse])

  it('by year', () => {
    expect(at('year')).toEqual([
      ['411 TR', 1, false],
      ['412 TR', 4, false],
      ['413 TR', 1, false],
    ])
  })
  it('by month: a year with no month is its own group, marked coarse', () => {
    expect(at('month')).toEqual([
      ['Bloom 411 TR', 1, false],
      ['412 TR', 1, true],
      ['Thaw 412 TR', 2, false],
      ['Bloom 412 TR', 1, false],
      ['Heat 413 TR', 1, false],
    ])
  })
  it('by day: a month with no day is its own group, marked coarse', () => {
    expect(at('day')).toEqual([
      ['3 Bloom 411 TR', 1, false],
      ['412 TR', 1, true],
      ['2 Thaw 412 TR', 1, false],
      ['20 Thaw 412 TR', 1, false],
      ['Bloom 412 TR', 1, true],
      ['1 Heat 413 TR', 1, false],
    ])
  })
  it('by era: one group for everything after the epoch', () => {
    expect(at('era')).toEqual([['TR', 6, false]])
  })
})

describe('the timeline never compares calendars', () => {
  const f = run([
    s('t1', '412-03-14'),
    s('t2', '413'),
    s('m1', '5', { calendar: moon }),
    s('m2', '1', { calendar: moon }),
    s('free'),
  ])

  it('shows the calendar with most dated scenes, and lists the others apart', () => {
    const t = timeline(f.m, undefined, 'year')
    expect(t.calendar).toBe(cal)
    expect(t.calendars).toEqual([
      { id: cal, name: 'Tide', count: 2 },
      { id: moon, name: 'Moon count', count: 2 },
    ])
    expect(t.groups.flatMap((g) => g.items.map((i) => i.title))).toEqual(['t1', 't2'])
    expect(t.elsewhere.map((i) => i.title).sort()).toEqual(['m1', 'm2'])
  })
  it('lists a scene with no time apart, not in the timeline', () => {
    const t = timeline(f.m, undefined, 'year')
    expect(t.untimed.map((i) => i.title)).toEqual(['free'])
  })
  it('shows another calendar when asked, ordered within it, and moves the first to "elsewhere"', () => {
    const t = timeline(f.m, moon, 'year')
    expect(t.groups.flatMap((g) => g.items.map((i) => i.title))).toEqual(['m2', 'm1'])
    expect(t.elsewhere.map((i) => i.title).sort()).toEqual(['t1', 't2'])
    // an unknown calendar falls back to the default one
    expect(timeline(f.m, 'cal_nothingxxx', 'year').calendar).toBe(cal)
  })
  it('has no calendar when nothing is dated, and lists every scene as untimed', () => {
    const none = run([s('a'), s('b')])
    const t = timeline(none.m, undefined, 'year')
    expect(t.calendar).toBeUndefined()
    expect(t.groups).toEqual([])
    expect(t.untimed).toHaveLength(2)
  })
})

describe('events with dates show on the timeline', () => {
  it('puts a dated event among the scenes, as an event', () => {
    const f = run([s('a', '412-03-14'), s('b', '412-03-20')], {
      events: [
        { key: 'storm', at: '412-03-16' },
        { key: 'flood', at: '9', calendar: moon },
      ],
    })
    const t = timeline(f.m, undefined, 'day')
    expect(t.groups.flatMap((g) => g.items.map((i) => [i.title, i.kind]))).toEqual([
      ['a', 'scene'],
      ['storm', 'event'],
      ['b', 'scene'],
    ])
    expect(t.elsewhere.map((i) => [i.title, i.kind])).toEqual([['flood', 'event']])
    // an event can be a BCE date too
    const g = run([s('a', '1')], { events: [{ key: 'fall', at: '-600' }] })
    expect(titles(g, 'year')).toEqual(['fall', 'a'])
  })

  it('leaves out an event with no date, and one from another book than the ones in view', () => {
    const f = run([s('a', '412')])
    const data = {
      ...f.data,
      records: [
        ...f.data.records,
        {
          universe: f.data.universes[0]!.id,
          meta: {
            title: 'Vague',
            schemaVersion: 1,
            id: 'evt_vaguexxxxx',
            type: 'event' as const,
            scope: 'universe',
          },
        },
        {
          universe: f.data.universes[0]!.id,
          meta: {
            title: 'Elsewhere',
            schemaVersion: 1,
            id: 'evt_elsewhere1',
            type: 'event' as const,
            scope: 'book:bok_otherbook1',
            time: { calendar: cal, at: '412' },
          },
        },
      ],
    }
    const m = { ...f.m, data }
    expect(
      timeline(m, undefined, 'year').groups.flatMap((g) => g.items.map((i) => i.title)),
    ).toEqual(['a'])
  })
})

describe('the timeline of the whole universe', () => {
  const f = run([
    s('a1', '412-03-14', { book: 'one' }),
    s('a2', '300', { book: 'one', flashback: true }),
    s('b1', '413', { book: 'two' }),
    s('b2', '-10', { book: 'two' }),
  ])

  it('puts the scenes of every book on one line of time, naming the book of each', () => {
    const merged = f.merged()
    const t = timeline(merged, undefined, 'year')
    expect(t.groups.flatMap((g) => g.items.map((i) => [i.title, i.book]))).toEqual([
      ['b2', 'two'],
      ['a2', 'one'],
      ['a1', 'one'],
      ['b1', 'two'],
    ])
  })
  it('names no book when one book is shown', () => {
    const t = timeline(f.models[0]!, undefined, 'year')
    expect(t.groups.flatMap((g) => g.items.map((i) => i.book))).toEqual([undefined, undefined])
    expect(t.groups.flatMap((g) => g.items.map((i) => i.title))).toEqual(['a2', 'a1'])
  })
})
