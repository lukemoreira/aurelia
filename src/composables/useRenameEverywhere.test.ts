// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { addRecord } from '@/storage/record-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { useOutlineEdits } from './useOutlineEdits'
import { useRenameEverywhere } from './useRenameEverywhere'

beforeEach(() => localStorage.clear())

/** A workspace with Elena (and "Elena", "Lena" as other names) named in two scenes and a note. */
async function setup(bodies: string[]) {
  const rig = await outlineRig()
  const s = rig.session
  const pinia = createPinia()
  setActivePinia(pinia)
  const ws = useWorkspaceStore()
  ws.attach(s)
  const universeId = s.data.universes[0]!.id
  const elena = await addRecord(s, { type: 'character', title: 'Elena Vasquez', universeId })
  await s.setFields(elena, { aliases: [{ text: 'Elena' }, { text: 'Lena' }] })
  const ids = [s.data.scenes[0]!.meta.id, await s.createScene(s.data.chapters[0]!.id)]
  for (const [i, body] of bodies.entries()) await s.editScene(ids[i]!, body)
  await s.flush()

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)*', component: { render: () => null } }],
  })
  let rename!: ReturnType<typeof useRenameEverywhere>
  let edit!: ReturnType<typeof useOutlineEdits>
  mount(
    defineComponent({
      setup: () => ((rename = useRenameEverywhere()), (edit = useOutlineEdits()), () => h('div')),
    }),
    { global: { plugins: [pinia, router] } },
  )
  await router.push('/')
  const edits = useEditsStore()
  /** What the author does: Rename… on the record, type a name, Save. The name dialog then closes. */
  async function renameTo(name: string) {
    edit.rename(elena)
    await edits.ask!.run(name)
    edits.ask = null
    await flushPromises()
    await vi.advanceTimersByTimeAsync(10)
  }
  const text = async (id: string) => (await rig.adapter.read(s.pathOf(id)!))!.text
  return { ...rig, ws, edits, rename, edit, renameTo, elena, ids, text }
}

