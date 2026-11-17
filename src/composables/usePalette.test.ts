// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { SAMPLE_START } from '@/sample/saltmarch'
import { createWorkspace } from '@/storage/create'
import { openDeviceDb } from '@/storage/device-db'
import { IdbJournal } from '@/storage/journal'
import { WorkspaceSession } from '@/storage/session'
import { useEditsStore } from '@/stores/edits'
import { useLayoutStore } from '@/stores/layout'
import { useReviewStore } from '@/stores/review'
import { useShortcutsStore } from '@/stores/shortcuts'
import { useWorkspaceStore } from '@/stores/workspace'
import { usePalette } from './usePalette'

beforeEach(() => localStorage.clear())

async function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const ws = useWorkspaceStore()
  ws.loadSample()
  ws.select(SAMPLE_START.book, SAMPLE_START.scene)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)*', component: { render: () => null } }],
  })
  let palette!: ReturnType<typeof usePalette>
  mount(defineComponent({ setup: () => ((palette = usePalette()), () => h('div')) }), {
    global: { plugins: [pinia, router] },
  })
  await router.push('/')
  await flushPromises()
  return { palette, router, shortcuts: useShortcutsStore() }
}
const labels = (p: ReturnType<typeof usePalette>) => p.groups.value.map((g) => g.label)

