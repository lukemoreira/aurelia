// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { newId } from '@/domain/ids'
import { changes, outlineRig, snapshot } from '../../tests/helpers/outline-rig'
import { FakeLocks } from '../../tests/helpers/fake-locks'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import {
  addCalendar,
  addChange,
  removeChange,
  setRecordTime,
  setSceneTime,
  updateChange,
} from './continuity-actions'
import { addRecord } from './record-actions'
import { createWorkspace } from './create'
import { openDeviceDb } from './device-db'
import { IdbJournal } from './journal'
import { loadWorkspace } from './load'
import { setDismissed } from './story-actions'
import { WorkspaceSession } from './session'

const ana = newId('chr')
const bob = newId('chr')

async function scene() {
  const rig = await outlineRig()
  const { session } = rig
  const id = session.data.scenes[0]!.meta.id
  const book = session.data.books[0]!.id
  const path = session.pathOf(id)!
  return { ...rig, id, book, path }
}
const sceneOf = (s: WorkspaceSession, id: string) => s.data.scenes.find((x) => x.meta.id === id)!
const reload = async (rig: Awaited<ReturnType<typeof scene>>) =>
  (await loadWorkspace(rig.adapter)).data

describe('a scene’s changes', () => {
  it('records a change in the scene file only: the text and every other key stay as they were, and it reads back after a reload', async () => {
    const rig = await scene()
    const { session, adapter, id } = rig
    const before = await snapshot(adapter)
    const body = sceneOf(session, id).body
    await addChange(session, id, { kind: 'knows', who: ana, value: ' Her mother is alive ' })
    await session.flush()
    expect(changes(before, await snapshot(adapter))).toMatchObject({
      changed: [expect.stringMatching(/scenes\/scn_/)],
      added: [],
      removed: [],
    })
    const saved = (await reload(rig)).scenes.find((s) => s.meta.id === id)!
    expect(saved.meta.changes).toEqual([{ kind: 'knows', who: ana, value: 'Her mother is alive' }])
    expect(saved.body).toBe(body)
  })

  it('gives a set-up an ID of its own, and keeps the quote the author marked it on', async () => {
    const { session, id } = await scene()
    const made = await addChange(session, id, {
      kind: 'setup',
      value: 'The key under the lantern',
      quote: 'He reached for the lantern.',
    })
    expect(made.id).toMatch(/^stp_[0-9a-z]{10}$/)
    expect(sceneOf(session, id).meta.changes).toEqual([made])
    expect(made.quote).toBe('He reached for the lantern.')
  })

  it('edits one change in place: the comments, the other changes and the other keys stay byte for byte', async () => {
    const { session, id, path, adapter } = await scene()
    const head = session.current(path)!
    const withList = head.replace(
      /\n---\n/,
      `\n# a note to myself\nchanges:\n  # first\n  - { kind: "knows", who: "${ana}", value: "one" }   # why\n  - { kind: "condition", who: "${bob}", value: "two" }\n  # last\n  - { kind: "goal", who: "${ana}", value: "three" }\n---\n`,
    )
    await session.write(path, withList)
    const before = session.current(path)!
    await updateChange(
      session,
      id,
      1,
      { kind: 'condition', who: bob, value: 'two' },
      { kind: 'knows', who: bob, value: 'two, changed' },
    )
    const after = session.current(path)!
    const lines = before.split('\n')
    const edited = after.split('\n')
    expect(edited).toHaveLength(lines.length)
    expect(edited.filter((l, i) => l !== lines[i])).toEqual([
      `  - { kind: "knows", who: "${bob}", value: "two, changed" }`,
    ])
    expect(after).toContain('# a note to myself')
    expect(after).toContain('# why')
    await session.flush()
    expect((await snapshot(adapter)).get(path)).toBe(after)
  })

  it('takes a field away that the new change no longer has (a relationship made a plain note)', async () => {
    const { session, id } = await scene()
    const first = await addChange(session, id, {
      kind: 'relation',
      who: ana,
      with: bob,
      value: 'rival → ally',
    })
    await addChange(session, id, { kind: 'knows', who: ana, value: 'x' })
    await updateChange(session, id, 0, first, { kind: 'trait', who: ana, value: 'trusts Bob' })
    expect(sceneOf(session, id).meta.changes![0]).toEqual({
      kind: 'trait',
      who: ana,
      value: 'trusts Bob',
    })
  })

  it('removes one change, and the last one takes the key away', async () => {
    const { session, id } = await scene()
    const a = await addChange(session, id, { kind: 'knows', who: ana, value: 'a' })
    const b = await addChange(session, id, { kind: 'knows', who: ana, value: 'b' })
    await removeChange(session, id, 0, a)
    expect(sceneOf(session, id).meta.changes).toEqual([b])
    await removeChange(session, id, 0, b)
    expect(sceneOf(session, id).meta.changes).toBeUndefined()
  })

  it('writes nothing when the change is not what the author saw (it moved on elsewhere), and says so', async () => {
    const { session, id } = await scene()
    const a = await addChange(session, id, { kind: 'knows', who: ana, value: 'a' })
    await addChange(session, id, { kind: 'knows', who: ana, value: 'b' })
    const text = session.current(session.pathOf(id)!)
    await expect(
      updateChange(session, id, 0, { ...a, value: 'old' }, { kind: 'knows', who: ana, value: 'z' }),
    ).rejects.toThrow('edited somewhere else')
    await expect(removeChange(session, id, 5, a)).rejects.toThrow('edited somewhere else')
    expect(session.current(session.pathOf(id)!)).toBe(text)
  })

  it('refuses a change that does not say enough, in the author’s words, and one for a scene that is gone', async () => {
    const { session, id } = await scene()
    await expect(addChange(session, id, { kind: 'knows', value: 'x' })).rejects.toThrow(
      'Pick who this is about.',
    )
    await expect(addChange(session, id, { kind: 'knows', who: ana, value: '  ' })).rejects.toThrow(
      'Say what changes.',
    )
    await expect(
      addChange(session, id, { kind: 'status', who: ana, value: 'asleep' }),
    ).rejects.toThrow('Pick what happens to them.')
    await expect(addChange(session, id, { kind: 'payoff' })).rejects.toThrow('Pick the set-up')
    await expect(
      addChange(session, 'scn_0000000000', { kind: 'knows', who: ana, value: 'x' }),
    ).rejects.toThrow('no longer in the workspace')
    expect(sceneOf(session, id).meta.changes).toBeUndefined()
  })

  it('keeps two quick changes: each starts from the list the one before left', async () => {
    const { session, id } = await scene()
    await Promise.all([
      addChange(session, id, { kind: 'knows', who: ana, value: 'one' }),
      addChange(session, id, { kind: 'knows', who: ana, value: 'two' }),
      addChange(session, id, { kind: 'knows', who: ana, value: 'three' }),
    ])
    expect(sceneOf(session, id).meta.changes!.map((c) => c.value)).toEqual(['one', 'two', 'three'])
  })
})

