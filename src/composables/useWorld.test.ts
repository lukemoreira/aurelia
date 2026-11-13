// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addRecord } from '@/storage/record-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { useRecordSheet } from './useRecordSheet'
import { useWorld } from './useWorld'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

async function open(shared: boolean) {
  const rig = await outlineRig()
  if (shared) await rig.session.setFields(rig.session.data.universes[0]!.id, { kind: 'shared' })
  const ws = useWorkspaceStore()
  ws.attach(rig.session)
  ws.select(rig.session.data.books[0]!.id)
  return { ...rig, ws }
}

describe('New in World', () => {
  it('is one choice per kind in a standalone book: there is nothing to share with', async () => {
    await open(false)
    const items = useWorld().newItems.value
    expect(items.map((i) => i.label)).toContain('New character')
    expect(items.some((i) => /shared|this book only/.test(i.label))).toBe(false)
  })

  it('folds "shared" or "this book only" into the action in a shared universe', async () => {
    await open(true)
    const labels = useWorld().newItems.value.map((i) => i.label)
    expect(labels).toContain('New character — shared')
    expect(labels).toContain('New character — this book only')
  })

  it('a book-only choice makes a record private to the open book', async () => {
    const { session } = await open(true)
    useWorld().create('place:book')
    await useEditsStore().ask!.run('The Quay')
    const record = session.data.records.find((r) => r.meta.title === 'The Quay')!
    expect(record.meta.scope).toBe(`book:${session.data.books[0]!.id}`)
    useWorld().create('place:universe')
    await useEditsStore().ask!.run('The Fair')
    expect(session.data.records.find((r) => r.meta.title === 'The Fair')!.meta.scope).toBe(
      'universe',
    )
  })
})

describe('the record sheet’s scope pill', () => {
  it('says "In this book" on a standalone book, and "Shared · title" only in a shared universe', async () => {
    const { session } = await open(false)
    const unv = session.data.universes[0]!.id
    const id = await addRecord(session, { type: 'character', title: 'Elena', universeId: unv })
    expect(useRecordSheet(() => id).scope.value).toBe('In this book')
    await session.setFields(unv, { kind: 'shared' })
    expect(useRecordSheet(() => id).scope.value).toBe(
      `Shared · ${session.data.universes[0]!.title}`,
    )
    const own = await addRecord(session, {
      type: 'place',
      title: 'Quay',
      universeId: unv,
      bookId: session.data.books[0]!.id,
    })
    expect(useRecordSheet(() => own).scope.value).toBe(`Only in ${session.data.books[0]!.title}`)
  })
})
