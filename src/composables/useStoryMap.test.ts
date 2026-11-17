// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { bok } from '@/sample/saltmarch-ids'
import { createWorkspace } from '@/storage/create'
import { openDeviceDb } from '@/storage/device-db'
import { IdbJournal } from '@/storage/journal'
import { addChoice } from '@/storage/story-actions'
import { WorkspaceSession } from '@/storage/session'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { FakeLocks } from '../../tests/helpers/fake-locks'
import { inComponent } from '../../tests/helpers/in-component'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { changes, snapshot } from '../../tests/helpers/outline-rig'
import { storyRig } from '../../tests/helpers/story-rig'
import { useChoices } from './useChoices'
import { useStoryMap } from './useStoryMap'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push, replace: push }) }))
beforeEach(() => {
  localStorage.clear()
  push.mockReset()
})

describe('the story map of a real book', () => {
  it('lays out the scenes, selects the start, and reports the checks as words', async () => {
    const r = await storyRig()
    await addChoice(r.session, r.start, { label: 'Go left', target: r.left })
    const m = inComponent(() => useStoryMap())
    expect(m.branching.value).toBe(true)
    expect(m.selected.value).toBe(r.start)
    expect(m.layout.value!.nodes.map((n) => n.id).sort()).toEqual([r.left, r.right, r.start].sort())
    // Left is a dead end, Right has no way in, and the story has no ending at all
    expect(m.split.value.active.map((f) => f.check).sort()).toEqual([
      'dead-end',
      'dead-end',
      'no-ending',
      'unreachable',
    ])
    expect(m.trouble.value.get(r.right)).toMatchObject({ words: 'dead end', severity: 'warning' })
  })

  it('marks a dead end as an ending in one click, and the finding goes', async () => {
    const r = await storyRig()
    await addChoice(r.session, r.start, { label: 'Go left', target: r.left })
    await addChoice(r.session, r.start, { label: 'Go right', target: r.right })
    const m = inComponent(() => useStoryMap())
    expect(m.split.value.active.filter((f) => f.check === 'dead-end')).toHaveLength(2)
    await m.markEnding(r.left)
    await m.markEnding(r.right)
    expect(m.split.value.active).toEqual([])
  })

  it('"Mark intended" is stored by fingerprint in book.json, hides the finding on every reader, and can be undone', async () => {
    const r = await storyRig()
    await addChoice(r.session, r.start, { label: 'Go left', target: r.left })
    const m = inComponent(() => useStoryMap())
    const lost = m.split.value.active.find((f) => f.check === 'unreachable')!
    const before = await snapshot(r.adapter)
    await m.dismiss(lost, true)
    await r.session.flush()
    expect(changes(before, await snapshot(r.adapter)).changed).toEqual([
      `books/${r.book}/book.json`,
    ])
    expect(r.session.data.books[0]!.dismissedFindings).toEqual([lost.fingerprint])
    expect(m.split.value.dismissed.map((f) => f.fingerprint)).toEqual([lost.fingerprint])
    expect(m.split.value.active.some((f) => f.check === 'unreachable')).toBe(false)
    // another device reads the same file and hides the same finding
    const other = (await import('@/storage/load')).loadWorkspace
    const reread = (await other(r.adapter)).data
    expect(reread.books[0]!.dismissedFindings).toEqual([lost.fingerprint])
    await m.dismiss(lost, false)
    expect(r.session.data.books[0]!.dismissedFindings).toBeUndefined()
    expect(m.split.value.active.some((f) => f.check === 'unreachable')).toBe(true)
  })

  it('marking a story finding intended keeps the marks the Continuity list owns', async () => {
    const r = await storyRig()
    await addChoice(r.session, r.start, { label: 'Go left', target: r.left })
    // a mark of the Continuity list, which the story map does not find
    await r.session.setFields(r.book, { dismissedFindings: ['two-places:chr_x,scn_a,scn_b'] })
    const m = inComponent(() => useStoryMap())
    const lost = m.split.value.active.find((f) => f.check === 'unreachable')!
    await m.dismiss(lost, true)
    expect(r.session.data.books[0]!.dismissedFindings).toEqual([
      'two-places:chr_x,scn_a,scn_b',
      lost.fingerprint,
    ])
    await m.dismiss(lost, false)
    expect(r.session.data.books[0]!.dismissedFindings).toEqual(['two-places:chr_x,scn_a,scn_b'])
  })

  it('a scene that goes while it is selected gives the selection back to the start', async () => {
    const r = await storyRig()
    const m = inComponent(() => useStoryMap())
    m.select(r.right)
    expect(m.selected.value).toBe(r.right)
    const { deleteItem } = await import('@/storage/outline-actions')
    await deleteItem(r.session, r.right)
    await nextTick()
    expect(m.selected.value).toBe(r.start)
  })

  it('the button of "No ending" never marks the start as an ending: it takes the author to add a choice', async () => {
    const r = await storyRig()
    await addChoice(r.session, r.start, { label: 'Go left', target: r.left })
    await addChoice(r.session, r.left, { label: 'Back', target: r.start })
    const m = inComponent(() => useStoryMap())
    const none = m.split.value.active.find((f) => f.check === 'no-ending')!
    expect(none.fix).toBe('add-choice')
    await m.fix(none)
    expect(r.session.data.scenes.find((s) => s.meta.id === r.start)!.meta.ending).toBeUndefined()
    expect(m.selected.value).toBe(none.scene)
    expect(m.asked.value).toMatchObject({ what: 'add-choice' })
  })

  it('a button that sends the author to a place asks again each time, and leaves Play; a dead end is mended in one click', async () => {
    const r = await storyRig()
    await addChoice(r.session, r.start, { label: 'Go left', target: r.left })
    const m = inComponent(() => useStoryMap())
    const dead = m.split.value.active.find((f) => f.check === 'dead-end')!
    const lost = m.split.value.active.find((f) => f.check === 'unreachable')!
    m.play.start()
    await m.fix(lost)
    expect(m.play.active.value).toBe(false)
    const first = m.asked.value!.n
    await m.fix(lost)
    expect(m.asked.value!.n).toBe(first + 1)
    await m.fix(dead)
    expect(r.session.data.scenes.find((s) => s.meta.id === dead.scene)!.meta.ending).toBe(true)
  })

  it('"Play from here" starts at the selected scene', async () => {
    const r = await storyRig()
    await addChoice(r.session, r.start, { label: 'Go left', target: r.left })
    const m = inComponent(() => useStoryMap())
    m.playFrom(r.left)
    expect(m.play.active.value).toBe(true)
    expect(m.play.path.value).toEqual([r.left])
    expect(m.selected.value).toBe(r.left)
  })

  it('the map is laid out again when the story changes shape, and not when only a scene’s text changes', async () => {
    const r = await storyRig()
    await addChoice(r.session, r.start, { label: 'Go left', target: r.left })
    const m = inComponent(() => useStoryMap())
    const before = m.layout.value
    await r.session.editScene(r.left, 'Some new words in a scene.')
    await nextTick()
    expect(m.layout.value).toBe(before)
    await addChoice(r.session, r.start, { label: 'Go right', target: r.right })
    await nextTick()
    expect(m.layout.value).not.toBe(before)
  })

  it('adds a way in: a new choice on another scene that leads here', async () => {
    const r = await storyRig()
    const m = inComponent(() => useStoryMap())
    await m.addWayIn(r.right, r.start, 'Go right')
    const g = m.graph.value!
    expect(g.waysIn.get(r.right)).toBe(1)
    expect(g.reachable.has(r.right)).toBe(true)
  })

  it('a book that is a straight story says so, and can be made branching', async () => {
    const r = await storyRig()
    const { setBookMode } = await import('@/storage/story-actions')
    await setBookMode(r.session, r.book, 'linear')
    const m = inComponent(() => useStoryMap())
    expect(m.branching.value).toBe(false)
    await m.makeBranching()
    expect(m.branching.value).toBe(true)
  })

  it('arrow keys go to the nearest scene that way, and the selection follows', async () => {
    const r = await storyRig()
    await addChoice(r.session, r.start, { label: 'Go left', target: r.left })
    await addChoice(r.session, r.start, { label: 'Go right', target: r.right })
    const m = inComponent(() => useStoryMap())
    expect(m.step(r.start, 'down')).toBeDefined()
    expect([r.left, r.right]).toContain(m.selected.value)
    expect(m.step(m.selected.value!, 'up')).toBe(r.start)
    expect(m.step(r.start, 'up')).toBeUndefined()
  })

  it('zoom stays between a quarter and a half over, in tenths', () => {
    const m = inComponent(() => useStoryMap())
    for (let i = 0; i < 30; i++) m.zoomBy(-1)
    expect(m.zoom.value).toBe(0.4)
    for (let i = 0; i < 30; i++) m.zoomBy(1)
    expect(m.zoom.value).toBe(1.6)
  })
})

