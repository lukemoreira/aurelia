// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import * as checks from '@/domain/continuity-checks'
import { setDismissed } from '@/storage/story-actions'
import { useWorkspaceStore } from '@/stores/workspace'
import { id, story, type Sc } from '../../tests/helpers/continuity-fixture'
import { inComponent } from '../../tests/helpers/in-component'
import { useContinuity } from './useContinuity'
import { useContinuityModel } from './useContinuityModel'
import { useProgression } from './useProgression'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/storage/story-actions', () => ({ setDismissed: vi.fn(async () => undefined) }))
vi.mock('@/domain/continuity-checks', async (orig) => {
  const real = await orig<typeof import('@/domain/continuity-checks')>()
  return { ...real, continuityFindings: vi.fn(real.continuityFindings) }
})
beforeEach(() => {
  localStorage.clear()
  vi.mocked(setDismissed).mockClear()
  vi.mocked(checks.continuityFindings).mockClear()
})

const names = { characters: ['ana', 'bob'] }
// Ana dies at the end of book one and walks into book two: a finding that is only there across the universe.
// Book two also sets something up and never pays it off: a finding of that book alone.
const books: Sc[] = [
  {
    key: 'a1',
    book: 'one',
    ch: 'c1',
    pov: 'ana',
    changes: [{ who: 'ana', kind: 'status', value: 'dead' }],
  },
  {
    key: 'b1',
    book: 'two',
    ch: 'c1',
    pov: 'bob',
    add: ['ana'],
    changes: [{ kind: 'setup', id: 's1', value: 'The key' }],
  },
]

function open(bookIndex: number) {
  setActivePinia(createPinia())
  const s = story(books, { names })
  const ws = useWorkspaceStore()
  ws.load(s.data)
  ws.select(s.models[bookIndex]!.bookId)
  ws.session = {} as never // writes go to the mocked setDismissed
  return { s, ws }
}

describe('marking a finding intended, in this book and across the universe', () => {
  it('keeps a mark made across the universe when a finding of this book alone is marked: the list is cleaned of what no longer shows, not of what shows only in the whole universe', async () => {
    const { s } = open(1)
    const c = inComponent(() => useContinuity())
    const alone = c.certain.value.find((f) => f.check === 'setup-unpaid')!
    expect(alone).toBeTruthy()
    // the death carried from book one is found in the whole universe only
    const { universeFindings } = inComponent(() => useContinuityModel())
    const across = universeFindings.value!.all.find((f) => f.check === 'appears-after-exit')!
    expect(across.book).toBe(s.models[1]!.bookId)
    expect(c.certain.value.some((f) => f.check === 'appears-after-exit')).toBe(false)

    await c.dismiss(alone, true)
    const call = vi.mocked(setDismissed).mock.calls[0]!
    expect(call[1]).toBe(s.models[1]!.bookId)
    expect(call[2].add).toBe(alone.fingerprint)
    expect(call[2].found).toContain(alone.fingerprint)
    expect(call[2].found).toContain(across.fingerprint) // so setDismissed keeps its mark
  })

  it('a mark made across the universe changes only that one mark, in the finding’s own book', async () => {
    const { s } = open(1)
    const c = inComponent(() => useContinuity())
    c.scope.value = 'universe'
    await nextTick()
    const across = c.certain.value.find((f) => f.check === 'appears-after-exit')!
    expect(across.book).toBe(s.models[1]!.bookId)
    await c.dismiss(across, true)
    const call = vi.mocked(setDismissed).mock.calls[0]!
    expect(call[1]).toBe(s.models[1]!.bookId)
    expect(call[2].found).toEqual([across.fingerprint])
    expect(call[2].among?.('anything')).toBe(false) // it owns no other mark
  })
})

describe('reading a universe to draw a progression', () => {
  it('does not run the checks of every book: the story is read apart from its findings', async () => {
    open(0)
    const c = inComponent(() => useProgression(() => id.chr('ana')))
    c.scope.value = 'universe'
    await nextTick()
    expect(c.p.value!.scenes).toHaveLength(2) // the books end to end
    expect(checks.continuityFindings).not.toHaveBeenCalled()
    // the findings are there when a screen asks for them
    const { universeFindings } = inComponent(() => useContinuityModel())
    expect(universeFindings.value!.all.length).toBeGreaterThan(0)
    expect(checks.continuityFindings).toHaveBeenCalled()
  })
})
