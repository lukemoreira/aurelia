// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { saltmarchSample } from '@/sample/saltmarch'
import { bok } from '@/sample/saltmarch-ids'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { changes, snapshot } from '../../tests/helpers/outline-rig'
import { inComponent } from '../../tests/helpers/in-component'
import { storyRig } from '../../tests/helpers/story-rig'
import { setActivePinia, createPinia } from 'pinia'
import { NO_VALUE, usePlan } from './usePlan'
import { useCorkboard } from './useCorkboard'
import { useOutlineTable } from './useOutlineTable'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push, replace: push }) }))

beforeEach(() => {
  localStorage.clear()
  push.mockReset()
})

const key = (k: string, extra: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, cancelable: true, ...extra })
const titles = (r: Awaited<ReturnType<typeof storyRig>>) =>
  r.session.data.scenes
    .slice()
    .sort((a, b) => (a.meta.order < b.meta.order ? -1 : 1))
    .map((s) => s.meta.title)

describe('the sample is a tour', () => {
  it('shows the plan and changes nothing: no edit is offered', () => {
    setActivePinia(createPinia())
    const ws = useWorkspaceStore()
    ws.loadSample()
    ws.select(bok.lantern)
    const p = inComponent(() => usePlan())
    expect(p.edit.canEdit.value).toBe(false)
    expect(p.summary.value).toBe('4 chapters · 11 scenes · 12,340 words')
    expect(p.rows.value.filter((r) => r.kind === 'scene')).toHaveLength(11)
    expect(saltmarchSample().scenes.length).toBeGreaterThan(11) // the other books are not in this plan
  })
})

