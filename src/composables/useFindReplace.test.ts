// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import { useFindReplace } from './useFindReplace'

beforeEach(() => localStorage.clear())

/** One book with two scenes that say "lamp", the dialog open on it. */
async function setup() {
  const rig = await outlineRig()
  const s = rig.session
  const pinia = createPinia()
  setActivePinia(pinia)
  const ws = useWorkspaceStore()
  ws.attach(s)
  const ids = [s.data.scenes[0]!.meta.id, await s.createScene(s.data.chapters[0]!.id)]
  await s.editScene(ids[0]!, 'One lamp. Two lamp.\n')
  await s.editScene(ids[1]!, 'A lamp.\n')
  await s.flush()
  ws.select(s.data.books[0]!.id)
  let f!: ReturnType<typeof useFindReplace>
  mount(defineComponent({ setup: () => ((f = useFindReplace()), () => h('div')) }), {
    global: { plugins: [pinia] },
  })
  useLayoutStore().findReplaceOpen = true
  await flushPromises()
  const text = async (id: string) => (await rig.adapter.read(s.pathOf(id)!))!.text
  return { ...rig, s, f, ids, text }
}

describe('Find and replace', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout'] }))

  it('looks through the book only once typing pauses, and cannot replace meanwhile', async () => {
    const t = await setup()
    t.f.find.value = 'lamp'
    t.f.replace.value = 'torch'
    await flushPromises()
    expect(t.f.pending.value).toBe(true)
    expect(t.f.total.value).toBe(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(t.f.pending.value).toBe(false)
    expect(t.f.total.value).toBe(3)
  })

  it('keeps the list as found while the text changes, and after a refused run finds it again and says the ticks were reset', async () => {
    const t = await setup()
    t.f.find.value = 'lamp'
    t.f.replace.value = 'torch'
    await vi.advanceTimersByTimeAsync(200)
    const second = [...t.f.ticked.value][1]!
    t.f.toggle(second) // "Two lamp" stays as it is
    // Words arrive in the first scene (another device), before the unticked place.
    await t.s.editScene(t.ids[0]!, 'Ten more letters. One lamp. Two lamp.\n')
    await t.s.flush()
    await flushPromises()
    expect(t.f.count.value).toBe(2) // the list did not move under the tick
    await t.f.apply()
    expect(t.f.error.value).toMatch(/found again and every one is ticked/)
    expect(t.f.count.value).toBe(t.f.total.value)
    expect(await t.text(t.ids[0]!)).toContain('Ten more letters. One lamp. Two lamp.')
  })

  it('keeps the ticks when only what it becomes changes', async () => {
    const t = await setup()
    t.f.find.value = 'lamp'
    await vi.advanceTimersByTimeAsync(200)
    t.f.toggle([...t.f.ticked.value][0]!)
    t.f.replace.value = 'torch'
    await vi.advanceTimersByTimeAsync(200)
    expect(t.f.count.value).toBe(2)
  })
})
