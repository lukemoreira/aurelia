// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import { useBackupStore, type ServerState } from '@/stores/backup'
import { useLayoutStore } from '@/stores/layout'

const fakeWs = vi.hoisted(() => ({ value: undefined as unknown }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => fakeWs.value }))

import StatusBar from './StatusBar.vue'

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
  }
}

function render(opts: { kind?: 'browser' | 'folder'; enabled?: boolean; server: ServerState }) {
  setActivePinia(createPinia())
  fakeWs.value = reactive({
    view: { kind: opts.kind ?? 'browser', save: { kind: 'saved' }, label: 'x', persisted: null },
    words: { scene: 1, chapter: 2, book: 3, session: 4 },
    context: null,
    saveLabel: 'Saved',
    saveState: 'Saved',
  })
  const backup = useBackupStore()
  backup.serverState = opts.server
  backup.now = Date.now()
  backup.view = opts.enabled
    ? {
        enabled: true,
        status: 'idle',
        lastBackup: Date.now(),
        folder: 'Aurelia/x',
        error: null,
        ask: null,
      }
    : null
  const wrapper = mount(StatusBar, { attachTo: document.body })
  const chip = wrapper.findAll('button').at(-1)!
  return { wrapper, chip, layout: useLayoutStore() }
}

afterEach(() => (document.body.innerHTML = ''))
beforeEach(() => setActivePinia(createPinia()))

describe('the status bar’s place for the work', () => {
  it('nudges toward backup, in warn, where the copy is only in this browser and a server is there', async () => {
    const { chip, layout } = render({ server: 'available' })
    expect(chip.text()).toBe('Only in this browser — turn on backup')
    expect(chip.classes()).toEqual(expect.arrayContaining(['bg-warn-soft', 'text-warn']))
    await chip.trigger('click')
    await settle()
    expect(layout.backupOpen).toBe(true) // straight to the Backup screen
  })

  it.each(['unknown', 'sign-in', 'none'] as const)(
    'does not nudge when the server is %s',
    (server) => {
      const { chip } = render({ server })
      expect(chip.text()).toBe('Only in this browser')
      expect(chip.classes()).not.toContain('bg-warn-soft')
    },
  )

  it('does not nudge a folder workspace, or one that is backed up', () => {
    expect(render({ kind: 'folder', server: 'available' }).chip.text()).toBe('In a folder')
    const backedUp = render({ enabled: true, server: 'available' })
    expect(backedUp.chip.text()).toContain('Backed up')
    expect(backedUp.chip.classes()).not.toContain('bg-warn-soft')
  })

  it('the nudge is not announced aloud (it is always there, not news)', () => {
    const { wrapper } = render({ server: 'available' })
    expect(wrapper.find('[role="status"].sr-only').text()).toBe('')
  })
})
