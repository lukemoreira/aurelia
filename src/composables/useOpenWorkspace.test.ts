// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { openedWhen } from './useOpenWorkspace'

describe('openedWhen', () => {
  const now = new Date(2026, 10, 12, 15, 0).getTime()
  it('says today, yesterday, then the date', () => {
    expect(openedWhen(new Date(2026, 10, 12, 8, 0).getTime(), now)).toBe('today')
    expect(openedWhen(new Date(2026, 10, 11, 23, 59).getTime(), now)).toBe('yesterday')
    expect(openedWhen(new Date(2026, 9, 30, 12, 0).getTime(), now)).toBe('Oct 30')
  })
})
