// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { SAMPLE_START } from '@/sample/saltmarch'
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
    expect(labels(palette)).toEqual(['Records'])
    expect(palette.groups.value[0]!.items.map((i) => i.title)).toEqual([
      'Tomas Brandt',
      'Tomas’s ledger',
    ])
    palette.query.value = 'lantern'
    expect(labels(palette)).toEqual(['Records', 'Books and chapters'])
    palette.query.value = 'go to pl'
    expect(palette.groups.value[0]!.items[0]!.title).toBe('Go to Plan')
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
})