describe('usePalette', () => {
  it('with no query lists the actions, and Pinned and Recent once there are some', async () => {
    const { palette, shortcuts } = await setup()
    expect(labels(palette)).toEqual(['Actions'])
    shortcuts.touch('scene:' + SAMPLE_START.scene)
    shortcuts.togglePin('book:' + SAMPLE_START.book)
    expect(labels(palette)).toEqual(['Pinned', 'Recent', 'Actions'])
    expect(palette.groups.value[1]!.items[0]!.title).toBe('Curfew Bells')
  })

  it('groups a search under Records, Scenes, Books and chapters and Actions', async () => {
    const { palette } = await setup()
    palette.query.value = 'tomas'
    expect(labels(palette)).toEqual(['Records', 'In your writing'])
    expect(palette.groups.value[0]!.items.map((i) => i.title)).toEqual([
      'Tomas Brandt',
      'Tomas’s ledger',
    ])
    palette.query.value = 'lantern'
    expect(labels(palette)).toEqual(['Records', 'Scenes', 'Books and chapters', 'In your writing'])
    palette.query.value = 'go to pl'
    expect(palette.groups.value[0]!.items[0]!.title).toBe('Go to Plan')
  })

  it('also searches the words of scenes and notes, shows the line around the match, and opens that scene', async () => {
    const { palette, router } = await setup()
    palette.query.value = 'ladder'
    const found = palette.groups.value.find((g) => g.label === 'In your writing')!
    expect(found.items.length).toBeGreaterThan(0)
    const first = found.items[0]!
    expect(first.title).toBe('Curfew Bells')
    expect(first.sub).toContain('A boy on a ladder lit the lamps')
    palette.choose(first)
    await flushPromises()
    expect(router.currentRoute.value.path).toMatch(/^\/w\//)
  })

  it('marks the words found in the line, and opens the result at them', async () => {
    const { palette } = await setup()
    palette.query.value = 'ladder'
    const first = palette.groups.value.find((g) => g.label === 'In your writing')!.items[0]!
    expect(first.marks!.map(([a, b]) => first.sub.slice(a, b))).toEqual(['ladder'])
    palette.choose(first)
    await flushPromises()
    expect(useReviewStore().found).toMatchObject({ term: 'ladder' })
  })

  it('does not list a scene twice when its title already matched', async () => {
    const { palette } = await setup()
    // "curfew" is in the title of Curfew Bells and in its text: it is shown once, under Scenes.
    palette.query.value = 'curfew'
    const all = palette.groups.value.flatMap((g) => g.items.map((i) => `${g.label}: ${i.title}`))
    expect(all.filter((x) => x.endsWith('Curfew Bells'))).toEqual(['Scenes: Curfew Bells'])
  })

  it('offers the story map action only for a branching book', async () => {
    const { palette } = await setup()
    palette.query.value = 'story map'
    expect(palette.groups.value).toEqual([])
    const ws = useWorkspaceStore()
    ws.select(ws.data!.books[2]!.id)
    expect(palette.groups.value[0]!.items[0]!.title).toBe('Go to Story map')
  })

  it('opens a scene from a result and closes the palette', async () => {
    const { palette, router } = await setup()
    palette.query.value = 'tide bell'
    const item = palette.groups.value[0]!.items[0]!
    palette.choose(item)
    await flushPromises()
    expect(router.currentRoute.value.path).toMatch(new RegExp(`^/w/${SAMPLE_START.book}/scn_`))
  })

  it('pins the highlighted result from the keyboard', async () => {
    const { palette, shortcuts } = await setup()
    palette.query.value = 'tomas'
    palette.highlighted.value = palette.groups.value[0]!.items[0]!.id
    palette.togglePinHighlighted()
    expect(shortcuts.pinned).toHaveLength(1)
    palette.togglePinHighlighted()
    expect(shortcuts.pinned).toEqual([])
  })

  it('offers focus mode on the writing screen only, and turns it on', async () => {
    const { palette, router } = await setup()
    palette.query.value = 'focus'
    expect(palette.groups.value).toEqual([]) // the router here has no writing screen
    router.addRoute({ path: '/write', name: 'write', component: { render: () => null } })
    await router.push('/write')
    await flushPromises()
    const item = palette.groups.value[0]!.items[0]!
    expect(item.title).toBe('Focus mode')
    palette.choose(item)
    expect(useLayoutStore().focus).toBe(true)
    expect(palette.groups.value[0]!.items[0]!.title).toBe('Leave focus mode')
  })
})

describe('the Rename workspace command', () => {
  const rename = (p: ReturnType<typeof usePalette>) => {
    p.query.value = 'rename'
    return p.groups.value[0]?.items.find((i) => i.id === 'action:rename')
  }
  async function real(readOnly = false) {
    const { palette } = await setup()
    const adapter = new MemoryAdapter()
    await createWorkspace(adapter, 'My Book')
    if (readOnly) {
      // A file from a newer Aurelia opens the workspace read-only.
      const scene = (await adapter.list()).find((p) => p.includes('/scenes/'))!
      await adapter.write(
        scene,
        (await adapter.read(scene))!.text.replace('schemaVersion: 1', 'schemaVersion: 2'),
      )
    }
    const db = openDeviceDb(new IDBFactory())
    const session = await WorkspaceSession.open(adapter, {
      journal: new IdbJournal(() => db),
      debounceMs: 1e9,
    })
    useWorkspaceStore().attach(session)
    return { palette, layout: useLayoutStore() }
  }

  it('is not offered in the sample', async () => {
    const { palette } = await setup()
    expect(rename(palette)).toBeUndefined()
  })

  it('opens the dialog in a real workspace', async () => {
    const { palette, layout } = await real()
    const item = rename(palette)!
    expect(item).toMatchObject({ title: 'Rename workspace…', disabled: false })
    palette.choose(item)
    expect(layout.renameOpen).toBe(false) // waits until the palette has closed and given focus back
    layout.paletteThen?.()
    expect(layout.renameOpen).toBe(true)
  })

  it('finds "Add a change" by those words, with or without words selected in the scene', async () => {
    const { palette } = await real()
    const ws = useWorkspaceStore()
    const scene = ws.entries.find((e) => e.kind === 'scene')!
    ws.select(scene.bookId!, scene.id)
    const found = () => {
      palette.query.value = 'add a change'
      return palette.items.value.find((i) => i.id === 'action:add-change')?.title
    }
    expect(found()).toBe('Add a change to this scene…')
    useEditsStore().selectedText = 'neither of them spoke'
    expect(found()).toBe('Add a change from the selected text…')
  })

  it('shows the reason, and does nothing when chosen, in a read-only workspace', async () => {
    const { palette, layout } = await real(true)
    const item = rename(palette)!
    expect(item).toMatchObject({ disabled: true, sub: expect.stringContaining('read-only') })
    layout.paletteOpen = true
    palette.choose(item)
    expect(layout.paletteOpen).toBe(true) // nothing happened: the palette stays, with its reason showing
    expect(layout.paletteThen).toBeNull()
    expect(layout.renameOpen).toBe(false)
  })
})