describe('keys the board does not know', () => {
  it('keeps them on a change that is corrected, and on a story time that is set again', async () => {
    const { session, id, path } = await scene()
    await session.write(
      path,
      session
        .current(path)!
        .replace(
          /\n---\n/,
          `\nchanges:\n  - { kind: "knows", who: "${ana}", value: "one", mood: "wry", weight: 3 }\ntime:\n  calendar: "cal_aaaaaaaaaa"\n  at: "412"\n  season: "thaw"\n---\n`,
        ),
    )
    const was = sceneOf(session, id).meta.changes![0]!
    await updateChange(session, id, 0, was, { kind: 'trait', who: ana, value: 'two' })
    expect(sceneOf(session, id).meta.changes![0]).toEqual({
      kind: 'trait',
      who: ana,
      value: 'two',
      mood: 'wry',
      weight: 3,
    })
    expect(session.current(path)).toContain('mood: "wry"')
    await setSceneTime(session, id, { calendar: 'cal_aaaaaaaaaa', at: '412-03', label: 'dusk' })
    expect(sceneOf(session, id).meta.time).toEqual({
      calendar: 'cal_aaaaaaaaaa',
      at: '412-03',
      label: 'dusk',
      season: 'thaw',
    })
  })
})

describe('changes written by hand with block scalars', () => {
  const ana2 = ana
  const hand = (style: string) =>
    `\nchanges:\n  - kind: knows\n    who: ${ana2}\n    value: first\n    quote: ${style}\n      one\n      two\n  - { kind: "knows", who: "${ana2}", value: "middle" }\n  - kind: knows\n    who: ${ana2}\n    value: last\n    quote: ${style}\n      end\n---\n`
  async function handWritten(style: string) {
    const rig = await scene()
    const head = rig.session.current(rig.path)!
    await rig.session.write(rig.path, head.replace(/\n---\n/, hand(style)))
    return rig
  }
  const values = (rig: Awaited<ReturnType<typeof scene>>) =>
    sceneOf(rig.session, rig.id).meta.changes!.map((c) => c.value)
  const body = (rig: Awaited<ReturnType<typeof scene>>) => sceneOf(rig.session, rig.id).body

  for (const style of ['|', '>', '|-']) {
    it(`removes, edits and adds beside a ${style} block without losing a neighbour or breaking the file`, async () => {
      for (const at of [0, 1, 2]) {
        const rig = await handWritten(style)
        const was = sceneOf(rig.session, rig.id).meta.changes![at]!
        await removeChange(rig.session, rig.id, at, was)
        expect(values(rig)).toEqual(['first', 'middle', 'last'].filter((_, i) => i !== at))
        await rig.session.flush()
        // and what is on disk reads back the same
        expect(
          (await reload(rig)).scenes
            .find((s) => s.meta.id === rig.id)!
            .meta.changes!.map((c) => c.value),
        ).toEqual(values(rig))
        expect(body(rig)).toBe('')
      }
      for (const at of [0, 1, 2]) {
        const rig = await handWritten(style)
        const was = sceneOf(rig.session, rig.id).meta.changes![at]!
        await updateChange(rig.session, rig.id, at, was, { ...was, value: 'edited' })
        expect(values(rig)).toEqual(
          ['first', 'middle', 'last'].map((v, i) => (i === at ? 'edited' : v)),
        )
      }
      const rig = await handWritten(style)
      await addChange(rig.session, rig.id, { kind: 'knows', who: ana2, value: 'new' })
      expect(values(rig)).toEqual(['first', 'middle', 'last', 'new'])
      expect(sceneOf(rig.session, rig.id).meta.changes![0]!.quote).toContain('one')
    })
  }
})

