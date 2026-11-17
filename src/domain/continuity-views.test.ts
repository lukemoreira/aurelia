// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { id, story, type Names, type Sc } from '../../tests/helpers/continuity-fixture'
import {
  arcLanes,
  continuityStats,
  pacing,
  povBalance,
  presenceMap,
  sceneContinuity,
  stateRows,
  timeChart,
} from './continuity-views'

const names: Names = {
  characters: ['ana', 'bob', 'cy'],
  places: ['gate'],
  items: ['key'],
  arcs: ['debt'],
}
const die = (who: string) => ({ who, kind: 'status', value: 'dead' })

describe('the presence map', () => {
  const book: Sc[] = [
    { key: 'a', ch: 'c1', pov: 'ana', words: 300, add: ['bob'] },
    {
      key: 'b',
      ch: 'c2',
      pov: 'bob',
      words: 100,
      named: ['ana'],
      remove: ['ana'],
      changes: [die('bob')],
    },
    { key: 'c', ch: 'c3', pov: 'ana', words: 600, add: ['bob'] },
  ]
  const { m, findings } = story(book, { names })
  const rows = presenceMap(m, findings())
  const row = (name: string) => rows.find((r) => r.name === name)!

  it('has one cell per chapter for each person, with words in every cell', () => {
    expect(row('ana').cells).toHaveLength(3)
    expect(rows.flatMap((r) => r.cells).every((c) => c.text.length > 0)).toBe(true)
    expect(row('ana').cells.map((c) => c.text)).toEqual([
      'Point of view',
      'Mentioned',
      'Point of view',
    ])
  })

  it('tells point of view from on the page, spoken of, and absent', () => {
    expect(row('bob').cells.map((c) => c.state)).toEqual(['on', 'pov', 'on'])
    expect(row('ana').cells[1]).toMatchObject({ state: 'mentioned' })
  })

  it('marks the chapter a person dies in, and a finding about them', () => {
    expect(row('bob').cells[1]).toMatchObject({
      exit: 'dies',
      finding: false,
      text: 'Point of view, dies',
    })
    // bob is on the page in chapter 3, after dying: the finding is there
    expect(row('bob').cells[2]).toMatchObject({ finding: true, text: 'On the page, finding' })
    expect(row('ana').cells.some((c) => c.finding)).toBe(false)
  })

  it('lists the people who carry the story first, with what they are', () => {
    expect(rows.map((r) => r.name)).toEqual(['bob', 'ana']) // bob is on the page in three scenes, ana in two
    expect(row('ana').role).toBe('Main · POV')
    expect(row('ana').scenes).toBe(2)
  })

  it('leaves out someone who is nowhere in the book', () => {
    expect(rows.some((r) => r.name === 'cy')).toBe(false)
  })
})

