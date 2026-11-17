// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import MediaImage from '@/components/media/MediaImage.vue'
import { importMedia } from '@/storage/media-actions'
import { addRecord } from '@/storage/record-actions'
import { addRelationship } from '@/storage/world-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { outlineRig } from '../../../tests/helpers/outline-rig'
import NewNames from './NewNames.vue'
import RecordSheet from './RecordSheet.vue'
import RelationshipsTab from './RelationshipsTab.vue'

const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x80]) as Uint8Array<ArrayBuffer>
const text = (w: { text(): string }) => w.text().replace(/\s+/g, ' ')

beforeEach(() => localStorage.clear())

async function open() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const rig = await outlineRig()
  const ws = useWorkspaceStore()
  ws.attach(rig.session)
  ws.select(rig.session.data.books[0]!.id)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)*', component: { render: () => null } }],
  })
  await router.push('/')
  const unv = rig.session.data.universes[0]!.id
  return {
    ...rig,
    ws,
    unv,
    mount: (c: Parameters<typeof mount>[0], props = {}) =>
      mount(c, { props, global: { plugins: [pinia, router] }, attachTo: document.body }),
  }
}

describe('a relationship written on the other record', () => {
  it('reads from there ("Elena lists Mirela as mentor"), not as if it were this sheet’s own', async () => {
    const { session, unv, mount: mountIt } = await open()
    const elena = await addRecord(session, { type: 'character', title: 'Elena', universeId: unv })
    const mirela = await addRecord(session, { type: 'character', title: 'Mirela', universeId: unv })
    await addRelationship(session, elena, mirela, 'mentor')
    const own = mountIt(RelationshipsTab, { id: elena, name: 'Elena' })
    expect(text(own)).toContain('Mirela')
    expect(text(own)).not.toMatch(/lists Elena as/)
    expect(text(own)).toContain('mentor')
    const other = mountIt(RelationshipsTab, { id: mirela, name: 'Mirela' })
    expect(text(other)).toContain('Elena')
    expect(text(other)).toContain('lists Mirela as “mentor”')
    own.unmount()
    other.unmount()
  })
})

describe('words said not to be names', () => {
  const body = 'They sailed to Greywater at dusk. The bells of Greywater rang, and Greywater slept.'

  it('are listed under "Words you said are not names", each with Give back, and the button says what it does', async () => {
    const { session, mount: mountIt } = await open()
    await session.editScene(session.data.scenes[0]!.meta.id, body)
    await session.flush()
    const w = mountIt(NewNames)
    await flushPromises()
    const notAName = w.find('button[aria-label^="Not a name"]')
    expect(notAName.attributes('aria-label')).toBe(
      'Not a name: stop offering Greywater in this book',
    )
    expect(w.find('details').exists()).toBe(false) // nothing said yet
    await notAName.trigger('click')
    await vi.waitFor(() => expect(text(w)).toContain('No new names.'))
    expect(text(w)).toContain('Words you said are not names (1)')
    expect(text(w)).toContain('Greywater')
    await w.find('button[aria-label^="Give back Greywater"]').trigger('click')
    await vi.waitFor(() => expect(w.find('details').exists()).toBe(false))
    expect(text(w)).toContain('Greywater')
    expect(text(w)).toContain('Create place')
    expect(session.data.books[0]!.notNames).toBeUndefined()
    w.unmount()
  })

  it('"Create character" tells what it made and offers to open it', async () => {
    const { session, mount: mountIt } = await open()
    await session.editScene(session.data.scenes[0]!.meta.id, body)
    await session.flush()
    const w = mountIt(NewNames)
    await flushPromises()
    await w.find('button[aria-label="Create character Greywater"]').trigger('click')
    await vi.waitFor(() =>
      expect(useEditsStore().toast).toMatchObject({
        text: 'Made “Greywater” a character.',
        action: { label: 'Open' },
      }),
    )
    w.unmount()
  })
})

describe('an image whose file is missing', () => {
  it('says so in words, and is not mistaken for one still loading', async () => {
    const { session, adapter, unv, mount: mountIt } = await open()
    const id = await importMedia(session, unv, { name: 'map.png', bytes: IMAGE })
    const found = mountIt(MediaImage, { id, alt: 'The map' })
    expect(found.find('[role=img]').attributes('aria-label')).toBe('The map (loading)')
    await flushPromises()
    expect(found.find('img').exists()).toBe(true) // the file was there
    found.unmount()

    // the file leaves the folder (another app, a sync that did not finish): the listing stays
    const other = await importMedia(session, unv, { name: 'gone.png', bytes: IMAGE })
    await adapter.remove(`universes/${unv}/media/${other}.png`)
    const gone = mountIt(MediaImage, { id: other, alt: 'The map' })
    expect(text(gone)).not.toContain('File is missing') // asked, not yet answered
    await flushPromises()
    expect(text(gone)).toContain('File is missing')
    expect(gone.find('[role=img]').attributes('aria-label')).toBe('The map: file is missing')
    expect(gone.find('img').exists()).toBe(false)
    gone.unmount()
  })
})

describe('the record sheet', () => {
  it('has Notes as a tab, and the Summary once, in the Overview', async () => {
    const { session, unv, mount: mountIt } = await open()
    const id = await addRecord(session, { type: 'item', title: 'The Lantern Key', universeId: unv })
    const w = mountIt(RecordSheet, { id })
    await flushPromises()
    const tabs = w.findAll('[role=tab]').map((t) => t.text())
    expect(tabs).toEqual(['Overview', 'Notes'])
    expect(w.findAll('label').filter((l) => l.text() === 'Summary')).toHaveLength(1)
    expect(w.find('[role=textbox][aria-label^="Notes"]').exists()).toBe(false) // not on the Overview
    w.unmount()
  })

  it('a character has Progression, Relationships, Appearances and Voice between the Overview and the Notes', async () => {
    const { session, unv, mount: mountIt } = await open()
    const id = await addRecord(session, { type: 'character', title: 'Elena', universeId: unv })
    const w = mountIt(RecordSheet, { id })
    await flushPromises()
    expect(w.findAll('[role=tab]').map((t) => t.text())).toEqual([
      'Overview',
      'Progression',
      'Relationships',
      'Appearances',
      'Voice',
      'Notes',
    ])
    w.unmount()
  })
})
