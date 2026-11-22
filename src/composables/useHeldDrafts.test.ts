// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import type { Proposal } from '@/domain/proposals'
import { resetDecided, useHeldDrafts } from './useHeldDrafts'

beforeEach(resetDecided)
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

  it('are not held when the author decided them in another place (the popup, not this inbox)', async () => {
    const all = shallowRef<Proposal[]>([p('prp_a')])
    const inbox = useHeldDrafts(all)
    const popup = useHeldDrafts(all)
    inbox.setDirty('prp_a', true)
    await popup.decide('prp_a', async () => {
      all.value = []
    })
    await nextTick()
    expect(inbox.held.value).toEqual([])
  })
})