describe('Play mode', () => {
  async function played() {
    const r = await storyRig()
    await addChoice(r.session, r.start, { label: 'Go left', target: r.left })
    await addChoice(r.session, r.start, { label: 'Go right', target: r.right })
    const { setEnding } = await import('@/storage/story-actions')
    await setEnding(r.session, r.left, true)
    await r.session.editScene(
      r.start,
      'It begins with [[Elena|her]] on the **shore**.\n\n* * *\n\nThen the tide.',
    )
    const m = inComponent(() => useStoryMap())
    return { r, m }
  }

  it('reads from the start, follows a choice, shows an ending, goes back and starts again', async () => {
    const { r, m } = await played()
    const p = m.play
    p.start()
    expect(p.scene.value!.id).toBe(r.start)
    expect(p.paragraphs.value).toEqual(['It begins with her on the shore.', '⁂', 'Then the tide.'])
    expect(p.options.value.map((c) => c.label)).toEqual(['Go left', 'Go right'])
    p.choose(p.options.value[0]!.id)
    expect(p.scene.value!.id).toBe(r.left)
    expect(p.ended.value).toBe(true)
    expect(p.steps.value.map((s) => s.title)).toEqual(['Start', 'Left'])
    p.back()
    expect(p.scene.value!.id).toBe(r.start)
    p.choose(p.options.value[1]!.id) // Right: not an ending, and no way on
    expect(p.stuck.value).toBe(true)
    p.start()
    expect(p.path.value).toEqual([r.start])
  })

  it('writes nothing: not a file, not the journal', async () => {
    const { r, m } = await played()
    await r.session.flush()
    const before = await snapshot(r.adapter)
    const journaled = await r.journal.list(r.session.data.workspace.id)
    m.play.start()
    m.play.choose(m.play.options.value[0]!.id)
    m.play.back()
    m.play.start()
    await nextTick()
    await r.session.flush()
    expect(changes(before, await snapshot(r.adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
    expect(await r.journal.list(r.session.data.workspace.id)).toEqual(journaled)
  })

  it('a scene that goes while it is open ends the path where it was last whole', async () => {
    const { r, m } = await played()
    m.play.start()
    m.play.choose(m.play.options.value[0]!.id)
    const { deleteItem } = await import('@/storage/outline-actions')
    await deleteItem(r.session, r.left)
    await nextTick()
    expect(m.play.path.value).toEqual([r.start])
    expect(m.play.options.value.find((c) => c.target === r.left)?.broken).toBe('deleted')
  })

  it('a choice that leads nowhere is shown and cannot be followed', async () => {
    const r = await storyRig()
    await addChoice(r.session, r.start, { label: 'Go left', target: r.left })
    const { deleteItem } = await import('@/storage/outline-actions')
    await deleteItem(r.session, r.left)
    const m = inComponent(() => useStoryMap())
    m.play.start()
    const [c] = m.play.options.value
    expect(c!.broken).toBe('deleted')
    m.play.choose(c!.id)
    expect(m.play.path.value).toEqual([r.start])
    expect(m.play.stuck.value).toBe(true)
  })
})

describe('the sample’s game book', () => {
  it('has a story map with a start, three endings and the two warnings the sample shows', () => {
    setActivePinia(createPinia())
    const ws = useWorkspaceStore()
    ws.loadSample()
    ws.select(bok.saltash)
    const m = inComponent(() => useStoryMap())
    expect(m.summary.value).toEqual({ scenes: 11, choices: 15, endings: 3, endingsReachable: 3 })
    expect(m.split.value.active.map((f) => f.check).sort()).toEqual(['dead-end', 'unreachable'])
    expect(m.canEdit.value).toBe(false)
    // nothing about the story is editable in a tour, and play still works
    m.play.start()
    m.play.choose(m.play.options.value[0]!.id)
    expect(m.play.path.value).toHaveLength(2)
  })

  it('a linear book of the sample has no story map to show', () => {
    setActivePinia(createPinia())
    const ws = useWorkspaceStore()
    ws.loadSample()
    ws.select(bok.lantern)
    expect(inComponent(() => useStoryMap()).branching.value).toBe(false)
  })
})

describe('in a workspace another tab is writing', () => {
  it('every change is refused in words and no file changes', async () => {
    setActivePinia(createPinia())
    const adapter = new MemoryAdapter()
    const journal = new IdbJournal(() => openDeviceDb(new IDBFactory()))
    await createWorkspace(adapter, 'My Book')
    const locks = new FakeLocks()
    const open = () =>
      WorkspaceSession.open(adapter, { journal, debounceMs: 1e9, locks: locks.asManager() })
    const first = await open()
    const second = await open()
    const ws = useWorkspaceStore()
    ws.attach(second)
    const book = second.data.books[0]!.id
    ws.select(book)
    const scene = second.data.scenes[0]!.meta.id
    const m = inComponent(() => useStoryMap())
    const c = inComponent(() => useChoices(() => scene))
    expect(m.canEdit.value).toBe(false)
    const before = await snapshot(adapter)
    await m.markEnding(scene)
    expect(useEditsStore().toast).toMatchObject({ error: true })
    useEditsStore().toast = null
    c.add.label = 'x'
    await c.addNow()
    expect(c.error.value).not.toBe('')
    c.ending.value = true
    await nextTick()
    await m.makeBranching()
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
    first.dispose()
    second.dispose()
  })
})
