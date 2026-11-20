// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { readLog, withDailyGoal, withStarts } from './writing-log'

const DAY = '2026-11-20'
const start = (words: number, at: string) => ({ words, at })

describe('the writing log file', () => {
  it('a missing or empty file is an empty log that may be written', () => {
    expect(readLog(undefined)).toEqual({ log: { dailyGoal: 0, days: {} } })
    expect(readLog('  \n')).toEqual({ log: { dailyGoal: 0, days: {} } })
  })

  it('records a book at its words, with the time, and the goal of the day', () => {
    const text = withStarts(undefined, DAY, 500, { a: start(1200, '2026-11-20T08:00:00.000Z') })
    expect(JSON.parse(text)).toEqual({
      schemaVersion: 1,
      days: { [DAY]: { goal: 500, start: { a: start(1200, '2026-11-20T08:00:00.000Z') } } },
    })
    expect(readLog(text).log.days[DAY]).toEqual({
      goal: 500,
      start: { a: start(1200, '2026-11-20T08:00:00.000Z') },
    })
  })

  it('merges two devices: the start recorded first stays, whichever is written last', () => {
    const phone = withStarts(undefined, DAY, 500, {
      a: start(1000, '2026-11-20T07:00:00.000Z'),
      b: start(10, '2026-11-20T09:00:00.000Z'),
    })
    // The laptop saw `a` later (after typing) and `b` earlier, and adds `c`.
    const merged = withStarts(phone, DAY, 800, {
      a: start(1400, '2026-11-20T08:00:00.000Z'),
      b: start(5, '2026-11-20T06:00:00.000Z'),
      c: start(0, '2026-11-20T08:30:00.000Z'),
    })
    expect(readLog(merged).log.days[DAY]).toEqual({
      goal: 500, // the day keeps the goal it was recorded with
      start: {
        a: start(1000, '2026-11-20T07:00:00.000Z'),
        b: start(5, '2026-11-20T06:00:00.000Z'),
        c: start(0, '2026-11-20T08:30:00.000Z'),
      },
    })
  })

  it('a new goal is the goal of today and from now on; earlier days keep theirs', () => {
    const before = withStarts(undefined, '2026-11-19', 300, {
      a: start(1, '2026-11-19T08:00:00.000Z'),
    })
    const after = readLog(withDailyGoal(before, DAY, 600)).log
    expect(after.dailyGoal).toBe(600)
    expect(after.days[DAY]?.goal).toBe(600)
    expect(after.days['2026-11-19']?.goal).toBe(300)
  })

  it('keeps keys it does not know, in the file, the day and the start', () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      note: 'mine',
      days: {
        [DAY]: {
          goal: 1,
          mood: 'good',
          start: { a: { words: 5, at: '2026-11-20T01:00:00.000Z', via: 'x' } },
        },
      },
    })
    const next = JSON.parse(
      withDailyGoal(withStarts(text, DAY, 9, { b: start(2, '2026-11-20T02:00:00.000Z') }), DAY, 7),
    )
    expect(next.note).toBe('mine')
    expect(next.days[DAY].mood).toBe('good')
    expect(next.days[DAY].start.a.via).toBe('x')
    expect(next.days[DAY].start.b.words).toBe(2)
  })

  it('never writes over a file from a newer Aurelia', () => {
    const newer = JSON.stringify({ schemaVersion: 2, dailyGoal: 400, days: {} })
    expect(readLog(newer).blocked).toBe('newer')
    expect(() => withDailyGoal(newer, DAY, 1)).toThrow(/newer Aurelia/)
    expect(() => withStarts(newer, DAY, 1, {})).toThrow(/newer Aurelia/)
  })

  it('never writes over a file it cannot read', () => {
    for (const bad of ['{ not json', '[]', '{"days": 3}', '"text"']) {
      expect(readLog(bad).blocked).toBe('unreadable')
      expect(() => withDailyGoal(bad, DAY, 1)).toThrow(/could not be read/)
    }
  })

  it('leaves out what in the file is not a day or a start, without refusing the rest', () => {
    const text = JSON.stringify({
      days: {
        today: { goal: 5 },
        [DAY]: { goal: 'x', start: { a: { words: -1, at: 't' }, b: start(3, 't') } },
      },
      dailyGoal: 250,
    })
    const read = readLog(text)
    expect(read.blocked).toBeUndefined()
    expect(read.log).toEqual({
      dailyGoal: 250,
      days: { [DAY]: { goal: 250, start: { b: start(3, 't') } } },
    })
  })
})
