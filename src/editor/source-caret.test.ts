// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { blockAt } from './source-caret'

describe('where a caret in the Markdown stands in the editor', () => {
  const md = 'First para.\n\n| a | b |\n| - | - |\n\nLast one.\n'
  it('is the block it is in, and how far into it', () => {
    expect(blockAt(md, 0)).toEqual({ block: 0, offset: 1 })
    expect(blockAt(md, md.indexOf('| a'))).toEqual({ block: 1, offset: 1 })
    expect(blockAt(md, md.indexOf('b |'))).toEqual({ block: 1, offset: 7 })
    expect(blockAt(md, md.indexOf('Last') + 2)).toEqual({ block: 2, offset: 3 })
  })
  it('is the last block for a caret at the very end, and nothing for no text', () => {
    expect(blockAt(md, md.length)?.block).toBe(2)
    expect(blockAt('', 0)).toBeNull()
  })
})