describe('Rename everywhere', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout'] }))

  it('opens after the rename, with the places and every uncertain one unticked, and writes nothing yet', async () => {
    const t = await setup([
      'Elena ran. Will you?\n',
      'They sang “Elena of the Tides”. Elena hid.\n',
    ])
    const before = await t.text(t.ids[1]!)
    await t.renameTo('Helena Vasquez')
    expect(t.rename.open.value).toBe(true)
    expect(t.rename.forms.value).toEqual([
      { from: 'Elena Vasquez', to: 'Helena Vasquez' },
      { from: 'Elena', to: 'Helena' },
      { from: 'Lena', to: 'Lena' },
    ])
    expect(t.rename.total.value).toBe(3)
    expect(t.rename.uncertain.value.map((p) => p.uncertain)).toEqual([
      'Uncertain — inside a title in quotes',
    ])
    expect(t.rename.count.value).toBe(2)
    expect(await t.text(t.ids[1]!)).toBe(before)
  })

  it('does not open when the old name is written nowhere', async () => {
    const t = await setup(['Nothing about her.\n'])
    await t.renameTo('Helena Vasquez')
    expect(t.rename.open.value).toBe(false)
    expect(t.edits.renameOffer).toBe(null)
  })

  it('does not open before the name dialog has closed', async () => {
    const t = await setup(['Elena ran.\n'])
    t.edit.rename(t.elena)
    await t.edits.ask!.run('Helena Vasquez')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(10)
    expect(t.rename.open.value).toBe(false)
    t.edits.ask = null
    await flushPromises()
    await vi.advanceTimersByTimeAsync(10)
    expect(t.rename.open.value).toBe(true)
  })

  it('finds the places again when a form is changed, keeping the ticks the author gave', async () => {
    const t = await setup(['Elena ran. Lena hid. Elena Vasquez came.\n'])
    await t.renameTo('Helena Vasquez')
    const first = t.rename.plan.value!.places[0]!.key
    t.rename.toggle(first)
    t.rename.setForm(2, 'Lenka') // "Lena" is no longer kept
    expect(t.rename.total.value).toBe(3)
    expect(t.rename.ticked.value.has(first)).toBe(false)
    expect(t.rename.count.value).toBe(2)
    t.rename.setForm(2, '  ') // a blank form is a form kept
    expect(t.rename.total.value).toBe(2)
  })

  it('changes the ticked places, writes the other names, says how the old text was kept, and one Undo puts it all back', async () => {
    const t = await setup(['Elena ran. Elena’s hat.\n', 'Elena hid.\n'])
    const before = await Promise.all([...t.ids, t.elena].map((i) => t.text(i)))
    await t.renameTo('Helena Vasquez')
    await t.rename.apply()
    await t.ws.session!.flush()
    expect(t.rename.open.value).toBe(false)
    expect(await t.text(t.ids[0]!)).toContain('Helena ran. Helena’s hat.')
    expect(await t.text(t.ids[1]!)).toContain('Helena hid.')
    expect(t.ws.data!.records[0]!.meta.aliases).toEqual([{ text: 'Helena' }, { text: 'Lena' }])
    expect(t.edits.toast!.text).toBe(
      'Changed 3 places in 2 scenes and notes. A copy of each file was kept first, in the .aurelia folder.',
    )
    await t.edits.toast!.undo!()
    await t.ws.session!.flush()
    expect(t.edits.toast!.text).toBe('Put 2 files back.')
    // The scenes and the other names are as they were; the new title stays (it was its own step).
    expect(await t.text(t.ids[0]!)).toBe(before[0])
    expect(await t.text(t.ids[1]!)).toBe(before[1])
    expect(t.ws.data!.records[0]!.meta.aliases).toEqual([{ text: 'Elena' }, { text: 'Lena' }])
  })

  it('says it stopped, how far it got, and offers Undo, when a file cannot be written', async () => {
    const t = await setup(['Elena ran.\n', 'Elena hid.\n'])
    await t.renameTo('Helena Vasquez')
    const path = t.ws.session!.pathOf(t.ids[1]!)!
    await t.adapter.write(path, `${await t.text(t.ids[1]!)}Another app wrote this.\n`)
    await t.rename.apply()
    expect(t.edits.toast!.error).toBe(true)
    expect(t.edits.toast!.text).toMatch(
      /^Stopped: “.+” could not be saved\. 1 place in 1 scene or note were changed before it\./,
    )
    expect(await t.text(t.ids[1]!)).toContain('Another app wrote this.')
    expect(await t.text(t.ids[0]!)).toContain('Helena ran.')
    await t.edits.toast!.undo!()
    await t.ws.session!.flush()
    expect(await t.text(t.ids[0]!)).toContain('Elena ran.')
  })

  it('leaves the text alone when the author unticks everything', async () => {
    const t = await setup(['Elena ran.\n'])
    await t.renameTo('Helena Vasquez')
    t.rename.tickAll(false)
    expect(t.rename.count.value).toBe(0)
    t.rename.cancel()
    expect(await t.text(t.ids[0]!)).toContain('Elena ran.')
  })

  it('uses a blank form as a form kept, and a form without the spaces around it, for the other names too', async () => {
    const t = await setup(['Elena ran. Lena hid.\n'])
    await t.renameTo('Helena Vasquez')
    t.rename.setForm(1, '   ') // "Elena" is kept
    t.rename.setForm(2, ' Nell ')
    await t.rename.apply()
    await t.ws.session!.flush()
    expect(t.ws.data!.records[0]!.meta.aliases).toEqual([{ text: 'Elena' }, { text: 'Nell' }])
    expect(await t.text(t.ids[0]!)).toContain('Elena ran. Nell hid.')
  })

  it('"Tick all" ticks the certain places only, and says how far the old name is written', async () => {
    const t = await setup(['They sang “Elena of the Tides”. Elena hid.\n', 'Elena ran.\n'])
    await t.renameTo('Helena Vasquez')
    t.rename.tickAll(false)
    t.rename.tickAll(true)
    expect(t.rename.count.value).toBe(2)
    expect(t.rename.uncertain.value).toHaveLength(1)
    expect(t.rename.reach.value).toBe('1 book · 2 scenes')
  })

  it('lists the places left as they are, after the change, and says only what is true of the old texts', async () => {
    const t = await setup(['They sang “Elena of the Tides”. Elena hid.\n'])
    await t.renameTo('Helena Vasquez')
    await t.rename.apply()
    expect(t.rename.open.value).toBe(true)
    expect(t.rename.result.value!.changed).toBe(1)
    expect(t.rename.result.value!.left.map((p) => p.old)).toEqual(['Elena'])
    // A version that did not reach a server (no backup here) is not claimed.
    expect(t.edits.toast!.text).not.toContain('version')
    expect(t.edits.toast!.text).toContain('A copy of each file was kept first')
    t.rename.cancel()
    expect(t.rename.open.value).toBe(false)
  })
})