describe('inline edits in the outline table', () => {
  it('a status, a point of view and the arcs are each one key of one scene’s file, and "none" takes it away', async () => {
    const r = await storyRig()
    const p = inComponent(() => usePlan())
    const before = await snapshot(r.adapter)
    await p.setStatus(r.left, 'draft')
    await p.setArcs(r.left, ['arc_0123456789'])
    await r.session.flush()
    expect(changes(before, await snapshot(r.adapter))).toEqual({
      changed: [`books/${r.book}/scenes/${r.left}.md`],
      added: [],
      removed: [],
    })
    const meta = () => r.session.data.scenes.find((s) => s.meta.id === r.left)!.meta
    expect(meta()).toMatchObject({ status: 'draft', arcs: ['arc_0123456789'] })
    await p.setStatus(r.left, NO_VALUE)
    await p.setArcs(r.left, [])
    expect(meta().status).toBeUndefined()
    expect(meta().arcs).toBeUndefined()
  })

  it('a scene that is gone is refused in words, and no file changes', async () => {
    const r = await storyRig()
    const p = inComponent(() => usePlan())
    const before = await snapshot(r.adapter)
    await p.setStatus('scn_0000000000', 'draft')
    expect(useEditsStore().toast).toMatchObject({ error: true })
    expect(changes(before, await snapshot(r.adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })

  it('a scene added from the plan stays in the plan, selected', async () => {
    const r = await storyRig()
    const p = inComponent(() => usePlan())
    await p.addScene(r.chapter)
    expect(p.plan.selected).toBeTruthy()
    expect(r.session.data.scenes).toHaveLength(4)
    expect(push).not.toHaveBeenCalled()
  })

  it('"+ Scene" in a book with no chapter makes the first chapter and its scene, rather than doing nothing', async () => {
    const r = await storyRig()
    const { deleteItem } = await import('@/storage/outline-actions')
    await deleteItem(r.session, r.chapter)
    const p = inComponent(() => usePlan())
    expect(p.chapters.value).toEqual([])
    await p.addScene()
    expect(r.session.data.chapters).toHaveLength(1)
    expect(r.session.data.scenes).toHaveLength(1)
    expect(p.plan.selected).toBe(r.session.data.scenes[0]!.meta.id)
  })
})

describe('reordering', () => {
  it('Alt+↓ on a table row moves the scene one place, writing its file and the derived files only', async () => {
    const r = await storyRig()
    const t = inComponent(() => useOutlineTable())
    const before = await snapshot(r.adapter)
    expect(titles(r)).toEqual(['Start', 'Left', 'Right'])
    await t.onKey(key('ArrowDown', { altKey: true }), r.start)
    await r.session.flush()
    expect(titles(r)).toEqual(['Left', 'Start', 'Right'])
    expect(changes(before, await snapshot(r.adapter)).changed).toEqual([
      `books/${r.book}/OUTLINE.md`,
      `books/${r.book}/book.json`,
      `books/${r.book}/scenes/${r.start}.md`,
    ])
  })

  it('arrow keys alone only move between rows; F2 asks for a new name', async () => {
    const r = await storyRig()
    const t = inComponent(() => useOutlineTable())
    const before = await snapshot(r.adapter)
    await t.onKey(key('ArrowDown'), r.start)
    await t.onKey(key('ArrowUp'), r.left)
    await t.onKey(key('F2'), r.left)
    expect(titles(r)).toEqual(['Start', 'Left', 'Right'])
    expect(changes(before, await snapshot(r.adapter)).changed).toEqual([])
  })

  it('dropping a table row on another is the same move the navigator makes', async () => {
    const r = await storyRig()
    const t = inComponent(() => useOutlineTable())
    await t.edit.drop(r.right, { id: r.start, where: 'before' })
    await r.session.flush()
    expect(titles(r)).toEqual(['Right', 'Start', 'Left'])
  })

  it('on the corkboard, Alt+↑ moves a card up, and a drop on a card lands before or after it by where in the card it is', async () => {
    const r = await storyRig()
    const c = inComponent(() => useCorkboard())
    await c.onKey(key('ArrowUp', { altKey: true }), r.right)
    expect(titles(r)).toEqual(['Start', 'Right', 'Left'])
    const card = { id: r.start, label: 'Start' }
    const over = (at: number) =>
      ({
        currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) },
        clientY: at * 100,
        preventDefault() {},
        dataTransfer: null,
      }) as unknown as DragEvent
    c.drag.start(over(0), { id: r.left, label: 'Left' })
    c.drag.drop(over(0.9), card) // the lower part of the first card: after it
    await vi.waitFor(() => expect(titles(r)).toEqual(['Start', 'Left', 'Right']))
  })

  it('on the corkboard, Alt+→ moves a card to the end of the next chapter, and says where it went', async () => {
    const r = await storyRig()
    const { addChapter } = await import('@/storage/outline-actions')
    const second = await addChapter(r.session, r.book, { title: 'Two' })
    await nextTick()
    const c = inComponent(() => useCorkboard())
    await c.onKey(key('ArrowRight', { altKey: true }), r.start)
    const scene = r.session.data.scenes.find((s) => s.meta.id === r.start)!
    expect(scene.meta.chapter).toBe(second.chapter)
    expect(c.shown.value.map((col) => col.scenes.length)).toEqual([2, 2])
  })

  it('on a corkboard in the sample, nothing can be dragged', () => {
    setActivePinia(createPinia())
    const ws = useWorkspaceStore()
    ws.loadSample()
    ws.select(bok.lantern)
    const c = inComponent(() => useCorkboard())
    expect(c.edit.canEdit.value).toBe(false)
  })
})

describe('the corkboard’s word targets', () => {
  it('a chapter is over its target only when it has one and has passed it', async () => {
    const r = await storyRig()
    const c = inComponent(() => useCorkboard())
    expect(r.book).toBeTruthy()
    expect(c.over(5000, 4000)).toBe(true)
    expect(c.over(4000, 4000)).toBe(false)
    expect(c.over(3000, 4000)).toBe(false)
    expect(c.over(3000, undefined)).toBe(false)
  })
})

describe('the corkboard’s pages', () => {
  it('shows a few chapters at a time and says which', async () => {
    const r = await storyRig()
    const { addChapter } = await import('@/storage/outline-actions')
    for (let i = 0; i < 6; i++) await addChapter(r.session, r.book, { title: `C${i}` })
    const c = inComponent(() => useCorkboard())
    expect(c.rangeLabel.value).toBe('Chapters 1–4 of 7')
    expect(c.canPrev.value).toBe(false)
    c.page(1)
    expect(c.rangeLabel.value).toBe('Chapters 4–7 of 7') // the last page is full, not short
    expect(c.canNext.value).toBe(false)
  })
})
