// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { addChange } from '@/storage/continuity-actions'
import { setDetails } from '@/storage/outline-actions'
import { addRecord } from '@/storage/record-actions'
import { setBookMode } from '@/storage/story-actions'
import { storyRig } from '../../tests/helpers/story-rig'
import { inComponent } from '../../tests/helpers/in-component'
import { useEditsStore } from '@/stores/edits'
import { useChangeForm } from './useChangeForm'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
beforeEach(() => localStorage.clear())

/** Three scenes (Start, Left, Right), two characters, a place, an item; Elena is the point of view of Start. */
async function rig() {
  const r = await storyRig()
  const unv = r.session.data.universes[0]!.id
  const make = (type: 'character' | 'place' | 'item', title: string) =>
    addRecord(r.session, { type, title, universeId: unv })
  const [elena, tomas, gate, key] = [
    await make('character', 'Elena'),
    await make('character', 'Tomas'),
    await make('place', 'The Gate'),
    await make('item', 'The Key'),
  ]
  await setDetails(r.session, r.start, { pov: elena, characters: { add: [tomas] } })
  const form = inComponent(() => useChangeForm(() => r.start))
  return { ...r, form, elena, tomas, gate, key }
}
const changesOf = (r: Awaited<ReturnType<typeof rig>>, scene = r.start) =>
  r.session.data.scenes.find((s) => s.meta.id === scene)!.meta.changes ?? []

