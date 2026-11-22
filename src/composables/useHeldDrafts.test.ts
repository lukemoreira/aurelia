// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import type { Proposal } from '@/domain/proposals'
import { useHeldDrafts } from './useHeldDrafts'

const p = (id: string) => ({ id }) as Proposal

describe('suggestions the author is editing', () => {
  it('stay on screen when they go meanwhile, until the author lets their text go', async () => {
    const all = shallowRef<Proposal[]>([p('prp_a'), p('prp_b')])
    const d = useHeldDrafts(all)
    d.setDirty('prp_a', true)
    all.value = [] // a revision replaced both, or another device cleared them
    await nextTick()
    expect(d.held.value.map((x) => x.id)).toEqual(['prp_a']) // only the one with edited text
    expect(d.isGone('prp_a')).toBe(true)
    d.setDirty('prp_a', false)
    expect(d.held.value).toEqual([])
  })

  it('go as usual when the author accepted or dismissed them; a failed Accept keeps watching', async () => {
    const all = shallowRef<Proposal[]>([p('prp_a')])
    const d = useHeldDrafts(all)
    d.setDirty('prp_a', true)
    await d.decide('prp_a', async () => undefined) // refused: still listed
    all.value = []
    await nextTick()
    expect(d.held.value.map((x) => x.id)).toEqual(['prp_a'])

    const again = shallowRef<Proposal[]>([p('prp_b')])
    const e = useHeldDrafts(again)
    e.setDirty('prp_b', true)
    await e.decide('prp_b', async () => {
      again.value = []
    })
    await nextTick()
    expect(e.held.value).toEqual([])
  })
})
