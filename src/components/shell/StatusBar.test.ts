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

function render(opts: {
  kind?: 'browser' | 'folder'
  enabled?: boolean
  server: ServerState
  view?: Partial<import('@/backup/engine').BackupView>
  workspace?: Record<string, unknown>
}) {
  setActivePinia(createPinia())
  fakeWs.value = reactive({
    view: {
      kind: opts.kind ?? 'browser',
      save: { kind: 'saved' },
      label: 'x',
      persisted: null,
      conflicts: [],
      copies: [],
      ...opts.workspace,
    },
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
        ...opts.view,
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

const SCENE = 'universes/unv_a/books/bok_b/scenes/scn_c.md'
const synced = {
  mode: 'sync',
  sync: { devices: [], waiting: 0 },
} satisfies Partial<import('@/backup/engine').BackupView>

describe('a synced workspace in the status bar', () => {
  it.each([
    ['Synced', {}],
    ['Syncing…', { status: 'working' }],
    ['Offline — changes waiting', { status: 'offline', sync: { devices: [], waiting: 1 } }],
  ] as const)('says “%s”', (words, view) => {
    const { chip } = render({
      enabled: true,
      server: 'available',
      view: { ...synced, ...view } as never,
    })
    expect(chip.text()).toBe(words)
  })

  it('says it aloud when offline, but not when synced or syncing', () => {
    const say = (view: object) =>
      render({ enabled: true, server: 'available', view: { ...synced, ...view } as never })
        .wrapper.find('[role="status"].sr-only')
        .text()
    expect(say({})).toBe('')
    expect(say({ status: 'working' })).toBe('')
    expect(say({ status: 'offline' })).toBe('') // offline with nothing waiting is not news
    expect(say({ status: 'offline', sync: { devices: [], waiting: 2 } })).toBe(
      'Offline — changes waiting',
    )
  })

  it('says a scene has two versions, in warn, and the chip opens the list where they are chosen between', async () => {
    const { chip, layout } = render({
      enabled: true,
      server: 'available',
      view: synced,
      workspace: {
        copies: [
          {
            path: `${SCENE.slice(0, -3)} (Aurelia copy 0a1b2c3d).md`,
            original: SCENE,
            title: 'Scene',
          },
        ],
      },
    })
    expect(chip.text()).toBe('Conflict — 1 scene has two versions')
    expect(chip.classes()).toContain('text-warn')
    await chip.trigger('click')
    await settle()
    expect(layout.filesOpen).toBe(true)
    expect(layout.backupOpen).toBe(false)
  })

  it('a text that arrived over unsaved edits opens the compare dialog', async () => {
    const { chip, layout } = render({
      enabled: true,
      server: 'available',
      view: synced,
      workspace: { conflicts: [{ path: SCENE, title: 'Scene', mine: 'a', theirs: 'b' }] },
    })
    expect(chip.text()).toBe('Conflict — 1 scene has two versions')
    await chip.trigger('click')
    await settle()
    expect(layout.comparing).toBe(SCENE)
  })

  it('plain backup keeps the details popover, whatever copies there are', async () => {
    const { chip, layout } = render({
      enabled: true,
      server: 'available',
      workspace: { copies: [{ path: 'x (copy).md', original: 'x.md', title: 'x' }] },
    })
    expect(chip.text()).toContain('Backed up')
    await chip.trigger('click')
    await settle()
    expect(layout.filesOpen).toBe(false)
  })
})
