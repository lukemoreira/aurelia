// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { storyFindings, storyGraph } from '@/domain/story-graph'
import { changes, outlineRig, snapshot } from '../../tests/helpers/outline-rig'
import { FakeLocks } from '../../tests/helpers/fake-locks'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { createWorkspace } from './create'
import { openDeviceDb } from './device-db'
import { IdbJournal } from './journal'
import { loadWorkspace } from './load'
import { renameItem, setDetails } from './outline-actions'
import { WorkspaceSession } from './session'
import {
  addChoice,
  removeChoice,
  setBookMode,
  setDismissed,
  setEnding,
  setStart,
  updateChoice,
} from './story-actions'

/** A book of three scenes: Start, Left, Right. */
async function story() {
  const rig = await outlineRig()
  const { session } = rig
  const book = session.data.books[0]!.id
  const chapter = session.data.chapters[0]!.id
  const start = session.data.scenes[0]!.meta.id
  await renameItem(session, start, 'Start')
  const left = await session.createScene(chapter)
  await renameItem(session, left, 'Left')
  const right = await session.createScene(chapter)
  await renameItem(session, right, 'Right')
  await setBookMode(session, book, 'branching')
  await session.flush()
  return { ...rig, book, chapter, start, left, right }
}
const sceneOf = (s: WorkspaceSession, id: string) => s.data.scenes.find((x) => x.meta.id === id)!
const reload = async (rig: Awaited<ReturnType<typeof story>>) =>
  (await loadWorkspace(rig.adapter)).data

describe('choices', () => {
  it('a choice to an existing scene changes that one scene file, and reads back after a reload', async () => {
    const rig = await story()
    const { session, adapter, start, left } = rig
    const before = await snapshot(adapter)
    const made = await addChoice(session, start, { label: 'Go left', target: left })
    await session.flush()
    const diff = changes(before, await snapshot(adapter))
    expect(diff.changed).toEqual([`books/${rig.book}/scenes/${start}.md`])
    expect(diff.added).toEqual([])
    expect(made.target).toBe(left)
    const saved = (await reload(rig)).scenes.find((s) => s.meta.id === start)!
    expect(saved.meta.choices).toEqual([{ id: made.choice, label: 'Go left', target: left }])
    expect(saved.body).toBe(sceneOf(session, start).body) // the text is untouched
  })

  it('a choice with no target makes a new scene in the same chapter, named after it, before the choice that points at it', async () => {
    const rig = await story()
    const { session, adapter, start, chapter } = rig
    const order: string[] = []
    adapter.beforeWrite = (path) => void order.push(path.split('/').at(-1)!)
    const made = await addChoice(session, start, { label: 'Climb the aqueduct' })
    await session.flush()
    const made2 = sceneOf(session, made.target)
    expect(made2.meta).toMatchObject({ title: 'Climb the aqueduct', chapter })
    const firstWrite = order.findIndex((p) => p === `${made.target}.md`)
    const choiceWrite = order.findIndex((p) => p === `${start}.md`)
    expect(firstWrite).toBeGreaterThanOrEqual(0)
    expect(firstWrite).toBeLessThan(choiceWrite)
    const data = await reload(rig)
    expect(data.scenes.find((s) => s.meta.id === start)!.meta.choices![0]!.target).toBe(made.target)
    expect(data.scenes.find((s) => s.meta.id === made.target)!.meta.title).toBe(
      'Climb the aqueduct',
    )
  })

  it('keeps what else is on a choice (a note, a key a later version adds) when its words or target change', async () => {
    const rig = await story()
    const { session, start, left, right } = rig
    const made = await addChoice(session, start, { label: 'Go left', target: left })
    await setDetails(session, start, {
      choices: [
        { id: made.choice, label: 'Go left', target: left, note: 'the safe one', if: 'has_key' },
      ],
    })
    await updateChoice(session, start, made.choice, { label: 'Take the left door', target: right })
    expect(sceneOf(session, start).meta.choices).toEqual([
      {
        id: made.choice,
        label: 'Take the left door',
        target: right,
        note: 'the safe one',
        if: 'has_key',
      },
    ])
  })

  it('removes a choice, and the last one takes the key away', async () => {
    const rig = await story()
    const { session, adapter, start, left, right } = rig
    const a = await addChoice(session, start, { label: 'Left', target: left })
    const b = await addChoice(session, start, { label: 'Right', target: right })
    await removeChoice(session, start, a.choice)
    expect(sceneOf(session, start).meta.choices!.map((c) => c.label)).toEqual(['Right'])
    await removeChoice(session, start, b.choice)
    await session.flush()
    const text = (await adapter.read(session.pathOf(start)!))!.text
    expect(text).not.toContain('choices')
    expect(sceneOf(session, start).meta.choices).toBeUndefined()
  })

  it('says why in words: no words for the choice, a scene that is gone, a choice that is gone', async () => {
    const rig = await story()
    const { session, start, left } = rig
    await expect(addChoice(session, start, { label: '  ' })).rejects.toThrow('reader’s words')
    await expect(
      addChoice(session, start, { label: 'x', target: 'scn_0000000000' }),
    ).rejects.toThrow('no longer in the workspace')
    await expect(updateChoice(session, start, 'chc_0000000000', { label: 'x' })).rejects.toThrow(
      'no longer there',
    )
    const made = await addChoice(session, start, { label: 'ok', target: left })
    await expect(updateChoice(session, start, made.choice, { label: '' })).rejects.toThrow(
      'reader’s words',
    )
    await expect(
      updateChoice(session, start, made.choice, { target: 'scn_0000000000' }),
    ).rejects.toThrow('no longer in the workspace')
    expect(sceneOf(session, start).meta.choices).toEqual([
      { id: made.choice, label: 'ok', target: left },
    ])
  })

  it('a choice from a scene is found by the checks: broken when the target is deleted', async () => {
    const rig = await story()
    const { session, start, left } = rig
    await addChoice(session, start, { label: 'Go left', target: left })
    const graph = () => storyGraph(session.data, rig.book)
    expect(storyFindings(graph()).some((f) => f.check === 'broken-choice')).toBe(false)
    const { deleteItem } = await import('./outline-actions')
    await deleteItem(session, left)
    expect(storyFindings(graph()).find((f) => f.check === 'broken-choice')).toMatchObject({
      scene: start,
    })
  })
})

