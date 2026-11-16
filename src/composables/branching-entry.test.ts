// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditsStore } from '@/stores/edits'
import { setBookMode } from '@/storage/story-actions'
import { inComponent } from '../../tests/helpers/in-component'
import { storyRig } from '../../tests/helpers/story-rig'
import { useOutlineEdits } from './useOutlineEdits'
import { usePalette } from './usePalette'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace: push, currentRoute: { value: { name: 'write' } } }),
}))
beforeEach(() => {
  localStorage.clear()
  push.mockReset()
})

describe('the way into the story map of a straight book', () => {
  it('the palette offers "Make this a branching story", which switches the book and goes to the map', async () => {
    const r = await storyRig()
    await setBookMode(r.session, r.book, 'linear')
    const p = inComponent(() => usePalette())
    const item = p.items.value.find((i) => i.id === 'action:make-branching')
    expect(item?.title).toBe('Make this a branching story')
    // …and it is not a Go to Story map while the book is straight
    expect(p.items.value.some((i) => i.id === 'action:view-map')).toBe(false)
    item!.run()
    await vi.waitFor(() => expect(r.session.data.books[0]!.mode).toBe('branching'))
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith(`/w/${r.book}/map`))
  })

  it('is not offered for a branching book', async () => {
    const r = await storyRig()
    expect(r.session.data.books[0]!.mode).toBe('branching')
    const p = inComponent(() => usePalette())
    expect(p.items.value.some((i) => i.id === 'action:make-branching')).toBe(false)
  })
})

describe('a new book can be a branching story from the start', () => {
  it('asks, and writes the mode the author chose', async () => {
    const r = await storyRig()
    const edit = inComponent(() => useOutlineEdits())
    const edits = useEditsStore()
    edit.newBook(true)
    expect(edits.ask?.offerBranching).toBe(true)
    await edits.ask!.run('The Game', true)
    await edits.ask!.run('The Novel', false)
    const mode = (t: string) => r.session.data.books.find((b) => b.title === t)!.mode
    expect(mode('The Game')).toBe('branching')
    expect(mode('The Novel')).toBe('linear')
  })
})
