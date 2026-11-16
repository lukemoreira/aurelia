// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest'
import { storyRig } from '../../tests/helpers/story-rig'
import { WorkspaceSession } from './session'
import { addChoice, removeChoice, setDismissed, updateChoice } from './story-actions'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const sceneOf = (s: WorkspaceSession, id: string) => s.data.scenes.find((x) => x.meta.id === id)!

describe('changes made in quick succession each start from the one before', () => {
  it('removing one choice while relabelling another keeps both changes', async () => {
    const { session, start, left, right } = await storyRig()
    const a = await addChoice(session, start, { label: 'A', target: left })
    const b = await addChoice(session, start, { label: 'B', target: right })
    await Promise.all([
      removeChoice(session, start, a.choice),
      updateChoice(session, start, b.choice, { label: 'B2' }),
    ])
    expect(sceneOf(session, start).meta.choices!.map((c) => c.label)).toEqual(['B2'])
  })

  it('three relabels keep all three, on screen and in the file', async () => {
    const { session, adapter, start, left } = await storyRig()
    const ids: string[] = []
    for (const label of ['A', 'B', 'C'])
      ids.push((await addChoice(session, start, { label, target: left })).choice)
    await Promise.all(ids.map((id, i) => updateChoice(session, start, id, { label: `New ${i}` })))
    await session.flush()
    const want = ['New 0', 'New 1', 'New 2']
    expect(sceneOf(session, start).meta.choices!.map((c) => c.label)).toEqual(want)
    const text = (await adapter.read(session.pathOf(start)!))!.text
    for (const label of want) expect(text).toContain(`label: "${label}"`)
  })

  it('two intended findings marked together keep both; one no longer found is dropped on the way', async () => {
    const { session, book } = await storyRig()
    const found = ['dead-end:a', 'dead-end:b']
    await setDismissed(session, book, { add: 'dead-end:old', found: [...found, 'dead-end:old'] })
    await Promise.all([
      setDismissed(session, book, { add: 'dead-end:a', found }),
      setDismissed(session, book, { add: 'dead-end:b', found }),
    ])
    expect(session.data.books[0]!.dismissedFindings).toEqual(['dead-end:a', 'dead-end:b'])
  })
})

describe('where the file cannot be patched item by item (the last item going), the whole list is set from the list as it is then', () => {
  it('removing both choices at once leaves none, not the one that was removed second', async () => {
    const { session, adapter, start, left, right } = await storyRig()
    const a = await addChoice(session, start, { label: 'A', target: left })
    const b = await addChoice(session, start, { label: 'B', target: right })
    await Promise.all([
      removeChoice(session, start, a.choice),
      removeChoice(session, start, b.choice),
    ])
    await session.flush()
    expect(sceneOf(session, start).meta.choices).toBeUndefined()
    expect((await adapter.read(session.pathOf(start)!))!.text).not.toContain('choices')
  })
})

describe('the file keeps what the author wrote in it', () => {
  it('changing or removing one choice leaves the comments and the other choices as they were', async () => {
    const rig = await storyRig()
    const { session, adapter, start, left, right } = rig
    const a = await addChoice(session, start, { label: 'A', target: left })
    await addChoice(session, start, { label: 'B', target: right })
    await session.flush()
    const path = session.pathOf(start)!
    const text = (await adapter.read(path))!.text
    const commented = text
      .replace('choices:\n', 'choices:\n  # my notes on the fork\n')
      .replace(/(label: "B".*\})/, '$1   # the hard one')
    expect(commented).not.toBe(text)
    session.dispose()
    await adapter.write(path, commented)
    const again = await rig.open()
    await updateChoice(again, start, a.choice, { label: 'A2' })
    await again.flush()
    expect((await adapter.read(path))!.text).toBe(commented.replace('label: "A"', 'label: "A2"'))
    await removeChoice(again, start, a.choice)
    await again.flush()
    const after = (await adapter.read(path))!.text
    expect(after).toContain('# my notes on the fork')
    expect(after).toContain('# the hard one')
    again.dispose()
  })
})
