// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { daysInARow, localDay, parseCount, wordsOn, type WritingLog } from './writing-log'

const at = (day: string) => `${day}T08:00:00.000Z`
/** A log from `[day, goal, { book: words at the start of that day }]`. */
const logOf = (...days: [string, number, Record<string, number>][]): WritingLog => ({
  dailyGoal: 0,
  days: Object.fromEntries(
    days.map(([day, goal, start]) => [
      day,
      {
        goal,
        start: Object.fromEntries(
          Object.entries(start).map(([b, words]) => [b, { words, at: at(day) }]),
        ),
      },
    ]),
  ),
})

describe('words written', () => {
  it('today is what the books hold now less what they held at the start', () => {
    const log = logOf(['2026-11-20', 500, { a: 1000, b: 200 }])
    expect(wordsOn(log, '2026-11-20', { a: 1300, b: 220 })).toBe(320)
  })

  it('a book first seen today starts at what it holds, so an import is not writing', () => {
    const log = logOf(['2026-11-20', 500, { a: 1000, imported: 80_000 }])
    expect(wordsOn(log, '2026-11-20', { a: 1100, imported: 80_000 })).toBe(100)
  })

  it('a past day runs to the next recorded day, whatever days have no record between', () => {
    const log = logOf(
      ['2026-11-10', 500, { a: 1000, b: 50 }],
      ['2026-11-14', 500, { a: 1400, b: 90 }],
      ['2026-11-20', 500, { a: 1500, b: 90 }],
    )
    expect(wordsOn(log, '2026-11-10', { a: 1600, b: 90 })).toBe(440)
    expect(wordsOn(log, '2026-11-14', { a: 1600, b: 90 })).toBe(100)
  })

  it('a book that is gone, or was not there on the day, adds nothing', () => {
    const log = logOf(
      ['2026-11-19', 0, { a: 100, gone: 500 }],
      ['2026-11-20', 0, { a: 150, new: 10 }],
    )
    expect(wordsOn(log, '2026-11-19', { a: 150 })).toBe(50)
  })

  it('a day never shows below 0', () => {
    const log = logOf(['2026-11-20', 500, { a: 1000, b: 0 }])
    expect(wordsOn(log, '2026-11-20', { a: 400, b: 100 })).toBe(0)
    expect(wordsOn(log, '2026-11-01', { a: 400 })).toBe(0)
  })
})

describe('days in a row', () => {
  const now = { a: 5000 }

  it('counts back from today once today’s goal is met', () => {
    const log = logOf(
      ['2026-11-18', 100, { a: 4000 }],
      ['2026-11-19', 100, { a: 4200 }],
      ['2026-11-20', 100, { a: 4400 }],
    )
    expect(daysInARow(log, '2026-11-20', { a: 4600 })).toBe(3)
  })

  it('starts from yesterday while today is not yet met', () => {
    const log = logOf(
      ['2026-11-18', 100, { a: 4000 }],
      ['2026-11-19', 100, { a: 4200 }],
      ['2026-11-20', 100, { a: 4400 }],
    )
    expect(daysInARow(log, '2026-11-20', { a: 4450 })).toBe(2)
  })

  it('stops at a missed day (written too little, or not opened at all)', () => {
    const log = logOf(
      ['2026-11-16', 100, { a: 3000 }],
      ['2026-11-17', 100, { a: 3200 }],
      ['2026-11-19', 100, { a: 3300 }],
      ['2026-11-20', 100, { a: 3500 }],
    )
    // The 18th was never recorded (the app was not opened), so the row ends at the 19th.
    expect(daysInARow(log, '2026-11-20', { a: 3700 })).toBe(2)
  })

  it('a day is judged by the goal it was recorded with', () => {
    const log = logOf(['2026-11-19', 100, { a: 4000 }], ['2026-11-20', 1000, { a: 4150 }])
    expect(daysInARow(log, '2026-11-20', { a: 4200 })).toBe(1)
  })

  it('with no goal any words count', () => {
    const log = logOf(['2026-11-19', 0, { a: 4000 }], ['2026-11-20', 0, { a: 4001 }])
    expect(daysInARow(log, '2026-11-20', { a: 4001 })).toBe(1)
    expect(daysInARow(log, '2026-11-20', { a: 4001 + 1 })).toBe(2)
    expect(daysInARow(logOf(['2026-11-20', 0, { a: 4000 }]), '2026-11-20', { a: 4000 })).toBe(0)
  })

  it('is 0 with nothing recorded', () => {
    expect(daysInARow({ dailyGoal: 500, days: {} }, '2026-11-20', now)).toBe(0)
  })
})

describe('numbers and dates', () => {
  it('reads a whole number as typed', () => {
    expect(parseCount('90,000')).toBe(90000)
    expect(parseCount(' 500 ')).toBe(500)
    expect(parseCount('')).toBe(0)
    expect(parseCount('1.5')).toBeUndefined()
    expect(parseCount('-3')).toBeUndefined()
    expect(parseCount('lots')).toBeUndefined()
  })

  it('a date is the device’s own calendar day', () => {
    expect(localDay(new Date(2026, 10, 3, 23, 59))).toBe('2026-11-03')
  })
})
