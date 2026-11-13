// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupStore } from '@/backup/state'
import { openDeviceDb } from '@/storage/device-db'

const m = vi.hoisted(() => ({
  state: undefined as unknown as import('@/backup/state').BackupStore,
  open: vi.fn(),
  push: vi.fn(),
  recent: vi.fn(),
  written: [] as Map<string, Uint8Array>[],
  fetched: undefined as unknown,
  versions: [] as unknown[],
}))

vi.mock('@/backup/app', () => ({
  server: {},
  get backupState() {
    return m.state
  },
}))
vi.mock('@/backup/restore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/backup/restore')>()),
  listBackups: async () => [{ folder: 'Aurelia/My Book (wsp_old)', name: 'My Book' }],
  listVersions: async () => m.versions,
  fetchBackup: async () => m.fetched,
  writeRestored: async (_: unknown, files: Map<string, Uint8Array>) => void m.written.push(files),
}))
vi.mock('@/storage/app', () => ({ recents: { get: (id: string) => m.recent(id) } }))
vi.mock('@/storage/browser', () => ({
  browserAdapter: () => ({}),
  browserDirectory: async () => ({}),
  browserDirectoryExists: async () => false,
  canKeepInBrowser: () => true,
  canPickFolder: () => false,
  discardBrowserDirectory: async () => undefined,
  pickFolder: async () => null,
}))
vi.mock('@/storage/remote/webdav-store', () => ({ detectServer: async () => 'available' }))
vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: () => ({ open: m.open, startPath: () => '/write' }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: m.push }) }))

import { useRestore } from './useRestore'

const bytes = (text: string) => new TextEncoder().encode(text)
const idOf = (files: Map<string, Uint8Array>) =>
  JSON.parse(new TextDecoder().decode(files.get('aurelia.json'))).id as string

beforeEach(() => {
  const db = openDeviceDb(new IDBFactory())
  m.state = new BackupStore(() => db)
  m.open.mockReset()
  m.push.mockReset()
  m.recent.mockReset().mockResolvedValue(undefined)
  m.written = []
  m.versions = []
  m.fetched = {
    problems: [],
    files: new Map([['aurelia.json', bytes(JSON.stringify({ id: 'wsp_old', name: 'My Book' }))]]),
  }
})

describe('restoring a backup', () => {
  it('walks workspaces → versions → where, and Back retraces it', async () => {
    m.versions = [{ name: '2026-11-12T18-30-00.zip', at: new Date(), reason: null, size: 1 }]
    const r = useRestore()
    await r.start()
    expect(r.step).toBe('workspaces')
    await r.pick(r.listings[0]!)
    expect(r.step).toBe('versions')
    r.chooseVersion('current')
    expect(r.step).toBe('destination')
    r.back()
    expect(r.step).toBe('versions')
    r.back()
    await vi.waitFor(() => expect(r.step).toBe('workspaces'))
  })

  it('opens at "where" when asked for one version, and Back goes to the list when it has no versions', async () => {
    const r = useRestore()
    await r.start({ folder: 'Aurelia/My Book (wsp_old)', name: 'My Book', choice: 'x.zip' })
    expect(r.step).toBe('destination')
    r.back()
    await vi.waitFor(() => expect(r.step).toBe('workspaces'))
  })

  it('a backup that fails the check opens nothing and says which files, with Back to where', async () => {
    m.fetched = { problems: [{ path: 'a.md', kind: 'changed' }], files: new Map() }
    const r = useRestore()
    await r.start({ folder: 'f', name: 'My Book' })
    await r.restore('browser')
    expect(r.step).toBe('problems')
    expect(m.written).toEqual([])
    expect(m.open).not.toHaveBeenCalled()
    r.back()
    expect(r.step).toBe('destination')
  })

  it('keeps its own ID when this device knows no workspace by it', async () => {
    const r = useRestore()
    await r.start({ folder: 'f', name: 'My Book' })
    await r.restore('browser')
    expect(idOf(m.written[0]!)).toBe('wsp_old')
    expect(m.open).toHaveBeenCalled()
  })

  it('takes a NEW ID when this device remembers a backup of that workspace, so the copy never inherits its state', async () => {
    // Backup was on for wsp_old and the workspace has gone from this browser (storage cleared).
    await m.state.save({
      ...(await m.state.load('wsp_old')),
      enabled: true,
      folder: 'Aurelia/My Book (wsp_old)',
      uploaded: { 'scenes/a.md': 'hash-of-newest' },
    })
    const r = useRestore()
    await r.start({ folder: 'Aurelia/My Book (wsp_old)', name: 'My Book', choice: 'old.zip' })
    await r.restore('browser')
    const id = idOf(m.written[0]!)
    expect(id).not.toBe('wsp_old')
    expect(id).toMatch(/^wsp_/)
    expect(await m.state.load(id)).toMatchObject({ enabled: false, folder: null, uploaded: {} })
    // The old workspace's own state is left alone.
    expect((await m.state.load('wsp_old')).enabled).toBe(true)
  })

  it('starts a restored copy with backup off, whatever was stored under its ID', async () => {
    // A stale row with no folder (nothing to inherit, but nothing to keep either).
    await m.state.save({ ...(await m.state.load('wsp_old')), enabled: true, folder: null })
    const r = useRestore()
    await r.start({ folder: 'f', name: 'My Book' })
    await r.restore('browser')
    expect(idOf(m.written[0]!)).toBe('wsp_old')
    expect((await m.state.load('wsp_old')).enabled).toBe(false)
  })
})
