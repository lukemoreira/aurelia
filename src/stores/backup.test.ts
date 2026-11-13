// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSession } from '@/storage/session'

const mocks = vi.hoisted(() => ({
  openBackup: vi.fn(),
  detectServer: vi.fn(),
}))
vi.mock('@/backup/app', () => ({ openBackup: mocks.openBackup, server: {} }))
vi.mock('@/storage/remote/webdav-store', () => ({ detectServer: mocks.detectServer }))

import { useBackupStore } from './backup'

const engine = () => ({
  dispose: vi.fn(),
  view: () => ({ enabled: false, status: 'off' }),
  subscribe: () => () => undefined,
})
const session = {} as WorkspaceSession
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('the backup store follows the open workspace', () => {
  it('forgets the last workspace’s server answer: one whose backup cannot open gets no "turn on backup" nudge', async () => {
    const backup = useBackupStore()
    mocks.openBackup.mockResolvedValueOnce(engine())
    mocks.detectServer.mockResolvedValue('available')
    await backup.attach(session)
    await settle()
    expect(backup.serverState).toBe('available')

    mocks.openBackup.mockRejectedValueOnce(new Error('no device database'))
    await backup.attach(session)
    await settle()
    expect(backup.serverState).toBe('unknown')
    expect(backup.view).toBeNull()
  })
})
