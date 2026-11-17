// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { StorageError } from '@/storage/errors'
import { updateChoice } from '@/storage/story-actions'
import { storyRig } from '../../tests/helpers/story-rig'
import { inComponent } from '../../tests/helpers/in-component'
import { GONE, NEW_SCENE, useChoices } from './useChoices'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
beforeEach(() => localStorage.clear())

describe('a scene’s choices, as the inspector edits them', () => {
  it('adds one that leads to a new scene by default, named after the choice', async () => {
    const r = await storyRig()
    const c = inComponent(() => useChoices(() => r.start))
    expect(c.add.target).toBe(NEW_SCENE)
    c.add.label = 'Climb the aqueduct'
    await c.addNow()
    expect(c.choices.value).toHaveLength(1)
    const made = r.session.data.scenes.find((s) => s.meta.id === c.choices.value[0]!.target)!
    expect(made.meta).toMatchObject({ title: 'Climb the aqueduct', chapter: r.chapter })
    expect(c.add.label).toBe('') // the form is ready for the next one
    expect(c.labels[c.choices.value[0]!.id]).toBe('Climb the aqueduct')
  })

  it('empties the form as the choice is sent; one sent while the first saves is added after it, never dropped', async () => {
    const r = await storyRig()
    const c = inComponent(() => useChoices(() => r.start))
    c.add.label = 'Go left'
    const first = c.addNow()
    expect(c.add.label).toBe('')
    const twice = c.addNow() // the same press twice: nothing more to add, and no error
    c.add.label = 'Go right'
    const again = c.addNow() // while the first is still being written
    expect(c.add.label).toBe('')
    await Promise.all([first, twice, again])
    expect(c.choices.value.map((x) => x.label)).toEqual(['Go left', 'Go right'])
    expect(c.error.value).toBe('')
    expect(new Set(c.choices.value.map((x) => x.target)).size).toBe(2) // each to its own new scene
  })

  it('an empty choice is refused in words, and nothing is added', async () => {
    const r = await storyRig()
    const c = inComponent(() => useChoices(() => r.start))
    c.add.label = '   '
    await c.addNow()
    expect(c.error.value).toContain('reader’s words')
    expect(c.choices.value).toHaveLength(0)
    expect(c.add.label).toBe('   ') // what was typed is put back
    expect(r.session.data.scenes).toHaveLength(3)
  })

  it('changes the words when the author leaves the field, and the target when one is picked; an empty label is refused in words', async () => {
    const r = await storyRig()
    const c = inComponent(() => useChoices(() => r.start))
    c.add.label = 'Go left'
    c.add.target = r.left
    await c.addNow()
    const id = c.choices.value[0]!.id
    c.labels[id] = 'Take the left door'
    await c.relabel(id)
    expect(c.choices.value[0]!.label).toBe('Take the left door')
    await c.retarget(id, r.right)
    expect(c.choices.value[0]!.target).toBe(r.right)
    c.labels[id] = ''
    await c.relabel(id)
    expect(c.error.value).not.toBe('')
    expect(c.labels[id]).toBe('') // what was typed stays, to be mended
  })

  it('a save that fails keeps every typed label, and so does a save of another choice', async () => {
    const r = await storyRig()
    const c = inComponent(() => useChoices(() => r.start))
    const ids: string[] = []
    for (const label of ['One', 'Two']) {
      c.add.label = label
      c.add.target = r.left
      await c.addNow()
    }
    for (const x of c.choices.value) ids.push(x.id)
    // typing in the second while the first is saved: the first save must not take the second's words
    c.labels[ids[0]!] = 'One, changed'
    c.labels[ids[1]!] = 'Two, being typed'
    await c.relabel(ids[0]!)
    expect(c.choices.value[0]!.label).toBe('One, changed')
    expect(c.labels[ids[1]!]).toBe('Two, being typed')
    // a failed save keeps the words and says why
    vi.spyOn(r.session, 'setFields').mockRejectedValueOnce(
      new StorageError('other', 'The disk said no.'),
    )
    vi.spyOn(r.session, 'write').mockRejectedValueOnce(
      new StorageError('other', 'The disk said no.'),
    )
    await c.relabel(ids[1]!)
    expect(c.error.value).toBe('The disk said no.')
    expect(c.labels[ids[1]!]).toBe('Two, being typed')
  })

  it('a change made elsewhere reaches a label the author is not editing, and not one they are', async () => {
    const r = await storyRig()
    const c = inComponent(() => useChoices(() => r.start))
    for (const label of ['One', 'Two']) {
      c.add.label = label
      c.add.target = r.left
      await c.addNow()
    }
    const [a, b] = c.choices.value.map((x) => x.id) as [string, string]
    c.labels[a] = 'Mine, being typed'
    await updateChoice(r.session, r.start, a, { label: 'Theirs A' })
    await updateChoice(r.session, r.start, b, { label: 'Theirs B' })
    await nextTick()
    expect(c.labels[a]).toBe('Mine, being typed')
    expect(c.labels[b]).toBe('Theirs B')
  })

  it('a failed save after a new scene was made leads the next try to that scene, not to another', async () => {
    const r = await storyRig()
    const c = inComponent(() => useChoices(() => r.start))
    const real = r.session.setFields.bind(r.session)
    let fail = true
    vi.spyOn(r.session, 'setFields').mockImplementation((id, patch) => {
      if (!fail || !('choices' in patch)) return real(id, patch)
      fail = false
      return Promise.reject(new StorageError('other', 'The disk said no.'))
    })
    c.add.label = 'Climb'
    await c.addNow()
    expect(c.error.value).toBe('The disk said no.')
    expect(c.add.label).toBe('Climb') // put back
    expect(r.session.data.scenes).toHaveLength(4) // the scene exists
    await c.addNow()
    expect(c.error.value).toBe('')
    expect(r.session.data.scenes).toHaveLength(4) // and the retry used it
    expect(c.choices.value[0]!.target).toBe(
      r.session.data.scenes.find((s) => s.meta.title === 'Climb')!.meta.id,
    )
  })

  it('picking the line for a scene that is gone changes nothing and says nothing', async () => {
    const r = await storyRig()
    const c = inComponent(() => useChoices(() => r.start))
    c.add.label = 'Go left'
    c.add.target = r.left
    await c.addNow()
    await c.retarget(c.choices.value[0]!.id, GONE)
    expect(c.error.value).toBe('')
    expect(c.choices.value[0]!.target).toBe(r.left)
  })

  it('offers every scene of the book as a target, and a line for one that is gone', async () => {
    const r = await storyRig()
    const c = inComponent(() => useChoices(() => r.start))
    expect(c.addOptions.value.map((o) => o.label)).toEqual([
      'A new scene',
      '1.1 · Start',
      '1.2 · Left',
      '1.3 · Right',
    ])
    expect(c.targetOf('scn_0000000000')).toBe(GONE)
    expect(c.optionsFor('scn_0000000000')[0]!.label).toBe('A scene that is no longer here')
    expect(c.targetOf(r.left)).toBe(r.left)
  })

  it('removes a choice, marks an ending and moves the start', async () => {
    const r = await storyRig()
    const c = inComponent(() => useChoices(() => r.left))
    expect(c.isStart.value).toBe(false)
    await c.makeStart()
    expect(c.isStart.value).toBe(true)
    expect(r.session.data.books[0]!.start).toBe(r.left)
    c.ending.value = true
    await nextTick()
    await vi.waitFor(() => expect(c.ending.value).toBe(true))
    c.add.label = 'Back'
    c.add.target = r.start
    await c.addNow()
    await c.remove(c.choices.value[0]!.id)
    expect(c.choices.value).toHaveLength(0)
  })

  it('the first scene is the start until one is chosen', async () => {
    const r = await storyRig()
    const first = inComponent(() => useChoices(() => r.start))
    expect(first.isStart.value).toBe(true)
  })
})
