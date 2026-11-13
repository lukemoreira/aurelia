// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import { useBackupStore } from '@/stores/backup'
import { useLayoutStore } from '@/stores/layout'

const fakeWs = vi.hoisted(() => ({ value: undefined as unknown }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => fakeWs.value }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import BackupDialog from './BackupDialog.vue'

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
  }
}

async function open(
  status: 'idle' | 'ask' | 'offline',
  enabled = true,
  extra: Partial<import('@/backup/engine').BackupView> = {},
  copies: unknown[] = [],
) {
  setActivePinia(createPinia())
  fakeWs.value = reactive({
    view: {
      kind: 'browser',
      name: 'My Book',
      label: 'this browser',
      persisted: true,
      copies,
      conflicts: [],
    },
  })
  const backup = useBackupStore()
  backup.serverState = 'available'
  backup.view = {
    enabled,
    status,
    lastBackup: Date.now(),
    folder: 'Aurelia/My Book (wsp_abc1234567)',
    error: null,
    ask:
      status === 'ask'
        ? { deviceName: 'Firefox on Windows', at: '2026-11-12T10:00:00Z', ...extra.ask }
        : null,
    ...extra,
  }
  useLayoutStore().backupOpen = true
  const wrapper = mount(BackupDialog, { attachTo: document.body })
  await settle()
  return wrapper
}

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement
const card = () => dialog().querySelector('[aria-labelledby="bk-server"] > div') as HTMLElement

afterEach(() => (document.body.innerHTML = ''))

