// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageError } from '@/storage/errors'
import { setDetails } from '@/storage/outline-actions'
import { nextTick } from 'vue'
import { snapshot, changes } from '../../tests/helpers/outline-rig'
import { storyRig } from '../../tests/helpers/story-rig'
import { inComponent } from '../../tests/helpers/in-component'
import { NONE, useItemDetails } from './useItemDetails'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
beforeEach(() => localStorage.clear())

const meta = (r: Awaited<ReturnType<typeof storyRig>>, id: string) =>
  r.session.data.scenes.find((s) => s.meta.id === id)!.meta

describe('the details of a scene, a chapter and a book', () => {
  it('a scene’s objective, conflict, outcome and word target are each one key of its file', async () => {
    const r = await storyRig()
    const d = inComponent(() => useItemDetails('scene', () => r.left))
    const before = await snapshot(r.adapter)
    d.draft.objective = 'Get through the gate.'
    await d.saveText('objective')
    d.draft.conflict = 'The warden knows her face.'
    await d.saveText('conflict')
    d.draft.outcome = 'She owes him.'
    await d.saveText('outcome')
    d.draft.target = '1,800'
    await d.saveTarget()
    await r.session.flush()
    expect(meta(r, r.left)).toMatchObject({
      objective: 'Get through the gate.',
      conflict: 'The warden knows her face.',
      outcome: 'She owes him.',
      target: 1800,
    })
    expect(changes(before, await snapshot(r.adapter)).changed).toEqual([
      `books/${r.book}/scenes/${r.left}.md`,
    ])
    d.draft.objective = ''
    await d.saveText('objective')
    expect(meta(r, r.left).objective).toBeUndefined()
  })

  it('a word target that is not a whole number is refused in words and not saved', async () => {
    const r = await storyRig()
    const d = inComponent(() => useItemDetails('scene', () => r.left))
    d.draft.target = 'lots'
    await d.saveTarget()
    expect(d.error.value).toContain('whole number')
    expect(meta(r, r.left).target).toBeUndefined()
    d.draft.target = '0'
    await d.saveTarget()
    expect(meta(r, r.left).target).toBeUndefined() // 0 is no target
  })

  it('a chapter has an objective, a target and arcs; a part has neither', async () => {
    const r = await storyRig()
    const d = inComponent(() => useItemDetails('chapter', () => r.chapter))
    d.draft.objective = 'Arrive.'
    await d.saveText('objective')
    d.draft.target = '5000'
    await d.saveTarget()
    d.arcs.value = ['arc_0123456789']
    await r.session.flush()
    expect(r.session.data.chapters[0]).toMatchObject({
      objective: 'Arrive.',
      target: 5000,
      arcs: ['arc_0123456789'],
    })
    expect(d.arcs.value).toEqual(['arc_0123456789'])
  })

  it('a scene’s status and point of view can be cleared', async () => {
    const r = await storyRig()
    const d = inComponent(() => useItemDetails('scene', () => r.left))
    d.status.value = 'final'
    await vi.waitFor(() => expect(meta(r, r.left).status).toBe('final'))
    d.status.value = NONE
    await vi.waitFor(() => expect(meta(r, r.left).status).toBeUndefined())
  })

  it('a save landing in one field leaves the words typed in the others alone', async () => {
    const r = await storyRig()
    const d = inComponent(() => useItemDetails('scene', () => r.left))
    d.draft.objective = 'Typed, not saved yet.'
    d.draft.conflict = 'Also typed.'
    d.draft.summary = 'One line.'
    await d.saveText('summary')
    await nextTick()
    expect(meta(r, r.left).summary).toBe('One line.')
    expect(d.draft.objective).toBe('Typed, not saved yet.')
    expect(d.draft.conflict).toBe('Also typed.')
    await d.saveText('objective') // and then those save too, from what was typed
    expect(meta(r, r.left).objective).toBe('Typed, not saved yet.')
  })

  it('a change made elsewhere reaches a field the author is not editing, and not one they are', async () => {
    const r = await storyRig()
    const d = inComponent(() => useItemDetails('scene', () => r.left))
    d.draft.conflict = 'Mine.'
    await setDetails(r.session, r.left, { objective: 'From another device.', conflict: 'Theirs.' })
    await nextTick()
    expect(d.draft.objective).toBe('From another device.')
    expect(d.draft.conflict).toBe('Mine.')
  })

  it('a save that fails keeps what was typed and says why', async () => {
    const r = await storyRig()
    const d = inComponent(() => useItemDetails('scene', () => r.left))
    vi.spyOn(r.session, 'setFields').mockRejectedValueOnce(
      new StorageError('other', 'The disk said no.'),
    )
    d.draft.objective = 'A paragraph that took a while.'
    await d.saveText('objective')
    expect(d.error.value).toBe('The disk said no.')
    expect(d.draft.objective).toBe('A paragraph that took a while.')
    await d.saveText('objective') // tried again, it saves
    expect(meta(r, r.left).objective).toBe('A paragraph that took a while.')
  })

  it('a book can be switched between straight and branching', async () => {
    const r = await storyRig()
    const d = inComponent(() => useItemDetails('book', () => r.book))
    expect(d.branching.value).toBe(true)
    d.branching.value = false
    await vi.waitFor(() => expect(r.session.data.books[0]!.mode).toBe('linear'))
    d.branching.value = true
    await vi.waitFor(() => expect(r.session.data.books[0]!.mode).toBe('branching'))
  })
})