describe('the other figures', () => {
  it('draws an arc’s beats, the chapters that advance it, and where it is silent', () => {
    const scenes: Sc[] = Array.from({ length: 10 }, (_, i) => ({
      key: `s${i}`,
      ch: `c${String(i).padStart(2, '0')}`,
      ...(i === 0
        ? { arcs: ['debt'] }
        : i === 9
          ? { changes: [{ who: 'debt', kind: 'beat', value: 'called in' }] }
          : {}),
    }))
    const [lane] = arcLanes(story(scenes, { names }).m)
    expect(lane!.cells.map((c) => c.kind)).toEqual([
      'advanced',
      'silent',
      'silent',
      'silent',
      'silent',
      'silent',
      'silent',
      'silent',
      'silent',
      'beat',
    ])
    expect(lane!.silent).toBe(1)
    expect(lane!.cells.every((c) => c.text)).toBe(true)
  })

  it('splits the point-of-view words between the people who have one', () => {
    const shares = povBalance(
      story(
        [
          { key: 'a', pov: 'ana', words: 300 },
          { key: 'b', ch: 'c2', pov: 'bob', words: 100 },
          { key: 'c', ch: 'c3', words: 999 }, // no point of view: not counted
        ],
        { names },
      ).m,
    )
    expect(shares.map((s) => [s.name, s.words, s.share, s.scenes])).toEqual([
      ['ana', 300, 75, 1],
      ['bob', 100, 25, 1],
    ])
  })

  it('charts story time against reading order: flashbacks and jumps are marked, other calendars and untimed scenes counted', () => {
    const { m, findings } = story([
      { key: 'a', ch: 'c1', at: '412-01-10' },
      { key: 'b', ch: 'c2', at: '412-01-05', flashback: true },
      { key: 'c', ch: 'c3', at: '412-01-12' },
      { key: 'd', ch: 'c4', at: '412-01-08' },
      { key: 'e', ch: 'c5' },
    ])
    const chart = timeChart(m, findings())
    expect(chart.points.map((p) => [p.ref, p.rank, p.order, p.jump])).toEqual([
      ['1.1', 2, 'in order', false],
      ['2.1', 0, 'flashback', false],
      ['3.1', 3, 'in order', false],
      ['4.1', 1, 'in order', true],
    ])
    expect(chart).toMatchObject({ moments: 4, untimed: 1, elsewhere: 0 })
    expect(chart.points[0]!.words).toBe('10 Thaw 412 TR')
  })

  it('sets a chapter’s words against what it was meant to be', () => {
    const p = pacing(
      story([
        { key: 'a', ch: 'c1', words: 900, target: 1000 },
        { key: 'b', ch: 'c1', words: 300, target: 500 },
        { key: 'c', ch: 'c2', words: 50 },
      ]).m,
    )
    expect(p.map((x) => [x.words, x.target])).toEqual([
      [1200, 1500],
      [50, undefined],
    ])
  })

  it('counts what the numbers above the map say', () => {
    const { m, findings } = story(
      [
        { key: 'a', pov: 'ana', changes: [die('bob')] },
        { key: 'b', ch: 'c2', pov: 'ana' },
      ],
      { names },
    )
    const stats = continuityStats(m, presenceMap(m, findings()))
    expect(stats[0]).toEqual({ value: '1 of 2', label: 'scenes have changes recorded' })
    expect(stats[1]!.value).toBe('2')
  })
})

describe('the state at a scene, in words', () => {
  const { m, findings } = story(
    [
      {
        key: 'a',
        ch: 'c1',
        pov: 'ana',
        place: 'gate',
        changes: [
          { who: 'ana', kind: 'condition', value: 'Injured' },
          { who: 'ana', kind: 'holds', item: 'key' },
        ],
      },
      {
        key: 'b',
        ch: 'c2',
        pov: 'ana',
        add: ['bob'],
        place: 'gate',
        changes: [
          { who: 'bob', kind: 'relation', with: 'ana', value: 'stranger → creditor' },
          { who: 'ana', kind: 'knows', value: 'Bob is her creditor' },
        ],
      },
    ],
    { names },
  )

  it('shows only what has been recorded, with names and where it began', () => {
    const rows = stateRows(m, id.scn('b'), id.chr('ana'))
    expect(rows.map((r) => r.label)).toEqual([
      'Status',
      'Condition',
      'Where',
      'Holds',
      'Has learned',
    ])
    expect(rows.find((r) => r.label === 'Holds')!.items).toEqual([
      { text: 'key', since: '1.1', some: false },
    ])
    expect(rows.find((r) => r.label === 'Condition')!.items[0]).toMatchObject({
      text: 'Injured',
      since: '1.1',
    })
    expect(rows.find((r) => r.label === 'Status')!.items[0]).toMatchObject({ text: 'Alive' })
    expect(
      stateRows(m, id.scn('b'), id.chr('bob')).find((r) => r.label === 'Relationships')!.items[0]!
        .text,
    ).toBe('ana: creditor')
  })

  it('puts the people on the page first, point of view first, with the findings about the scene', () => {
    const c = sceneContinuity(m, findings(), id.scn('b'))
    expect(c.people.map((p) => [p.name, p.pov])).toEqual([
      ['ana', true],
      ['bob', false],
    ])
    expect(c.findings).toEqual([])
  })
})
