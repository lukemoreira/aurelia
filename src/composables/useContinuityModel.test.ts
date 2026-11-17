// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addChange } from '@/storage/continuity-actions'
import { storyRig } from '../../tests/helpers/story-rig'
import { inComponent } from '../../tests/helpers/in-component'
import { useContinuityModel } from './useContinuityModel'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe('the open book, read for continuity', () => {
  it('reads again at once when anything but the words of a scene changes', async () => {
    const r = await storyRig()
    const c = inComponent(() => useContinuityModel())
    const before = c.model.value
    expect(before?.scenes).toHaveLength(3)
    await addChange(r.session, r.start, { kind: 'knows', who: 'chr_aaaaaaaaaa', value: 'x' })
    expect(c.model.value).not.toBe(before)
    expect(c.model.value?.changes(r.start)).toHaveLength(1)
  })

  it('waits out typing: a keystroke does not read a long book again, the pause does', async () => {
    const r = await storyRig()
    const c = inComponent(() => useContinuityModel())
    const before = c.model.value
    vi.useFakeTimers()
    r.ws.editScene(r.start, 'Elena walked in.')
    r.ws.editScene(r.start, 'Elena walked in. Then out.')
    expect(c.model.value).toBe(before) // the words changed, nothing the checks read from the scene's details did
    await vi.advanceTimersByTimeAsync(500)
    expect(c.model.value).not.toBe(before)
  })

  it('splits what the author marked intended from what is open', async () => {
    const r = await storyRig()
    const c = inComponent(() => useContinuityModel())
    const first = c.all.value[0]! // the story map's: this branching book has a dead end
    expect(first).toBeTruthy()
    expect(c.split.value.active).toContain(first)
    await r.session.setFields(r.book, { dismissedFindings: [first.fingerprint] })
    expect(c.split.value.dismissed.map((f) => f.fingerprint)).toEqual([first.fingerprint])
  })
})
