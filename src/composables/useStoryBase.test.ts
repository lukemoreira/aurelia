// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOf } from '@/domain/story-base'
import { CHANGED_ELSEWHERE, setBaseSection } from '@/storage/story-base-actions'
import { useWorkspaceStore } from '@/stores/workspace'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { useStoryBase } from './useStoryBase'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 502 })),
  )
  setActivePinia(createPinia())
})

async function rig() {
  const { session, adapter } = await outlineRig()
  const ws = useWorkspaceStore()
  ws.attach(session)
  const bookId = session.data.books[0]!.id
  ws.select(bookId, session.data.scenes[0]!.meta.id)
  return { session, adapter, bookId, b: useStoryBase() }
}

describe('a section another device changes while the author types in it', () => {
  it('is not written over by the save: the author is told and keeps their words; saving again replaces it', async () => {
    const { session, bookId, b } = await rig()
    b.draft.world = 'Mine.' // typing
    await setBaseSection(session, bookId, 'world', 'Theirs.', '') // a sync brings this in
    await nextTick()
    expect(b.draft.world).toBe('Mine.')
    await b.save('world')
    expect(b.error.value).toBe(CHANGED_ELSEWHERE)
    expect(baseOf(session.data.books[0]).world).toBe('Theirs.')
    expect(b.draft.world).toBe('Mine.')
    await b.save('world') // told, and saved again on purpose
    expect(baseOf(session.data.books[0]).world).toBe('Mine.')
  })

  it('a save that could not finish yet is not taken for another device’s change', async () => {
    const { session, adapter, b } = await rig()
    let down = true
    adapter.beforeWrite = (path) => {
      if (down && path.endsWith('book.json')) throw new Error('disk busy')
    }
    b.draft.world = 'A'
    await b.save('world')
    expect(b.error.value).not.toBe('')
    b.draft.world = 'AB'
    down = false
    await b.save('world')
    expect(b.error.value).not.toBe(CHANGED_ELSEWHERE)
    expect(baseOf(session.data.books[0]).world).toBe('AB')
  })

  it('a section the author is not typing in follows the files', async () => {
    const { session, bookId, b } = await rig()
    await setBaseSection(session, bookId, 'narrative', 'From elsewhere.', '')
    await nextTick()
    expect(b.draft.narrative).toBe('From elsewhere.')
    b.draft.narrative = 'Edited.'
    await b.save('narrative')
    expect(b.error.value).toBe('')
    await setBaseSection(session, bookId, 'narrative', 'Again elsewhere.', 'Edited.')
    await nextTick()
    expect(b.draft.narrative).toBe('Again elsewhere.')
  })
})
