// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import type { BackupView } from './engine'
import {
  agoWords,
  backupNeedsAttention,
  backupWords,
  folderWords,
  persistedWords,
  sizeWords,
  statusTag,
  twoVersionsOf,
  twoVersionsSentence,
  versionWhen,
} from './words'

const NOW = new Date('2026-11-12T18:30:00').getTime()
const view = (extra: Partial<BackupView>): BackupView => ({
  enabled: true,
  status: 'idle',
  lastBackup: NOW - 2 * 60_000,
  folder: 'Aurelia/x',
  error: null,
  ask: null,
  ...extra,
})

describe('backup words', () => {
  it('says how long ago', () => {
    expect(agoWords(NOW - 20_000, NOW)).toBe('just now')
    expect(agoWords(NOW - 2 * 60_000, NOW)).toBe('2 min ago')
    expect(agoWords(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago')
    expect(agoWords(new Date('2026-11-11T12:00:00').getTime(), NOW)).toBe('yesterday')
    expect(agoWords(new Date('2026-11-03T12:00:00').getTime(), NOW)).toBe('Nov 3')
  })

  it('has the status bar words for every state', () => {
    expect(backupWords(view({}), NOW)).toBe('Backed up · 2 min ago')
    expect(backupWords(view({ status: 'working' }), NOW)).toBe('Backing up…')
    expect(backupWords(view({ lastBackup: null }), NOW)).toBe('Backing up…')
    expect(backupWords(view({ status: 'paused' }), NOW)).toBe('Backup paused — sign in again')
    expect(backupWords(view({ status: 'failed' }), NOW)).toBe('Backup failed — will retry')
    expect(backupWords(view({ status: 'ask' }), NOW)).toBe('Backup needs your OK')
    expect(backupWords(view({ status: 'blocked' }), NOW)).toBe('Backup on hold — read-only')
  })

  it('says nothing when backup is off, and only calls for attention when the author must act or it failed', () => {
    expect(backupWords(view({ enabled: false, status: 'off' }), NOW)).toBeNull()
    expect(backupWords(null, NOW)).toBeNull()
    expect(
      ['idle', 'working', 'blocked'].some((status) =>
        backupNeedsAttention(view({ status } as never)),
      ),
    ).toBe(false)
    expect(
      ['paused', 'failed', 'ask'].every((status) =>
        backupNeedsAttention(view({ status } as never)),
      ),
    ).toBe(true)
    expect(backupNeedsAttention(view({ enabled: false, status: 'failed' }))).toBe(false)
  })

  it('says when a version was made, and how big it is', () => {
    expect(versionWhen(new Date('2026-11-12T09:10:00'), NOW)).toBe('Today, 09:10')
    expect(versionWhen(new Date('2026-11-11T17:30:00'), NOW)).toBe('Yesterday, 17:30')
    expect(versionWhen(new Date('2026-11-03T08:05:00'), NOW)).toBe('Nov 3, 08:05')
    expect([512, 12_400, 3_400_000, 84_000_000, 2_500_000_000].map(sizeWords)).toEqual([
      '512 B',
      '12 KB',
      '3.4 MB',
      '84 MB',
      '2.5 GB',
    ])
  })

  it('shows a backup folder without the workspace ID', () => {
    expect(folderWords('Aurelia/My Book (wsp_abc1234567)')).toBe('Aurelia › My Book')
    expect(folderWords('Aurelia/My Book (wsp_abc1234567) – Chrome on macOS 3f9a2c')).toBe(
      'Aurelia › My Book',
    )
    expect(folderWords('Aurelia/Not ours')).toBe('Aurelia › Not ours')
    // The folder keeps the first name; the current one, when known, is what the author sees.
    expect(folderWords('Aurelia/My Book (wsp_abc1234567)', 'Renamed')).toBe('Aurelia › Renamed')
  })

  it('has one answer for what "keep this storage" came to, and it is plain', () => {
    expect([true, false, null, undefined].map((p) => persistedWords(p).title)).toEqual([
      'Kept by the browser',
      'Not protected from clean-up',
      'Not asked yet',
      'Not asked yet',
    ])
    expect(persistedWords(true).yes).toBe(true)
    expect(persistedWords(false).yes).toBe(false)
  })

  describe('a synced workspace (ADR-0012)', () => {
    const synced = (extra: Partial<BackupView>) =>
      view({ mode: 'sync', sync: { devices: [], waiting: 0 }, ...extra })
    const SCENE = 'universes/unv_a/books/bok_b/scenes/scn_c.md'

    it('has the status bar words for every state', () => {
      expect(backupWords(synced({}), NOW)).toBe('Synced')
      expect(backupWords(synced({ lastBackup: null }), NOW)).toBe('Syncing…')
      expect(backupWords(synced({ status: 'working' }), NOW)).toBe('Syncing…')
      expect(backupWords(synced({ status: 'offline' }), NOW)).toBe('Offline')
      expect(
        backupWords(synced({ status: 'offline', sync: { devices: [], waiting: 2 } }), NOW),
      ).toBe('Offline — changes waiting')
      expect(backupWords(synced({ status: 'paused' }), NOW)).toBe('Sync paused — sign in again')
      expect(backupWords(synced({ status: 'failed' }), NOW)).toBe('Sync failed — will retry')
      expect(backupWords(synced({ status: 'ask' }), NOW)).toBe('Sync needs your OK')
      expect(backupWords(synced({ status: 'blocked' }), NOW)).toBe('Sync on hold — read-only')
    })

    it('says plainly that a scene has two versions, in the singular and the plural', () => {
      expect(backupWords(synced({}), NOW, [SCENE])).toBe('Conflict — 1 scene has two versions')
      expect(backupWords(synced({}), NOW, [SCENE, SCENE.replace('scn_c', 'scn_d')])).toBe(
        'Conflict — 2 scenes have two versions',
      )
      expect(backupWords(synced({}), NOW, ['aurelia.json'])).toBe(
        'Conflict — 1 file has two versions',
      )
      // Only a settled sync says it: while working or offline, that is what the bar says.
      expect(backupWords(synced({ status: 'working' }), NOW, [SCENE])).toBe('Syncing…')
    })

    it('does not say Synced while changes wait to go, and says Offline aloud only when something waits', () => {
      expect(backupWords(synced({ sync: { devices: [], waiting: 1 } }), NOW)).toBe('Syncing…')
      expect(backupWords(synced({ sync: { devices: [], waiting: 1 } }), NOW, [SCENE])).toBe(
        'Syncing…',
      )
      expect(backupNeedsAttention(synced({ status: 'offline' }))).toBe(false)
      expect(
        backupNeedsAttention(synced({ status: 'offline', sync: { devices: [], waiting: 3 } })),
      ).toBe(true)
    })

    it('has one list of the files with two versions, and one sentence for them', () => {
      expect(
        twoVersionsOf({
          conflicts: [{ path: 'a.md' }],
          copies: [{ original: 'a.md' }, { original: 'b.md' }],
        }),
      ).toEqual(['a.md', 'b.md'])
      expect(twoVersionsOf(null)).toEqual([])
      expect([1, 2].map(twoVersionsSentence)).toEqual([
        '1 file has two versions',
        '2 files have two versions',
      ])
    })

    it('has one tag for each state that is not simply on', () => {
      expect(statusTag('ask')?.label).toBe('Needs your OK')
      expect(statusTag('offline')).toEqual({ label: 'Offline', tone: 'warn' })
      expect(statusTag('idle')).toBeNull()
    })

    it('calls for attention when two versions wait, not when synced', () => {
      expect(backupNeedsAttention(synced({}))).toBe(false)
      expect(backupNeedsAttention(synced({ status: 'working' }))).toBe(false)
      expect(backupNeedsAttention(synced({}), [SCENE])).toBe(true)
      // Plain backup: two versions and offline are not its words.
      expect(backupNeedsAttention(view({}), [SCENE])).toBe(false)
    })
  })
})
