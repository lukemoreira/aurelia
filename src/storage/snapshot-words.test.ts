// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import {
  bookRestoreWords,
  holds,
  sceneRestoreWords,
  snapshotName,
  snapshotRef,
} from './snapshot-words'

const none = { restored: [], broughtBack: [], unchanged: 0, kept: [], skipped: [] }

describe('what a restore says', () => {
  it('names what stayed, what came back and what was left, in plain words, and where the old text is', () => {
    expect(
      bookRestoreWords({
        restored: ['The Gate', 'Arrival'],
        broughtBack: ['Home Water'],
        unchanged: 4,
        kept: ['Written since'],
        skipped: [{ title: 'Broken Glass', why: 'two versions are waiting. Choose one first' }],
        before: 'snp_x',
      }),
    ).toBe(
      'Put back the words of 2 scenes. Brought back 1 deleted scene: “Home Water”. 1 scene you wrote since is not in the snapshot, so it stays as it is: “Written since”. “Broken Glass” was left as it is: two versions are waiting. Choose one first. What you had is saved in History as “Before restore”.',
    )
  })

  it('says so when nothing needed changing', () => {
    expect(bookRestoreWords({ ...none, unchanged: 3 })).toBe(
      'Nothing to change: every scene already reads the same.',
    )
    expect(sceneRestoreWords({ changed: false })).toMatch(/^Nothing to change/)
  })

  it('tells unnamed snapshots apart by their time', () => {
    const now = Date.parse('2026-11-17T12:00:00')
    const at = new Date('2026-11-17T10:41:00').toISOString()
    expect(snapshotRef({ reason: 'manual', at }, now)).toBe('the snapshot from Today, 10:41')
    expect(snapshotRef({ reason: 'manual', name: 'First draft', at }, now)).toBe(
      'the snapshot “First draft” from Today, 10:41',
    )
    expect(snapshotRef({ reason: 'before-restore', at }, now)).toBe(
      'the snapshot “Before restore” from Today, 10:41',
    )
  })

  it('names snapshots and says what they hold', () => {
    expect(snapshotName({ name: 'First draft', reason: 'manual' })).toBe('First draft')
    expect(snapshotName({ reason: 'manual' })).toBe('Snapshot')
    expect(snapshotName({ reason: 'before-restore' })).toBe('Before restore')
    expect(holds({ kind: 'scene', files: [] })).toBe('One scene')
    expect(
      holds({
        kind: 'book',
        files: [
          { path: 'a/scenes/scn_a.md', hash: '' },
          { path: 'a/book.json', hash: '' },
        ],
      }),
    ).toBe('The whole book · 1 scene')
  })
})
