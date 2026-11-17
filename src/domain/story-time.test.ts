// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import {
  certainlyBefore,
  beforeWords,
  byStart,
  keyWords,
  overlaps,
  parseTimeKey,
  sameMoment,
  timeKeyProblem,
  yearsBetween,
  spanOf,
  timeWords,
} from './story-time'

const cal = 'cal_aaaaaaaaaa'
const span = (at: string, until?: string, calendar = cal) =>
  spanOf({ calendar, at, ...(until ? { until } : {}) })!

describe('story time keys', () => {
  it('reads a year, a month, a day and a minute, and nothing else', () => {
    expect(parseTimeKey('412')?.granularity).toBe('year')
    expect(parseTimeKey('412-03')?.granularity).toBe('month')
    expect(parseTimeKey('412-03-14')?.granularity).toBe('day')
    expect(parseTimeKey('412-03-14T18:00')).toEqual({
      parts: [412, 3, 14, 18, 0],
      granularity: 'minute',
    })
    expect(parseTimeKey('dusk')).toBeUndefined()
    expect(parseTimeKey('412-3')).toBeUndefined()
  })

  it('knows a scene is before another only when it is certainly before: a coarse time overlaps the finer ones inside it', () => {
    expect(certainlyBefore(span('412-03-10'), span('412-03-14'))).toBe(true)
    expect(certainlyBefore(span('412-03-14'), span('412-03-10'))).toBe(false)
    // "the 14th" cannot be said to be before "the 14th at six".
    expect(certainlyBefore(span('412-03-14'), span('412-03-14T18:00'))).toBe(false)
    // a month before one of its days is not certain either; the month before the next month is
    expect(certainlyBefore(span('412-03'), span('412-03-14'))).toBe(false)
    expect(certainlyBefore(span('412-03'), span('412-04-01'))).toBe(true)
    // years compare as numbers, not as text
    expect(certainlyBefore(span('99'), span('412'))).toBe(true)
  })

  it('makes a span of `until`, and ignores an `until` that runs backwards', () => {
    expect(certainlyBefore(span('412-03-01', '412-03-09'), span('412-03-10'))).toBe(true)
    expect(certainlyBefore(span('412-03-01', '412-03-12'), span('412-03-10'))).toBe(false)
    expect(span('412-03-14T18:00', '412-03-10').exact).toBe(true)
    expect(span('412-03-14T18:00', '412-03-15').exact).toBe(false)
  })

  it('is the same moment only for equal times known to the minute', () => {
    expect(sameMoment(span('412-03-14T18:00'), span('412-03-14T18:00'))).toBe(true)
    expect(sameMoment(span('412-03-14T18:00'), span('412-03-14T18:01'))).toBe(false)
    expect(sameMoment(span('412-03-14'), span('412-03-14'))).toBe(false)
    expect(overlaps(span('412-03-14'), span('412-03-14T18:00'))).toBe(true)
    expect(overlaps(span('412-03-14'), span('412-03-15T01:00'))).toBe(false)
  })

  it('never compares times of different calendars', () => {
    const other = 'cal_bbbbbbbbbb'
    expect(certainlyBefore(span('1', undefined, other), span('412'))).toBe(false)
    expect(overlaps(span('412', undefined, other), span('412'))).toBe(false)
    expect(sameMoment(span('412-03-14T18:00', undefined, other), span('412-03-14T18:00'))).toBe(
      false,
    )
  })

  it('writes a time in the calendar’s own words when it names its months', () => {
    const tide = { id: cal, name: 'Tide', era: 'TR', months: ['Thaw', 'Bloom'] }
    expect(keyWords('412-01-14T18:00', tide)).toBe('14 Thaw 412 TR, 18:00')
    expect(keyWords('412-02', tide)).toBe('Bloom 412 TR')
    expect(keyWords('412-03-14', { era: 'TR' })).toBe('412-03-14 TR')
    expect(
      timeWords({ calendar: cal, at: '412-01-14', until: '412-01-16', label: 'dusk' }, [tide]),
    ).toBe('14 Thaw 412 TR – 16 Thaw 412 TR · dusk')
  })
})

