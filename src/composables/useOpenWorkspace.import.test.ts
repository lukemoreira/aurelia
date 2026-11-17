// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportPlan } from '@/import/plan'
import { inComponent } from '../../tests/helpers/in-component'

const m = vi.hoisted(() => ({
  made: [] as string[],
  discarded: [] as string[],
  fail: false,
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/storage/app', () => ({
  recents: { list: async () => [], remove: async () => undefined },
  reopen: async () => ({ gone: true }),
  reconnect: async () => null,
}))
vi.mock('@/storage/browser', () => ({
  browserAdapter: () => ({}),
  browserDirectory: async (id: string) => void m.made.push(id),
  canKeepInBrowser: () => true,
  canPickFolder: () => false,
  discardBrowserDirectory: async (id: string) => void m.discarded.push(id),
  pickFolder: async () => null,
}))
vi.mock('@/storage/import-actions', () => ({
  createImportedWorkspace: async () => {
    if (m.fail) throw new Error('disk full')
  },
}))

import { useOpenWorkspace } from './useOpenWorkspace'

const plan = {
  source: 'markdown',
  title: 'T',
  mode: 'linear',
  chapters: [],
  report: { unread: [], notes: [] },
} as ImportPlan

beforeEach(() => {
  setActivePinia(createPinia())
  m.made = []
  m.discarded = []
  m.fail = false
})

describe('importing from the Welcome screen', () => {
  it('removes the browser folder it made when the workspace could not be written', async () => {
    m.fail = true
    const open = inComponent(() => useOpenWorkspace())
    await expect(open.importPlan(plan, 'Fresh')).rejects.toThrow('disk full')
    expect(m.made).toHaveLength(1)
    expect(m.discarded).toEqual(m.made)
  })

  it('refuses a name that is not one before it makes anything', async () => {
    const open = inComponent(() => useOpenWorkspace())
    await expect(open.importPlan(plan, '   ')).rejects.toThrow(/name/)
    expect(m.made).toEqual([])
  })
})
