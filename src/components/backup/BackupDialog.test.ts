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

async function open(status: 'idle' | 'ask', enabled = true) {
  setActivePinia(createPinia())
  fakeWs.value = reactive({
    view: { kind: 'browser', name: 'My Book', label: 'this browser', persisted: true },
  })
  const backup = useBackupStore()
  backup.serverState = 'available'
  backup.view = {
    enabled,
    status,
    lastBackup: Date.now(),
    folder: 'Aurelia/My Book (wsp_abc1234567)',
    error: null,
    ask: status === 'ask' ? { deviceName: 'Firefox on Windows', at: '2026-11-12T10:00:00Z' } : null,
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