describe('the Backup screen', () => {
  it('Close is the quiet default, not the gold primary', async () => {
    const wrapper = await open('idle')
    const close = [...dialog().querySelectorAll('button')].find((b) => b.textContent === 'Close')!
    expect(close.className).not.toContain('bg-gold')
    wrapper.unmount()
  })

  it('has one live region for a change of backup state, not two (the status bar’s)', async () => {
    const wrapper = await open('idle')
    expect(dialog().querySelectorAll('[role="status"]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('its sections are third-level headings under the dialog’s own title', async () => {
    const wrapper = await open('idle')
    expect([...dialog().querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'Backup and versions',
    ])
    expect([...dialog().querySelectorAll('h3')].map((h) => h.textContent?.trim())).toEqual([
      'In this browser',
      'Copy to your own server',
      'Keep in sync across devices',
      'Versions',
    ])
    wrapper.unmount()
  })

  it('shows gold as a border only when backup is on, and never the workspace ID', async () => {
    const wrapper = await open('idle')
    expect(card().className).toContain('border-gold-ink')
    expect(card().className).not.toContain('bg-gold-soft')
    expect(dialog().textContent).toContain('Aurelia › My Book')
    expect(dialog().textContent).not.toContain('wsp_')
    wrapper.unmount()
  })

  it('in the "ask" state, says it once and lets the warning alone stand out', async () => {
    const wrapper = await open('ask')
    expect(card().className).not.toContain('gold')
    expect(card().className).toContain('bg-surface')
    expect(dialog().textContent).not.toContain('wsp_')
    const said = dialog().textContent!.match(/Another device/g) ?? []
    expect(said).toHaveLength(1) // the warning box's own title; the summary above it stays quiet
    expect(card().querySelector('.bg-warn-soft')).not.toBeNull()
    wrapper.unmount()
  })

  it('says the protection in the same words as the status bar’s details', async () => {
    const wrapper = await open('idle')
    expect(dialog().textContent).toContain('Kept by the browser')
    wrapper.unmount()
  })
})

const syncCard = () => dialog().querySelector('[aria-labelledby="bk-sync"]') as HTMLElement
const SYNCED = {
  mode: 'sync',
  sync: {
    devices: [
      { id: 'a', name: 'Chrome on macOS', at: new Date().toISOString(), self: true },
      { id: 'b', name: 'Safari on iOS', at: new Date().toISOString(), self: false },
    ],
    waiting: 0,
  },
} satisfies Partial<import('@/backup/engine').BackupView>

describe('the sync card on the Backup screen', () => {
  it('off, says in one clause what sync is beside backup', async () => {
    const wrapper = await open('idle', false)
    expect(syncCard().textContent).toContain(
      'Backup keeps a copy on your server; sync keeps every device the same, with versions too.',
    )
    wrapper.unmount()
  })

  it('is off until the author turns it on, and turning it on asks the engine', async () => {
    const wrapper = await open('idle', false)
    const backup = useBackupStore()
    const turnOnSync = vi.spyOn(backup, 'turnOnSync').mockResolvedValue(undefined)
    const sw = syncCard().querySelector('[role="switch"]') as HTMLElement
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.hasAttribute('disabled')).toBe(false)
    expect(syncCard().textContent).toContain('Keep this workspace in sync on this device')
    expect(syncCard().textContent).toContain('both versions are kept')
    sw.click()
    await settle()
    expect(turnOnSync).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('is off the table where there is no server', async () => {
    const wrapper = await open('idle', false)
    useBackupStore().serverState = 'none'
    await settle()
    expect(
      (syncCard().querySelector('[role="switch"]') as HTMLElement).hasAttribute('disabled'),
    ).toBe(true)
    wrapper.unmount()
  })

  it('on: lists the devices, offers Sync now, takes the gold border, and backup says it comes with sync', async () => {
    const wrapper = await open('idle', true, SYNCED)
    expect(syncCard().textContent).toContain('Devices that sync this workspace')
    expect(syncCard().textContent).toContain('Chrome on macOS')
    expect(syncCard().textContent).toContain('(this device)')
    expect(syncCard().textContent).toContain('last synced')
    expect(syncCard().textContent).not.toContain('sent changes')
    expect(syncCard().textContent).toContain('Safari on iOS')
    expect(
      [...syncCard().querySelectorAll('button')].some((b) => b.textContent === 'Sync now'),
    ).toBe(true)
    expect((syncCard().querySelector(':scope > div') as HTMLElement).className).toContain(
      'border-gold-ink',
    )
    expect(card().className).not.toContain('border-gold-ink')
    expect(card().textContent).toContain('versions are kept as usual')
    expect((card().querySelector('[role="switch"]') as HTMLElement).hasAttribute('disabled')).toBe(
      true,
    )
    expect(
      [...card().querySelectorAll('button')].some((b) => b.textContent === 'Back up now'),
    ).toBe(false)
    wrapper.unmount()
  })

  it('offline: says what waits, in warn', async () => {
    const wrapper = await open('offline', true, { ...SYNCED, sync: { ...SYNCED.sync, waiting: 2 } })
    expect(syncCard().textContent).toContain('Offline')
    expect(syncCard().textContent).toContain('2 changes wait here')
    wrapper.unmount()
  })

  it('two versions: says so and Review gives way to the list of files', async () => {
    const wrapper = await open('idle', true, SYNCED, [
      { path: 'a (Aurelia copy 0a1b2c3d).md', original: 'a.md', title: 'a' },
    ])
    expect(syncCard().textContent).toContain('1 file has two versions')
    const review = [...syncCard().querySelectorAll('button')].find(
      (b) => b.textContent === 'Review',
    )!
    review.click()
    await settle()
    const layout = useLayoutStore()
    expect(layout.backupOpen).toBe(false)
    expect(layout.filesOpen).toBe(true)
    wrapper.unmount()
  })

  it('a plain backup shows no devices and no two-version box', async () => {
    const wrapper = await open('idle', true, {}, [
      { path: 'x (copy).md', original: 'x.md', title: 'x' },
    ])
    expect(syncCard().textContent).not.toContain('Devices that sync')
    expect(syncCard().textContent).not.toContain('two versions')
    wrapper.unmount()
  })
})

describe('joining a folder that another device syncs', () => {
  it('the ask box offers to join the sync, not to restore a copy, and joining turns sync on', async () => {
    const wrapper = await open('ask', true, { ask: { sync: true } } as never)
    const backup = useBackupStore()
    const turnOnSync = vi.spyOn(backup, 'turnOnSync').mockResolvedValue(undefined)
    expect(card().textContent).toContain('Another device already syncs this workspace')
    const labels = [...card().querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(labels).toContain('Join the sync')
    expect(labels).toContain('Keep both')
    expect(labels).not.toContain('Use the backup here')
    ;[...card().querySelectorAll('button')].find((b) => b.textContent === 'Join the sync')!.click()
    await settle()
    expect(turnOnSync).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('a plain backup’s ask box is as it was', async () => {
    const wrapper = await open('ask')
    const labels = [...card().querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(labels).toContain('Use the backup here')
    expect(labels).not.toContain('Join the sync')
    wrapper.unmount()
  })
})
