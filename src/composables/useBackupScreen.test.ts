// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupStatus, BackupView } from '@/backup/engine'
import { useBackupStore, type ServerState } from '@/stores/backup'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { useBackupScreen } from './useBackupScreen'

const NOW = Date.now()
const FOLDER = 'Aurelia/My Book (wsp_abc1234567)'
const STATUSES: BackupStatus[] = ['off', 'idle', 'working', 'paused', 'failed', 'ask', 'blocked']
const SERVERS: ServerState[] = ['unknown', 'available', 'sign-in', 'none']

function screenFor(
  view: Partial<BackupView> | null,
  serverState: ServerState,
  enabled = view?.enabled ?? false,
) {
  setActivePinia(createPinia())
  const backup = useBackupStore()
  backup.now = NOW
  backup.serverState = serverState
  backup.view = view
    ? {
        enabled,
        status: 'idle',
        lastBackup: NOW - 2 * 60_000,
        folder: FOLDER,
        error: null,
        ask: null,
        ...view,
      }
    : null
  return useBackupScreen()
}

beforeEach(() => setActivePinia(createPinia()))

describe('the folder a renamed workspace backs up to', () => {
  it('shows the current name when the backup knows it, the folder’s own when it does not', () => {
    const on = { enabled: true, status: 'idle', lastBackup: NOW - 2 * 60_000 } as const
    expect(screenFor({ ...on, name: 'Renamed' }, 'available').text).toBe(
      'Backing up to Aurelia › Renamed. Last backup 2 min ago.',
    )
    expect(screenFor({ ...on }, 'available').text).toBe(
      'Backing up to Aurelia › My Book. Last backup 2 min ago.',
    )
  })
})

describe('what the Backup screen says, in every state', () => {
  // backup on: the engine's status decides
  it.each([
    ['idle', 'On', 'ok', 'Backing up to Aurelia › My Book. Last backup 2 min ago.', true],
    ['working', 'On', 'ok', 'Backing up to Aurelia › My Book. Last backup 2 min ago.', true],
    ['blocked', 'On', 'ok', 'Backing up to Aurelia › My Book. Last backup 2 min ago.', true],
    ['paused', 'Sign in needed', 'warn', 'Your server needs you to sign in again.', true],
    [
      'failed',
      'Will retry',
      'warn',
      'Aurelia could not reach your server. It will try again.',
      true,
    ],
    ['ask', 'Needs your OK', 'warn', '', false], // the box below says it, once
  ] as const)('on and %s', (status, label, tone, text, canSwitch) => {
    const s = screenFor(
      {
        enabled: true,
        status,
        error: status === 'paused' || status === 'failed' ? text : null,
      },
      'available',
    )
    expect([s.tag, s.text, s.canSwitch]).toEqual([{ label, tone }, text, canSwitch])
    expect(s.enabled).toBe(true)
  })

  // backup off: the server decides
  it.each([
    ['unknown', 'Checking…', 'neutral', false],
    ['available', 'Off', 'neutral', true],
    ['sign-in', 'Sign in needed', 'warn', false],
    ['none', 'Not found', 'neutral', false],
  ] as const)('off and the server is %s', (server, label, tone, canSwitch) => {
    const s = screenFor({ enabled: false, status: 'off', folder: null }, server)
    expect(s.tag).toEqual({ label, tone })
    expect(s.canSwitch).toBe(canSwitch)
    expect(s.needsSignIn).toBe(server === 'sign-in')
    expect(s.text.length).toBeGreaterThan(0)
  })

  it('says it first when backup has just been turned on, and says nothing of a server it has no folder for', () => {
    expect(screenFor({ enabled: true, lastBackup: null }, 'available').text).toBe(
      'Backing up to Aurelia › My Book…',
    )
    expect(screenFor(null, 'none').text).toMatch(/own server with its storage service/)
  })

  it('names the server plainly when there is none', () => {
    expect(screenFor({ enabled: false, status: 'off', folder: null }, 'none').text).toBe(
      'Backup works when Aurelia runs on your own server with its storage service. This copy of Aurelia has none.',
    )
  })

  it('never shows a workspace ID, in any state', () => {
    for (const enabled of [true, false])
      for (const status of STATUSES)
        for (const server of SERVERS) {
          const s = screenFor(
            {
              enabled,
              status,
              error: 'x',
              ask: { deviceName: 'Firefox', at: '2026-11-12T10:00:00Z' },
            },
            server,
          )
          expect(`${s.tag.label} ${s.text}`, `${enabled} ${status} ${server}`).not.toMatch(/wsp_/)
        }
  })
})