describe('the board that records what changes in a scene', () => {
  it('starts on the point of view, with the people on the page offered first', async () => {
    const r = await rig()
    r.form.startAdd()
    expect(r.form.open.value).toBe(true)
    expect(r.form.f.who).toBe(r.elena)
    expect(r.form.present.value).toEqual([r.elena, r.tomas])
    expect(r.form.options.value.items.map((i) => i.label)).toEqual(['The Key'])
  })

  it('adds a "learns" change in the scene file, closes, and starts the next one clean', async () => {
    const r = await rig()
    r.form.startAdd()
    r.form.choose('knows')
    r.form.f.value = ' Her mother is alive '
    await r.form.save()
    expect(r.form.open.value).toBe(false)
    expect(changesOf(r)).toEqual([{ kind: 'knows', who: r.elena, value: 'Her mother is alive' }])
    r.form.startAdd()
    expect(r.form.f.value).toBe('')
  })

  it('writes each pick as its own kind: an item gained or lost, a death, a place, a set-up with its own ID', async () => {
    const r = await rig()
    const add = async (pick: Parameters<typeof r.form.choose>[0], set: () => void) => {
      r.form.startAdd()
      r.form.choose(pick)
      set()
      await r.form.save()
      expect(r.form.error.value).toBe('')
    }
    await add('item', () => ((r.form.f.item = r.key), (r.form.f.gains = true)))
    await add('item', () => ((r.form.f.item = r.key), (r.form.f.gains = false)))
    await add('status', () => ((r.form.f.who = r.tomas), (r.form.f.status = 'dead')))
    await add('location', () => (r.form.f.place = r.gate))
    await add('setup', () => (r.form.f.value = 'The key under the lantern'))
    const saved = changesOf(r)
    expect(saved.map((c) => c.kind)).toEqual(['holds', 'loses', 'status', 'location', 'setup'])
    expect(saved[2]).toMatchObject({ who: r.tomas, value: 'dead' })
    expect(saved[3]).toMatchObject({ who: r.elena, with: r.gate })
    expect(saved[4]!.id).toMatch(/^stp_/)
    // a pay-off in the next scene offers the open set-up
    const payoff = inComponent(() => useChangeForm(() => r.left))
    expect(payoff.setups.value).toEqual([
      { value: saved[4]!.id, label: '“The key under the lantern” (1.1)', open: true },
    ])
  })

  it('shows what a relationship was as of this scene, and stores "was → now"', async () => {
    const r = await rig()
    await setBookMode(r.session, r.book, 'linear') // the scenes read one after the other
    await addChange(r.session, r.start, {
      kind: 'relation',
      who: r.tomas,
      with: r.elena,
      value: 'stranger',
    })
    const later = inComponent(() => useChangeForm(() => r.left))
    later.startAdd(r.tomas)
    later.choose('relation')
    later.f.with = r.elena
    expect(later.was.value).toBe('stranger')
    later.f.value = 'creditor'
    expect(later.preview.value).toBe('From 1.2 on, Tomas sees Elena as creditor (was: stranger).')
    await later.save()
    expect(changesOf(r, r.left)[0]).toMatchObject({
      kind: 'relation',
      value: 'stranger → creditor',
    })
  })

  it('refuses an unfinished change in words and writes nothing; what was typed stays', async () => {
    const r = await rig()
    r.form.startAdd()
    r.form.choose('relation')
    r.form.f.value = 'rival'
    await r.form.save()
    expect(r.form.error.value).toBe('Pick who they feel this way about.')
    expect(r.form.open.value).toBe(true)
    expect(r.form.f.value).toBe('rival')
    expect(changesOf(r)).toEqual([])
  })

  it('opens a change to correct it with its own words, saves it in place, and removes one', async () => {
    const r = await rig()
    await addChange(r.session, r.start, { kind: 'knows', who: r.elena, value: 'one' })
    await addChange(r.session, r.start, { kind: 'status', who: r.tomas, value: 'dead' })
    await nextTick()
    r.form.startEdit(0)
    expect(r.form.editing.value?.at).toBe(0)
    expect(r.form.f).toMatchObject({ pick: 'knows', who: r.elena, value: 'one' })
    r.form.f.value = 'one, corrected'
    await r.form.save()
    expect(changesOf(r).map((c) => c.value)).toEqual(['one, corrected', 'dead'])
    r.form.startEdit(1)
    expect(r.form.f).toMatchObject({ pick: 'status', status: 'dead' })
    await r.form.remove(0)
    expect(changesOf(r)).toEqual([{ kind: 'status', who: r.tomas, value: 'dead' }])
  })

  it('presses twice, saves once: a second Add while the first is being written does nothing', async () => {
    const r = await rig()
    r.form.startAdd()
    r.form.choose('knows')
    r.form.f.value = 'Her mother is alive'
    const first = r.form.save()
    const second = r.form.save()
    expect(await second).toBe(false)
    await first
    expect(changesOf(r)).toHaveLength(1)
    expect(r.form.saving.value).toBe(false)
  })

  it('opens on the words selected in the scene, as the quote', async () => {
    const r = await rig()
    r.form.startAdd(undefined, '  He reached for the lantern.  ')
    expect(r.form.f.quote).toBe('He reached for the lantern.')
    r.form.choose('knows')
    r.form.f.value = 'x'
    await r.form.save()
    expect(changesOf(r)[0]!.quote).toBe('He reached for the lantern.')
  })

  it('removes a change with an Undo that puts it back where it was', async () => {
    const r = await rig()
    for (const value of ['one', 'two', 'three'])
      await addChange(r.session, r.start, { kind: 'knows', who: r.elena, value })
    await r.form.remove(1)
    expect(changesOf(r).map((c) => c.value)).toEqual(['one', 'three'])
    const toast = useEditsStore().toast!
    expect(toast.text).toBe('Removed a change.')
    await toast.undo!()
    expect(changesOf(r).map((c) => c.value)).toEqual(['one', 'two', 'three'])
  })

  it('does not offer to edit a kind it does not know, and says so when a change moved on elsewhere', async () => {
    const r = await rig()
    await addChange(r.session, r.start, { kind: 'knows', who: r.elena, value: 'one' })
    r.form.startEdit(3) // no such change
    expect(r.form.open.value).toBe(false)
    r.form.startEdit(0)
    // the file moves on (another tab) while the board is open
    await r.session.setFields(r.start, { changes: [{ kind: 'knows', who: r.elena, value: 'two' }] })
    await r.form.save()
    expect(r.form.error.value).toContain('edited somewhere else')
    expect(changesOf(r)[0]!.value).toBe('two')
  })
})
