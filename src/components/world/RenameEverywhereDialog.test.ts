// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { outlineRig } from '../../../tests/helpers/outline-rig'
import { addRecord } from '@/storage/record-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import RenameEverywhereDialog from './RenameEverywhereDialog.vue'

/** Elena, named `n` times in one scene plus one title in quotes, and renamed: the dialog is then open. */
async function open(n: number) {
  const rig = await outlineRig()
  const s = rig.session
  const pinia = createPinia()
  setActivePinia(pinia)
  const ws = useWorkspaceStore()
  ws.attach(s)
  const elena = await addRecord(s, {
    type: 'character',
    title: 'Elena Vasquez',
    universeId: s.data.universes[0]!.id,
  })
  await s.setFields(elena, { aliases: [{ text: 'Elena' }, { text: 'Lena' }] })
  await s.editScene(
    s.data.scenes[0]!.meta.id,
    `${'Elena ran. '.repeat(n)}They sang “Elena of the Tides”.\n`,
  )
  await s.flush()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)*', component: { render: () => null } }],
  })
  await router.push('/')
  const wrapper = mount(RenameEverywhereDialog, {
    global: { plugins: [pinia, router] },
    attachTo: document.body,
  })
  const edits = useEditsStore()
  edits.renameOffer = {
    recordId: elena,
    before: { title: 'Elena Vasquez', aliases: [{ text: 'Elena' }, { text: 'Lena' }] },
  }
  await (await import('@/storage/outline-actions')).renameItem(s, elena, 'Helena Vasquez')
  await flushPromises()
  await vi.advanceTimersByTimeAsync(10)
  await flushPromises()
  return { wrapper, edits, ws }
}
const dom = () => document.body
const rows = () => dom().querySelectorAll('input[type="checkbox"]')
const button = (re: RegExp) =>
  [...dom().querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''))!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('the Rename everywhere dialog', () => {
  it('shows only the forms that are written somewhere, and how far the old name reaches', async () => {
    await open(3)
    const t = dom().textContent!
    expect(dom().querySelector('input[aria-label="New form for Elena"]')).toBeTruthy()
    // "Lena" and the full name are written nowhere: no row for them.
    expect(dom().querySelector('input[aria-label="New form for Lena"]')).toBeNull()
    expect(dom().querySelector('input[aria-label="New form for Elena Vasquez"]')).toBeNull()
    expect(t).toContain('Places · 1 book · 1 scene')
    expect(t).toContain('A copy of each changed file is kept first')
    expect(t).not.toContain('A version is saved first')
  })

  it('shows the first places, and more when asked', async () => {
    await open(200)
    expect(rows().length).toBe(150)
    button(/Show more/)!.click()
    await flushPromises()
    expect(rows().length).toBe(201)
  })

  it('"Tick all certain" never ticks an uncertain place, and says it', async () => {
    await open(3)
    expect([...rows()].filter((r) => (r as HTMLInputElement).checked)).toHaveLength(3)
    button(/Untick all/)!.click()
    await flushPromises()
    expect([...rows()].filter((r) => (r as HTMLInputElement).checked)).toHaveLength(0)
    button(/Tick all certain/)!.click()
    await flushPromises()
    const ticked = [...rows()].filter((r) => (r as HTMLInputElement).checked)
    expect(ticked).toHaveLength(3) // the title in quotes is the fourth, and stays out
    expect(dom().textContent).toContain('inside a title in quotes')
  })

  it('after the change, lists the places that were left as they are', async () => {
    const { ws } = await open(2)
    button(/^Change 2 places/)!.click()
    for (let i = 0; i < 20; i++) {
      await flushPromises()
      await vi.advanceTimersByTimeAsync(20)
    }
    await ws.session!.flush()
    await flushPromises()
    const t = dom().textContent!
    expect(t).toContain('Changed 2 places. These 1 place were left as they are.')
    expect(dom().querySelector('[aria-label="Places left as they are"]')!.textContent).toContain(
      'inside a title in quotes',
    )
    button(/^Done/)!.click()
    await flushPromises()
    expect(dom().textContent).not.toContain('Places left as they are')
  })
})
