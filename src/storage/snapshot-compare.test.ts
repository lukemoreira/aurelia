// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { outlineRig } from '../../tests/helpers/outline-rig'
import {
  compareScenes,
  inTimeOrder,
  sceneDiff,
  sceneFilesNow,
  sceneFilesOf,
} from './snapshot-compare'
import { takeSnapshot, type Snapshot } from './snapshots'

const file = (title: string, body: string) => `---\ntitle: "${title}"\nid: x\n---\n\n${body}`
const p = (id: string) => `universes/unv_a/books/bok_a/scenes/${id}.md`

describe('compareScenes', () => {
  it('matches scenes by ID and sorts changed first, then the ones in only one, then the same', () => {
    const rows = compareScenes({
      older: new Map([
        [p('scn_same'), file('Same', 'x')],
        [p('scn_chg'), file('Changed', 'old words')],
        [p('scn_gone'), file('Gone', 'y')],
      ]),
      newer: new Map([
        [p('scn_same'), file('Same', 'x')],
        [p('scn_chg'), file('Changed', 'new words')],
        [p('scn_new'), file('New', 'z')],
      ]),
    })
    expect(rows.map((r) => [r.title, r.state])).toEqual([
      ['Changed', 'changed'],
      ['New', 'only-newer'],
      ['Gone', 'only-older'],
      ['Same', 'same'],
    ])
  })

  it('compares the writing only: a different title or status with the same words is "same"', () => {
    const [row] = compareScenes({
      older: new Map([[p('scn_a'), file('Old title', 'Words.')]]),
      newer: new Map([[p('scn_a'), file('New title', 'Words.')]]),
    })
    expect(row!.state).toBe('same')
  })

  it('a line-ending difference alone is not a change', () => {
    const [row] = compareScenes({
      older: new Map([[p('scn_a'), '---\r\ntitle: "T"\r\n---\r\n\r\nOne\r\nTwo']]),
      newer: new Map([[p('scn_a'), '---\r\ntitle: "T"\r\n---\r\n\r\nOne\r\nTwo']]),
    })
    expect(row!.state).toBe('same')
  })

  it('counts the words that came and went', () => {
    const [row] = compareScenes({
      older: new Map([[p('scn_a'), file('A', 'one two three')]]),
      newer: new Map([[p('scn_a'), file('A', 'one 2 three four')]]),
    })
    expect(sceneDiff(row!)).toMatchObject({ added: 2, removed: 1 })
  })

  it('orders two snapshots by time, whichever was picked first', () => {
    const [a, b] = [{ at: '2026-01-01T00:00:00Z' }, { at: '2026-02-01T00:00:00Z' }] as Snapshot[]
    expect(inTimeOrder(b!, a!)).toEqual([a, b])
  })
})

describe('against the text now', () => {
  it('reads the words not yet saved, and only the scenes of that book', async () => {
    const { session, adapter } = await outlineRig()
    const id = session.data.scenes[0]!.meta.id
    await session.editScene(id, 'Typed a second ago.')
    const now = sceneFilesNow(session, session.data.books[0]!.id)
    expect([...now.values()][0]).toContain('Typed a second ago.')
    expect(sceneFilesNow(session, 'bok_other').size).toBe(0)
    const snap = await takeSnapshot(session, { kind: 'book', id: session.data.books[0]!.id })
    const rows = compareScenes({ older: await sceneFilesOf(adapter, snap), newer: now })
    expect(rows.map((r) => r.state)).toEqual(['same'])
  })
})
