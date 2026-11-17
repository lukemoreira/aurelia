// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import {
  certainlyBefore,
  keyWords,
  overlaps,
  parseTimeKey,
  sameMoment,
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
