// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { patchListItem } from './yaml-edit'

const LIST = `---
title: Gate
schemaVersion: 1
choices:
  # the first way out
  - { id: "chc_a", label: "Pay", target: "scn_1" }   # the safe one
  - { id: "chc_b", label: "Climb", target: "scn_2", note: "old way" }
  - { id: "chc_c", label: "Wait", target: "scn_3" }
mood: 'wet, grey'   # a key Aurelia does not know
---

Body.
`

describe('patchListItem', () => {
  it('changes one item and nothing else: the comments, the other items and the other keys stay', () => {
    const edited = patchListItem(LIST, 'choices', {
      op: 'update',
      id: 'chc_b',
      fields: { label: 'Swim' },
    })
    expect(edited).toBe(LIST.replace('label: "Climb"', 'label: "Swim"'))
    expect(edited).toContain('# the first way out')
    expect(edited).toContain('# the safe one')
  })

  it('keeps what else is on the item, and takes one item away by its line', () => {
    expect(patchListItem(LIST, 'choices', { op: 'remove', id: 'chc_a' })).toBe(
      LIST.replace('  - { id: "chc_a", label: "Pay", target: "scn_1" }   # the safe one\n', ''),
    )
    expect(
      patchListItem(LIST, 'choices', { op: 'update', id: 'chc_b', fields: { target: 'scn_9' } }),
    ).toContain('{ id: "chc_b", label: "Climb", target: "scn_9", note: "old way" }')
  })

  it('adds an item after the last one, in the list’s own indentation', () => {
    expect(
      patchListItem(LIST, 'choices', {
        op: 'add',
        item: { id: 'chc_d', label: 'Run', target: 'scn_4' },
      }),
    ).toBe(
      LIST.replace(
        'target: "scn_3" }\n',
        'target: "scn_3" }\n  - { id: "chc_d", label: "Run", target: "scn_4" }\n',
      ),
    )
  })

  it('says it cannot (so the caller sets the whole key): no list, a flow list, no such item, the last item going, no frontmatter', () => {
    const one = '---\ntitle: x\nchoices:\n  - { id: "chc_a", label: "A", target: "scn_1" }\n---\n'
    expect(patchListItem(one, 'choices', { op: 'remove', id: 'chc_a' })).toBeUndefined()
    expect(
      patchListItem('---\ntitle: x\n---\n', 'choices', { op: 'add', item: { id: 'chc_a' } }),
    ).toBeUndefined()
    expect(
      patchListItem('---\ntitle: x\nchoices: [ { id: "chc_a" } ]\n---\n', 'choices', {
        op: 'remove',
        id: 'chc_a',
      }),
    ).toBeUndefined()
    expect(
      patchListItem(LIST, 'choices', { op: 'update', id: 'chc_zz', fields: {} }),
    ).toBeUndefined()
    expect(patchListItem('no frontmatter', 'choices', { op: 'remove', id: 'x' })).toBeUndefined()
  })

  it('keeps CRLF line endings', () => {
    const crlf = LIST.replace(/\n/g, '\r\n')
    expect(patchListItem(crlf, 'choices', { op: 'remove', id: 'chc_c' })).toBe(
      crlf.replace('  - { id: "chc_c", label: "Wait", target: "scn_3" }\r\n', ''),
    )
  })

  describe('an item that ends in a block scalar', () => {
    const block = (style: string) => `---
title: Gate
changes:
  - kind: knows
    who: chr_a
    quote: ${style}
      first line
      second line
  - { kind: "goal", who: "chr_a", value: "middle" }
  - kind: trait
    who: chr_a
    quote: ${style}
      last words
mood: grey
---

Body.
`
    for (const style of ['|', '>', '|-']) {
      it(`is left to the caller (${style}): every edit of the first, middle and last item answers undefined, never a broken file`, () => {
        const text = block(style)
        for (const at of [0, 2]) {
          expect(patchListItem(text, 'changes', { op: 'remove', at })).toBeUndefined()
          expect(
            patchListItem(text, 'changes', { op: 'update', at, fields: { who: 'chr_b' } }),
          ).toBeUndefined()
        }
        // adding after a last item that ends in a block scalar
        expect(
          patchListItem(text, 'changes', { op: 'add', item: { kind: 'knows' } }),
        ).toBeUndefined()
      })
    }

    it('still edits an item beside them in place, and reads back as exactly the list meant', () => {
      const text = block('|')
      const out = patchListItem(text, 'changes', { op: 'remove', at: 1 })!
      expect(out).toContain('first line')
      expect(out).toContain('last words')
      expect(out).not.toContain('middle')
    })
  })
})
