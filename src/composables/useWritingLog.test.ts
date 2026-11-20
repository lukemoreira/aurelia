// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planFromFiles } from '@/import/sources'
import { goalFor, localDay } from '@/domain/writing-log'
import { importBook } from '@/storage/import-actions'
import { LOG_PATH, readLog } from '@/storage/writing-log'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { inComponent } from '../../tests/helpers/in-component'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { useWritingLog } from './useWritingLog'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

async function open() {
  const rig = await outlineRig()
  const ws = useWorkspaceStore()
  ws.attach(rig.session)
  ws.select(rig.session.data.books[0]!.id)
  const goals = inComponent(() => useWritingLog())
  await vi.waitFor(() => expect(goals.ready.value).toBe(true))
  const log = async () => readLog((await rig.adapter.read(LOG_PATH))?.text).log
  return { ...rig, ws, goals, log, day: localDay(new Date()) }
}

describe('the writing log of a real workspace', () => {
  it('records the book once, and typing does not read the log again or write it', async () => {
    const { ws, goals, log, adapter, day } = await open()
    await vi.waitFor(async () =>
      expect(Object.keys((await log()).days[day]?.start ?? {})).toHaveLength(1),
    )
    const read = vi.spyOn(adapter, 'read')
    const write = vi.spyOn(adapter, 'write')
    const scene = ws.data!.scenes[0]!.meta.id
    ws.editScene(scene, 'One two three four')
    ws.editScene(scene, 'One two three four five')
    await new Promise((r) => setTimeout(r, 20))
    expect(goals.ready.value).toBe(true)
    expect(goals.words.value).toBe(5)
    expect(read.mock.calls.filter(([p]) => p === LOG_PATH)).toEqual([])
    expect(write.mock.calls.filter(([p]) => p === LOG_PATH)).toEqual([])
  })

  it('does not count an imported book as written today', async () => {
    const { session, goals, log, day } = await open()
    await vi.waitFor(async () =>
      expect(Object.keys((await log()).days[day]?.start ?? {})).toHaveLength(1),
    )
    const text = 'word '.repeat(900)
    const plan = await planFromFiles(
      ['a', 'b', 'c'].map((n) => ({
        path: `${n}.md`,
        size: text.length,
        read: async () => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>,
      })),
      'Brought in',
    )
    await importBook(session, plan, { title: 'Brought in' })
    await session.flush()
    await vi.waitFor(async () =>
      expect(Object.keys((await log()).days[day]!.start)).toHaveLength(2),
    )
    const started = Object.values((await log()).days[day]!.start).map((s) => s.words)
    expect(started.sort((a, b) => a - b)[1]).toBe(2700)
    expect(goals.words.value).toBe(0)
  })

  it('says "You reached today’s goal." once, when typing takes the words past it', async () => {
    const { ws, goals, log, day } = await open()
    await vi.waitFor(async () =>
      expect(Object.keys((await log()).days[day]?.start ?? {})).toHaveLength(1),
    )
    const edits = useEditsStore()
    await goals.setDailyGoal('3')
    expect(edits.toast).toBeNull() // setting a goal is not reaching it
    const scene = ws.data!.scenes[0]!.meta.id
    const settle = () => new Promise((r) => setTimeout(r, 10))
    ws.editScene(scene, 'One two')
    await settle()
    expect(edits.toast).toBeNull()
    ws.editScene(scene, 'One two three four')
    await vi.waitFor(() => expect(edits.toast?.text).toBe('You reached today’s goal.'))
    edits.toast = null
    ws.editScene(scene, 'One two three four five six')
    await settle()
    expect(edits.toast).toBeNull()
    await goals.setDailyGoal('1')
    await settle()
    expect(edits.toast).toBeNull()
  })

  it('does not say the goal is reached for words nobody typed here (a restore, a sync, an outside change)', async () => {
    const { ws, session, goals, log, day } = await open()
    await vi.waitFor(async () =>
      expect(Object.keys((await log()).days[day]?.start ?? {})).toHaveLength(1),
    )
    const edits = useEditsStore()
    await goals.setDailyGoal('3')
    void session.editScene(ws.data!.scenes[0]!.meta.id, 'One two three four')
    await vi.waitFor(() => expect(goals.words.value).toBe(4))
    await new Promise((r) => setTimeout(r, 10))
    expect(edits.toast).toBeNull()
  })

  it('writes the goals to the file again once a lost folder is reconnected', async () => {
    const { ws, session, goals, log, adapter, day } = await open()
    await vi.waitFor(async () =>
      expect(Object.keys((await log()).days[day]?.start ?? {})).toHaveLength(1),
    )
    adapter.accessLost = true
    await session.checkAll()
    await vi.waitFor(() => expect(ws.view?.permissionLost).toBe(true))
    await goals.setDailyGoal('500') // fails: from here on, in memory only
    expect(goals.error.value).not.toBe('')
    adapter.accessLost = false
    await session.reconnect()
    await vi.waitFor(() => expect(goals.ready.value).toBe(true))
    await goals.setDailyGoal('700')
    expect(goals.error.value).toBe('')
    expect(goalFor(await log(), day)).toBe(700)
  })
})
