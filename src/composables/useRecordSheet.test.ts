// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setDetails } from '@/storage/outline-actions'
import { addRecord } from '@/storage/record-actions'
import { useWorkspaceStore } from '@/stores/workspace'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { useRecordSheet } from './useRecordSheet'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('the record sheet', () => {
  it('keeps keys it does not know on a name (ADR-0003 rule 6) when the names are saved', async () => {
    const { session, adapter } = await outlineRig()
    const ws = useWorkspaceStore()
    ws.attach(session)
    const id = await addRecord(session, {
      type: 'character',
      title: 'Elena',
      universeId: session.data.universes[0]!.id,
    })
    await setDetails(session, id, {
      aliases: [{ text: 'Elena', imported: { from: 'notes.txt' } }, { text: 'Vasquez' }],
    })
    const sheet = useRecordSheet(() => id)
    expect(sheet.draft.aliases[0]).toMatchObject({ text: 'Elena', imported: { from: 'notes.txt' } })
    sheet.draft.aliases[1]!.text = 'Lena'
    await sheet.saveAliases()
    const text = (await adapter.read(session.pathOf(id)!))!.text
    expect(text).toContain('imported:')
    expect(text).toContain('notes.txt')
    expect(text).toContain('"Lena"')
    expect(text).not.toContain('match: "auto"')
  })
})

describe('words typed while an earlier field is saving', () => {
  async function sheetOf(type: 'character' | 'research') {
    const { session } = await outlineRig()
    const ws = useWorkspaceStore()
    ws.attach(session)
    const id = await addRecord(session, {
      type,
      title: 'Elena',
      universeId: session.data.universes[0]!.id,
    })
    return { session, id, sheet: useRecordSheet(() => id) }
  }

  it('are not wiped when the save of the field before them lands, but another device’s change still comes in', async () => {
    const { session, id, sheet } = await sheetOf('character')
    sheet.draft.fields.role = 'Hero'
    const saving = sheet.saveField('role')
    sheet.draft.fields.age = '34' // typed into the next field while the first is still being written
    await saving
    await nextTick()
    expect(sheet.draft.fields).toMatchObject({ role: 'Hero', age: '34' })
    await setDetails(session, id, { age: '35' }) // not this sheet's own save: it is shown
    await nextTick()
    expect(sheet.draft.fields.age).toBe('35')
  })

  it('a source typed after the save of the one before it is not wiped either', async () => {
    const { session, id, sheet } = await sheetOf('research')
    sheet.addSource()
    sheet.draft.sources[0]!.title = 'The Ledger of Tides'
    const saving = sheet.saveSources()
    sheet.draft.sources[0]!.author = 'Corvin Hale' // typed while the title is being written
    await saving
    await nextTick()
    expect(sheet.draft.sources).toEqual([{ title: 'The Ledger of Tides', author: 'Corvin Hale' }])
    await setDetails(session, id, { sources: [{ title: 'Another', url: 'https://example.org' }] })
    await nextTick()
    expect(sheet.draft.sources).toEqual([{ title: 'Another', url: 'https://example.org' }])
  })

  it('survive several saves in flight at once: each landing is recognised as this sheet’s own, in order', async () => {
    const { sheet } = await sheetOf('research')
    sheet.addSource()
    const source = sheet.draft.sources[0]!
    source.title = 'The Ledger of Tides'
    const first = sheet.saveSources()
    source.author = 'Corvin Hale'
    const second = sheet.saveSources() // the next field was left before the first save landed
    source.url = 'https://example.org/ledger' // and typing goes on
    await first
    await nextTick()
    expect(sheet.draft.sources[0]).toMatchObject({
      author: 'Corvin Hale',
      url: 'https://example.org/ledger',
    })
    await second
    await nextTick()
    expect(sheet.draft.sources[0]).toMatchObject({ url: 'https://example.org/ledger' })
  })
})
