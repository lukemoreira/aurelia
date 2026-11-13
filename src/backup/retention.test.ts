// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { versionsToDelete, type VersionStamp } from './retention'

const NOW = new Date('2026-11-12T18:30:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (
  msAgo: number,
  name = String(msAgo),
  extra: Partial<VersionStamp> = {},
): VersionStamp => ({
  name,
  at: new Date(NOW.getTime() - msAgo),
  ...extra,
})
const gone = (versions: VersionStamp[]) => versionsToDelete(versions, NOW).sort()

describe('version retention', () => {
  it('keeps one version in every hour for the first 2 days, and the newest of an hour only', () => {
    const hourly = [0, 1, 2, 10, 30, 47].map((h) => at(h * HOUR, `h${h}`))
    expect(gone(hourly)).toEqual([])
    // Two in the same hour: the older one goes.
    expect(
      gone([at(5 * HOUR + 45 * 60_000, 'older'), at(5 * HOUR + 35 * 60_000, 'newer')]),
    ).toEqual(['older'])
  })

  it('keeps one a day for 30 days', () => {
    // Three on the same day, 5 days ago (UTC 10:00, 14:00, 18:00 of Nov 7): the newest stays.
    const day = Date.UTC(2026, 10, 7)
    const v = (h: number) => ({ name: `d${h}`, at: new Date(day + h * HOUR) })
    expect(gone([v(10), v(14), v(18)])).toEqual(['d10', 'd14'])
    // Different days all stay.
    expect(gone([at(3 * DAY), at(4 * DAY), at(20 * DAY), at(29 * DAY)])).toEqual([])
  })

  it('keeps one a week for 6 months, weeks starting on Monday', () => {
    // Mon 2026-08-31 and Sun 2026-09-06 are one week; Mon 2026-09-07 is the next.
    const v = (iso: string) => ({ name: iso, at: new Date(`${iso}T09:00:00Z`) })
    expect(gone([v('2026-08-31'), v('2026-09-03'), v('2026-09-06'), v('2026-09-07')])).toEqual([
      '2026-08-31',
      '2026-09-03',
    ])
  })

  it('keeps the newest of every month for ever', () => {
    const v = (iso: string) => ({ name: iso, at: new Date(`${iso}T09:00:00Z`) })
    expect(gone([v('2024-03-02'), v('2024-03-20'), v('2025-03-02'), v('2025-04-01')])).toEqual([
      '2024-03-02',
    ])
  })

  it('keeps a version saved before a big change for 30 days, and then thins it like the rest', () => {
    const marked = (msAgo: number, name: string) => at(msAgo, name, { protectedFor30Days: true })
    expect(gone([at(1 * HOUR, 'newer'), marked(1 * HOUR + 60_000, 'before-restore')])).toEqual([])
    expect(gone([marked(10 * DAY + 1000, 'a'), at(10 * DAY, 'b')])).toEqual([])
    expect(gone([marked(40 * DAY + 1000, 'a'), at(40 * DAY, 'b')])).toEqual(['a'])
  })

  it('never removes the newest version, and has nothing to say about none', () => {
    expect(gone([])).toEqual([])
    expect(gone([at(0, 'only')])).toEqual([])
    const many = Array.from({ length: 200 }, (_, i) => at(i * 7 * HOUR, `v${i}`))
    expect(gone(many)).not.toContain('v0')
  })

  it('thins a long run of hourly versions to the rhythm', () => {
    const many = Array.from({ length: 24 * 40 }, (_, i) => at(i * HOUR, `v${i}`))
    const kept = many.length - gone(many).length
    // 48 hourly + about 28 daily + a few weeklies: far fewer than 960, far more than a handful.
    expect(kept).toBeGreaterThan(70)
    expect(kept).toBeLessThan(90)
  })

  it('a version before changes from another device is kept for a day, then thinned like the rest', () => {
    const sync = (msAgo: number, name: string) => at(msAgo, name, { protectedFor1Day: true })
    // Three in one hour, all inside the day: the protected ones stay beside the newest.
    expect(
      gone([at(30 * 60_000, 'hourly'), sync(50 * 60_000, 's1'), sync(40 * 60_000, 's2')]),
    ).toEqual([])
    // Past a day it is an ordinary version again.
    expect(
      gone([at(30 * HOUR + 10 * 60_000, 'hourly'), sync(30 * HOUR + 20 * 60_000, 'old')]),
    ).toEqual(['old'])
  })
})
