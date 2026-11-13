// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saltmarchSample, SAMPLE_START } from '@/sample/saltmarch'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { addChapter, renameItem } from '@/storage/outline-actions'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { useOutlineEdits } from './useOutlineEdits'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push, replace: push }) }))

beforeEach(() => {
  localStorage.clear()
  push.mockReset()
  setActivePinia(createPinia())
})

async function real() {
  const rig = await outlineRig()
  const ws = useWorkspaceStore()
  ws.attach(rig.session)
  const book = rig.session.data.books[0]!.id
  ws.select(book)
  await renameItem(rig.session, rig.session.data.chapters[0]!.id, 'One')
  await addChapter(rig.session, book, { title: 'Two' })
  return { ...rig, ws, book, edit: useOutlineEdits(), edits: useEditsStore() }
}

describe('the sample is a tour', () => {
  it('offers no row menu and no edits', () => {
    const ws = useWorkspaceStore()
    ws.loadSample()
    ws.select(SAMPLE_START.book, SAMPLE_START.scene)
    const edit = useOutlineEdits()
    expect(edit.canEdit.value).toBe(false)
    expect(edit.rowMenu(saltmarchSample().scenes[0]!.meta.id)).toEqual([])
    expect(edit.rowMenu(SAMPLE_START.book)).toEqual([])
  })
})

describe('row menus', () => {
  it('say what each row can do: a first scene cannot move up; every row can reach Recently deleted', async () => {
    const { edit, session, ws } = await real()
    const ids = (title: string) => ws.data!.chapters.find((c) => c.title === title)!.id
    const labels = (id: string) => edit.rowMenu(id).map((i) => [i.id, !!i.disabled])
    expect(labels(ids('One'))).toEqual([
      ['rename', false],
      ['new-scene', false],
      ['up', true],
      ['down', false],
      ['delete', false],
      ['trash', false],
    ])
    expect(labels(ids('Two')).find(([id]) => id === 'down')).toEqual(['down', true])
    // the last book can be asked to go: it is refused in words (below), not by a greyed item
    expect(labels(session.data.books[0]!.id).find(([id]) => id === 'delete')).toEqual([
      'delete',
      false,
    ])
    const scene = session.data.scenes.find((s) => s.meta.chapter === ids('One'))!.meta.id
    expect(edit.rowMenu(scene).map((i) => i.id)).toEqual([
      'rename',
      'up',
      'down',
      'move',
      'delete',
      'trash',
    ])
    const up = edit.rowMenu(scene).find((i) => i.id === 'up')!
    expect(up.icon).toBe('chevron-up')
    expect(up.shortcut).toMatch(/^(Alt|⌥) ↑$/)
    const trash = edit.rowMenu(session.data.records[0]?.meta.id ?? ids('One')).at(-1)
    expect(trash).toMatchObject({ id: 'trash', label: 'Recently deleted…' })
  })

  it('are empty when the workspace cannot be written to', async () => {
    const { edit, ws } = await real()
    ws.session!.dispose()
    // another tab holds the workspace: read-only
    ;(ws.session as unknown as { otherTab: boolean }).otherTab = true
    ws.view = ws.session!.view()
    expect(edit.canEdit.value).toBe(false)
    expect(edit.rowMenu(ws.data!.chapters[0]!.id)).toEqual([])
  })
})

describe('deleting from the navigator', () => {
  it('says what moved, offers Undo, and Undo brings it back', async () => {
    const { edit, edits, ws } = await real()
    const two = ws.data!.chapters.find((c) => c.title === 'Two')!.id
    edit.onAction(two, 'delete')
    await vi.waitFor(() => expect(edits.toast?.text).toBe('Moved “Two” to Recently deleted.'))
    expect(ws.data!.chapters.map((c) => c.title)).toEqual(['One'])
    await edits.toast!.undo!()
    await vi.waitFor(() =>
      expect(ws.data!.chapters.map((c) => c.title).sort()).toEqual(['One', 'Two']),
    )
  })

  it('tells the author, in words, why the last book stays', async () => {
    const { edit, edits, ws } = await real()
    edit.onAction(ws.bookId!, 'delete')
    await vi.waitFor(() => expect(edits.toast?.error).toBe(true))
    expect(edits.toast?.text).toMatch(/at least one book/)
    expect(ws.data!.books).toHaveLength(1)
  })
})

describe('what a delete from the keyboard does', () => {
  it('asks for focus on Undo only when a key made it', async () => {
    const { edit, edits, ws } = await real()
    const two = ws.data!.chapters.find((c) => c.title === 'Two')!.id
    edit.onAction(two, 'delete', true)
    await vi.waitFor(() => expect(edits.toast?.focusUndo).toBe(true))
    await edits.toast!.undo!()
    await vi.waitFor(() => expect(ws.data!.chapters).toHaveLength(2))
    edit.onAction(two, 'delete')
    await vi.waitFor(() => expect(edits.toast?.text).toMatch(/Moved “Two”/))
    expect(edits.toast?.focusUndo).toBe(false)
  })

  it('opens Recently deleted from a row’s menu', async () => {
    const { edit, edits, ws } = await real()
    edit.onAction(ws.data!.chapters[0]!.id, 'trash')
    expect(edits.trashOpen).toBe(true)
  })
})

describe('moves are said', () => {
  it('a step, a drop and a move to a chapter each announce where the row went', async () => {
    const { edit, edits, ws } = await real()
    const one = ws.data!.chapters.find((c) => c.title === 'One')!.id
    const two = ws.data!.chapters.find((c) => c.title === 'Two')!.id
    const scene = ws.data!.scenes.find((s) => s.meta.chapter === one)!.meta.id
    await edit.step(two, -1)
    expect(edits.announcement).toBe('Moved “Two” before “One”.')
    await edit.drop(one, { id: two, where: 'before' })
    expect(edits.announcement).toBe('Moved “One” before “Two”.')
    await edit.moveToChapter(scene, two)
    expect(edits.announcement).toBe('Moved “Untitled scene” into “Two”.')
  })

  it('says nothing when nothing moved', async () => {
    const { edit, edits, ws } = await real()
    const first = ws.data!.chapters.find((c) => c.title === 'One')!.id
    await edit.step(first, -1)
    expect(edits.announcement).toBe('')
  })

  it('one instance serves every caller', async () => {
    const { edit } = await real()
    expect(useOutlineEdits()).toBe(edit)
  })
})

describe('dropping a row on a row', () => {
  it('goes before near the top, after near the bottom, inside a chapter in the middle', async () => {
    const { edit, ws } = await real()
    const one = ws.data!.chapters.find((c) => c.title === 'One')!.id
    const two = ws.data!.chapters.find((c) => c.title === 'Two')!.id
    const scene = ws.data!.scenes.find((s) => s.meta.chapter === one)!.meta.id
    expect(edit.dropTarget(two, { id: one }, 0.1)).toEqual({ id: one, where: 'before' })
    expect(edit.dropTarget(one, { id: two }, 0.9)).toEqual({ id: two, where: 'after' })
    expect(edit.dropTarget(scene, { id: two }, 0.5)).toEqual({ id: two, where: 'inside' })
    // a chapter cannot go inside a scene, and a row cannot land on itself
    expect(edit.dropTarget(two, { id: scene }, 0.5)).toBeNull()
    expect(edit.dropTarget(two, { id: two }, 0.5)).toBeNull()
  })
})
