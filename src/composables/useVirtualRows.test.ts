// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { visibleRange } from './useVirtualRows'

describe('which rows are drawn', () => {
  it('the ones in view and a few beyond, however long the book is', () => {
    expect(visibleRange(1000, 44, 0, 600, 8)).toEqual({ start: 0, end: 22 })
    const mid = visibleRange(1000, 44, 4400, 600, 8) // 100 rows down
    expect(mid).toEqual({ start: 92, end: 122 })
    expect(mid.end - mid.start).toBeLessThan(40)
  })

  it('never goes past the ends, and a short list is drawn whole', () => {
    expect(visibleRange(1000, 44, 43_956, 600, 8).end).toBe(1000)
    expect(visibleRange(5, 44, 0, 600, 8)).toEqual({ start: 0, end: 5 })
    expect(visibleRange(0, 44, 0, 600, 8)).toEqual({ start: 0, end: 0 })
    // scrolled further than a list that has since shrunk
    const gone = visibleRange(3, 44, 9000, 600, 8)
    expect(gone.start).toBeLessThanOrEqual(gone.end)
    expect(gone.end).toBeLessThanOrEqual(3)
  })
})