describe('story time and calendars', () => {
  it('sets a scene’s time and says when it is a flashback, then takes both away', async () => {
    const { session, id, adapter } = await scene()
    const cal = await addCalendar(session, session.data.universes[0]!.id, {
      name: 'Tide Reckoning',
      era: 'TR',
      months: ['Thaw', 'Bloom'],
    })
    const before = await snapshot(adapter)
    await setSceneTime(
      session,
      id,
      { calendar: cal, at: '412-01-14T18:00', label: ' dusk ' },
      'flashback',
    )
    expect(sceneOf(session, id).meta).toMatchObject({
      time: { calendar: cal, at: '412-01-14T18:00', label: 'dusk' },
      flashback: true,
    })
    expect(sceneOf(session, id).meta.flashForward).toBeUndefined()
    await session.flush()
    expect(changes(before, await snapshot(adapter)).changed).toHaveLength(1)
    await setSceneTime(
      session,
      id,
      { calendar: cal, at: '412-01', until: '412-02' },
      'flash-forward',
    )
    expect(sceneOf(session, id).meta).toMatchObject({
      time: { at: '412-01', until: '412-02' },
      flashForward: true,
    })
    expect(sceneOf(session, id).meta.flashback).toBeUndefined()
    await setSceneTime(session, id, null)
    expect(sceneOf(session, id).meta.time).toBeUndefined()
    expect(sceneOf(session, id).meta.flashForward).toBeUndefined()
  })

  it('adds a calendar to the universe, keeping the ones it has, and it reads back', async () => {
    const rig = await scene()
    const { session } = rig
    const unv = session.data.universes[0]!.id
    const a = await addCalendar(session, unv, {
      name: 'Tide Reckoning',
      era: 'TR',
      months: ['Thaw', ' Bloom ', ''],
    })
    const b = await addCalendar(session, unv, { name: 'Old Count' })
    await session.flush()
    expect((await reload(rig)).universes[0]!.calendars).toEqual([
      { id: a, name: 'Tide Reckoning', era: 'TR', months: ['Thaw', 'Bloom'] },
      { id: b, name: 'Old Count' },
    ])
    await expect(addCalendar(session, unv, { name: '  ' })).rejects.toThrow(
      'Give the calendar a name',
    )
  })
})

