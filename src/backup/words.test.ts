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
})