describe('endings, the start, the mode and intended findings', () => {
  it('each writes one key of one file and nothing else', async () => {
    const rig = await story()
    const { session, adapter, book, start, left } = rig
    let before = await snapshot(adapter)
    await setEnding(session, left, true)
    await session.flush()
    expect(changes(before, await snapshot(adapter)).changed).toEqual([
      `books/${book}/scenes/${left}.md`,
    ])
    expect(sceneOf(session, left).meta.ending).toBe(true)
    await setEnding(session, left, false)
    expect(sceneOf(session, left).meta.ending).toBeUndefined()

    before = await snapshot(adapter)
    await setStart(session, book, left)
    await setBookMode(session, book, 'linear')
    const found = ['dead-end:b', 'dead-end:a', 'dead-end:z']
    await setDismissed(session, book, { add: 'dead-end:b', found })
    await setDismissed(session, book, { add: 'dead-end:a', found })
    await setDismissed(session, book, { add: 'dead-end:a', found })
    await session.flush()
    expect(changes(before, await snapshot(adapter)).changed).toEqual([`books/${book}/book.json`])
    const saved = (await reload(rig)).books[0]!
    expect(saved).toMatchObject({
      start: left,
      mode: 'linear',
      dismissedFindings: ['dead-end:b', 'dead-end:a'], // in the author's order
    })
    await setDismissed(session, book, { remove: 'dead-end:a', found })
    await setDismissed(session, book, { remove: 'dead-end:b', found })
    expect(session.data.books[0]!.dismissedFindings).toBeUndefined()
    await expect(setStart(session, book, 'scn_0000000000')).rejects.toThrow(
      'no longer in the workspace',
    )
    expect(start).toBeTruthy()
  })
})

describe('in a workspace that cannot be written to', () => {
  it('refuses every one in words, and changes no file', async () => {
    const adapter = new MemoryAdapter()
    const journal = new IdbJournal(() => openDeviceDb(new IDBFactory()))
    await createWorkspace(adapter, 'My Book')
    const locks = new FakeLocks()
    const open = () =>
      WorkspaceSession.open(adapter, { journal, debounceMs: 1e9, locks: locks.asManager() })
    const first = await open()
    const second = await open() // another tab holds the lock: this one only reads
    expect(second.view().otherTab).toBe(true)
    const [book, scene] = [second.data.books[0]!.id, second.data.scenes[0]!.meta.id]
    const before = await snapshot(adapter)
    for (const work of [
      () => addChoice(second, scene, { label: 'x', target: scene }),
      () => addChoice(second, scene, { label: 'x' }),
      () => setEnding(second, scene, true),
      () => setStart(second, book, scene),
      () => setBookMode(second, book, 'branching'),
      () => setDismissed(second, book, { add: 'a', found: ['a'] }),
    ])
      await expect(work()).rejects.toThrow()
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
    first.dispose()
    second.dispose()
  })
})
