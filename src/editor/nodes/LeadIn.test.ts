// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { schema } from '../extensions'
import { bodyToDoc } from '../markdown/body'
import { leadInRange } from './LeadIn'

const doc = (md: string) => schema.nodeFromJSON(bodyToDoc(md))

describe('the small-capitals lead of a scene', () => {
  it('covers the first five words of a first paragraph that is long enough', () => {
    const d = doc('The bells had already begun when Elena arrived at the gate.')
    const r = leadInRange(d)!
    expect(d.textBetween(r.from, r.to)).toBe('The bells had already begun')
  })
  it('leaves a short first paragraph whole, and a first block that is not a paragraph', () => {
    expect(leadInRange(doc('Just this.'))).toBeNull()
    expect(
      leadInRange(doc('# Title of the scene that is long enough to have a lead in it\n')),
    ).toBeNull()
  })
  it('does not guess where the words are when the paragraph holds more than text', () => {
    expect(
      leadInRange(doc('One two three four five six\\\nseven eight nine ten eleven.')),
    ).toBeNull()
  })
})