describe('intended findings of two lists', () => {
  it('a list only drops the stale marks it owns', async () => {
    const { session, book } = await scene()
    await setDismissed(session, book, { add: 'dead-end:a', found: ['dead-end:a'] })
    await setDismissed(session, book, {
      add: 'two-places:x',
      found: ['dead-end:a', 'two-places:x'],
    })
    // the story map no longer finds `dead-end:a`, but knows nothing of `two-places:x`
    await setDismissed(session, book, {
      add: 'unreachable:q',
      found: ['unreachable:q'],
      among: (f) => /^(dead-end|unreachable)/.test(f),
    })
    expect(session.data.books[0]!.dismissedFindings).toEqual(['two-places:x', 'unreachable:q'])
  })
})

describe('dates before the calendar starts, and the dates on a sheet', () => {
  it('writes a BCE story time as quoted text, and it reads back as the same key', async () => {
    const rig = await scene()
    const { session, id, path } = rig
    const cal = await addCalendar(session, session.data.universes[0]!.id, { name: 'Old Count' })
    await setSceneTime(session, id, { calendar: cal, at: '-44-03-15', until: '-44' })
    await session.flush()
    // quoted, so a reader of the file does not take it for a number
    expect(session.current(path)).toMatch(/at: "-44-03-15"/)
    const saved = (await reload(rig)).scenes.find((s) => s.meta.id === id)!
    expect(saved.meta.time).toMatchObject({ at: '-44-03-15', until: '-44' })
  })

  it('sets a character’s birth and an event’s date in their record files only, then takes it away', async () => {
    const rig = await scene()
    const { session, adapter } = rig
    const unv = session.data.universes[0]!.id
    const cal = await addCalendar(session, unv, { name: 'Old Count', era: 'OC' })
    const elena = await addRecord(session, { type: 'character', title: 'Elena', universeId: unv })
    const storm = await addRecord(session, { type: 'event', title: 'The storm', universeId: unv })
    await session.flush()
    const before = await snapshot(adapter)
    const record = (rid: string) => session.data.records.find((r) => r.meta.id === rid)!
    await setRecordTime(session, elena, 'born', { calendar: cal, at: ' -44-03-15 ' })
    await setRecordTime(session, storm, 'time', {
      calendar: cal,
      at: '412',
      label: ' spring tide ',
    })
    await session.flush()
    expect(record(elena).meta.born).toEqual({ calendar: cal, at: '-44-03-15' })
    expect(record(storm).meta.time).toEqual({ calendar: cal, at: '412', label: 'spring tide' })
    const moved = changes(before, await snapshot(adapter))
    expect(moved.added).toEqual([])
    expect(moved.removed).toEqual([])
    expect(moved.changed).toHaveLength(2)
    expect(moved.changed.every((f) => f.includes('records/'))).toBe(true)
    // another date replaces the sheet's own keys and keeps one it does not know
    await session.setFields(elena, { born: { ...record(elena).meta.born, season: 'thaw' } })
    await setRecordTime(session, elena, 'born', { calendar: cal, at: '-43' })
    expect(record(elena).meta.born).toEqual({ calendar: cal, at: '-43', season: 'thaw' })
    await setRecordTime(session, elena, 'born', null)
    expect(record(elena).meta.born).toBeUndefined()
    await expect(setRecordTime(session, 'chr_aaaaaaaaaa', 'born', null)).rejects.toThrow(
      'no longer in the workspace',
    )
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
    await open()
    const second = await open() // another tab holds the lock: this one only reads
    const id = second.data.scenes[0]!.meta.id
    const before = await snapshot(adapter)
    await expect(addChange(second, id, { kind: 'knows', who: ana, value: 'x' })).rejects.toThrow()
    await expect(
      updateChange(second, id, 0, { kind: 'knows' }, { kind: 'knows', who: ana, value: 'x' }),
    ).rejects.toThrow()
    await expect(removeChange(second, id, 0, { kind: 'knows' })).rejects.toThrow()
    await expect(setSceneTime(second, id, null)).rejects.toThrow()
    await expect(setRecordTime(second, 'chr_aaaaaaaaaa', 'born', null)).rejects.toThrow()
    await expect(addCalendar(second, second.data.universes[0]!.id, { name: 'x' })).rejects.toThrow()
    expect(await snapshot(adapter)).toEqual(before)
  })
})
