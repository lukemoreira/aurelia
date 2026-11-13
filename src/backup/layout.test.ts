// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { folderFor, parseFolder, parseVersion, reasonWords, safeName, versionName } from './layout'

describe('backup layout', () => {
  it('names the folder as in ADR-0009, and reads the name back', () => {
    const folder = folderFor('wsp_abc1234567', 'My Writing')
    expect(folder).toBe('Aurelia/My Writing (wsp_abc1234567)')
    expect(parseFolder('My Writing (wsp_abc1234567)')).toEqual({
      name: 'My Writing',
      workspaceId: 'wsp_abc1234567',
    })
    const device = { id: '3f9a2c71-0000-4000-8000-000000000000', name: 'Chrome on macOS' }
    const own = folderFor('wsp_abc1234567', 'My Writing', device)
    expect(own).toBe('Aurelia/My Writing (wsp_abc1234567) – Chrome on macOS 3f9a2c')
    expect(parseFolder(own.slice(8))).toEqual({
      name: 'My Writing',
      workspaceId: 'wsp_abc1234567',
      device: 'Chrome on macOS 3f9a2c',
    })
    // Two devices with one name never share a folder.
    expect(folderFor('wsp_abc1234567', 'My Writing', { ...device, id: 'b81d0e55-0000' })).not.toBe(
      own,
    )
    expect(parseFolder('Photos')).toBeNull()
  })

  it('makes names every server and file system takes', () => {
    expect(safeName('A/B:C*D?"E"<F>|G\\H')).toBe('A-B-C-D-E-F-G-H')
    expect(safeName('  Trailing dots...  ')).toBe('Trailing dots')
    expect(safeName('')).toBe('Workspace')
    expect(safeName('x'.repeat(200))).toHaveLength(60)
    expect(safeName('line\nbreak')).toBe('line-break')
  })

  it('names versions by UTC time, with the reason after an underscore', () => {
    const at = new Date('2026-11-12T18:30:05Z')
    expect(versionName(at)).toBe('2026-11-12T18-30-05.zip')
    expect(versionName(at, 'hourly')).toBe('2026-11-12T18-30-05.zip')
    expect(versionName(at, 'before-keep-mine')).toBe('2026-11-12T18-30-05_before-keep-mine.zip')
    expect(parseVersion('2026-11-12T18-30-05_before-keep-mine.zip')).toEqual({
      at,
      reason: 'before-keep-mine',
    })
    expect(parseVersion('2026-11-12T18-30-05.zip')).toEqual({ at, reason: null })
    expect(parseVersion('notes.zip')).toBeNull()
    expect(reasonWords(null)).toMatch(/every hour/)
    expect(reasonWords('before-keep-mine')).toMatch(/keeping your version/)
  })

  it('adds the first eight letters of the zip’s hash, so one second can hold two versions, and still reads old names', () => {
    const at = new Date('2026-11-12T18:30:05Z')
    expect(versionName(at, null, '3fa9c0d1e2b4aa')).toBe('2026-11-12T18-30-05~3fa9c0d1.zip')
    expect(versionName(at, 'before-sync', '3fa9c0d1e2b4aa')).toBe(
      '2026-11-12T18-30-05~3fa9c0d1_before-sync.zip',
    )
    expect(versionName(at, null, 'aaaaaaaa11')).not.toBe(versionName(at, null, 'bbbbbbbb22'))
    expect(parseVersion('2026-11-12T18-30-05~3fa9c0d1.zip')).toEqual({ at, reason: null })
    expect(parseVersion('2026-11-12T18-30-05~3fa9c0d1_before-sync.zip')).toEqual({
      at,
      reason: 'before-sync',
    })
    expect(parseVersion('2026-11-12T18-30-05_before-sync.zip')).toEqual({
      at,
      reason: 'before-sync',
    })
  })
})
