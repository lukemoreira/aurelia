// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { saltmarchSample, SAMPLE_START } from '@/sample/saltmarch'
import { proseBlocks } from './prose'

describe('proseBlocks', () => {
  it('indents every paragraph but the first and the one after a scene break', () => {
    const blocks = proseBlocks(
      'One two three four five six.\n\nSecond.\n\n* * *\n\nAfter the break.\n\nThen more.',
    )
    expect(blocks.map((b) => (b.kind === 'break' ? 'break' : b.indent))).toEqual([
      false,
      true,
      'break',
      false,
      true,
    ])
  })

  it('opens the first paragraph with five words in small capitals', () => {
    const [first, second] = proseBlocks(
      'The bells had already begun when Elena arrived.\n\nShort one here.',
    )
    expect(first).toMatchObject({
      lead: 'The bells had already begun',
      rest: ' when Elena arrived.',
    })
    expect(second).not.toHaveProperty('lead')
  })

  it('leaves a very short first paragraph whole', () => {
    expect(proseBlocks('Just this.')[0]).not.toHaveProperty('lead')
  })

  it('reads the sample scene: eight blocks with one break', () => {
    const body = saltmarchSample().scenes.find((s) => s.meta.id === SAMPLE_START.scene)!.body
    const blocks = proseBlocks(body)
    expect(blocks).toHaveLength(8)
    expect(blocks.filter((b) => b.kind === 'break')).toHaveLength(1)
  })

  it('ignores blank input', () => {
    expect(proseBlocks('  \n\n  ')).toEqual([])
  })
})