describe('years before the calendar starts (BCE)', () => {
  it('reads a minus sign as a year before the epoch, at every granularity', () => {
    expect(parseTimeKey('-44')).toEqual({ parts: [-44], granularity: 'year' })
    expect(parseTimeKey('-44-03-15T06:00')).toEqual({
      parts: [-44, 3, 15, 6, 0],
      granularity: 'minute',
    })
    expect(parseTimeKey('--44')).toBeUndefined()
    expect(parseTimeKey('4-4')).toBeUndefined()
  })

  it('puts years in time order: 500 BCE, 44 BCE, 1 BCE, 1 CE, 412 CE', () => {
    const keys = ['412', '-44', '1', '-500', '-1']
    const sorted = keys.map((k) => span(k)).sort(byStart)
    expect(sorted.map((s) => s.lo[0])).toEqual([-500, -44, -1, 1, 412])
    // and the months of one BCE year still run January to December
    expect(certainlyBefore(span('-44-03'), span('-44-04'))).toBe(true)
    expect(certainlyBefore(span('-44-04'), span('-44-03'))).toBe(false)
    expect(certainlyBefore(span('-44'), span('-43'))).toBe(true)
    expect(certainlyBefore(span('-43'), span('-44'))).toBe(false)
  })

  it('writes it in words: BCE for a plain calendar, "before TR" for one with an era of its own', () => {
    const tide = { id: cal, name: 'Tide', era: 'TR', months: ['Thaw', 'Bloom'] }
    expect(keyWords('-44')).toBe('44 BCE')
    expect(keyWords('-44-03-15')).toBe('44-03-15 BCE')
    expect(keyWords('-44-01-15T06:00', tide)).toBe('15 Thaw 44 before TR, 06:00')
    expect(keyWords('412-01-15', tide)).toBe('15 Thaw 412 TR')
    expect(beforeWords({ era: 'CE' })).toBe('BCE')
    expect(beforeWords({ era: 'AD' })).toBe('BC')
    expect(beforeWords()).toBe('BCE')
    expect(timeWords({ calendar: cal, at: '-44', until: '-43' }, [{ ...tide, months: [] }])).toBe(
      '44 before TR – 43 before TR',
    )
  })

  it('counts whole years, with no year 0 between 1 BCE and 1 CE', () => {
    expect(yearsBetween([412, 3, 14], [421, 3, 14])).toBe(9)
    expect(yearsBetween([412, 3, 14], [421, 3, 13])).toBe(8) // the day before the birthday
    expect(yearsBetween([-44], [-34])).toBe(10)
    expect(yearsBetween([-1], [1])).toBe(1) // 1 BCE to 1 CE is a year
    expect(yearsBetween([-10], [5])).toBe(14)
  })

  it('counts a stored year 0 as 1 BCE rather than a year of its own', () => {
    expect(yearsBetween([-1], [0])).toBe(0)
    expect(yearsBetween([0], [1])).toBe(1)
    expect(yearsBetween([-5], [0])).toBe(4) // 5 BCE to 1 BCE
    expect(yearsBetween([-5], [1])).toBe(5)
  })

  it('refuses year 0 in words, and a key that does not read', () => {
    expect(timeKeyProblem('412-03-14')).toBeUndefined()
    expect(timeKeyProblem('-44')).toBeUndefined()
    expect(timeKeyProblem('0')).toContain('There is no year 0')
    expect(timeKeyProblem('-0')).toContain('There is no year 0')
    expect(timeKeyProblem('0-03-14')).toContain('There is no year 0')
    expect(timeKeyProblem('dusk')).toBe(
      'That date is not complete. Fill the year first, then the month, day and time.',
    )
  })
})
