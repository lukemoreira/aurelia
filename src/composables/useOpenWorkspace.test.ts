// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { openedWhen } from './useOpenWorkspace'

describe('openedWhen', () => {
  const now = new Date(2026, 10, 12, 15, 0).getTime()
  it('says today, yesterday, then the date, each with the time', () => {
    expect(openedWhen(new Date(2026, 10, 12, 14, 32).getTime(), now)).toBe('today at 2:32 PM')
    expect(openedWhen(new Date(2026, 10, 11, 9, 10).getTime(), now)).toBe('yesterday at 9:10 AM')
    expect(openedWhen(new Date(2026, 9, 30, 12, 0).getTime(), now)).toBe('Oct 30 at 12:00 PM')
  })
})
