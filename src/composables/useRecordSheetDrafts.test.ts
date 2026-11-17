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

async function sheetOf() {
  const { session } = await outlineRig()
  useWorkspaceStore().attach(session)
  const id = await addRecord(session, {
    type: 'character',
    title: 'Elena',
    universeId: session.data.universes[0]!.id,
  })
  return { session, id, sheet: useRecordSheet(() => id) }
}

describe('what is typed is kept while a save lands', () => {
  it('an empty name row is not lost when another name saves, and typing into it goes on', async () => {
    const { sheet } = await sheetOf()
    sheet.addAlias()
    sheet.draft.aliases[0]!.text = 'Lena'
    const saving = sheet.saveAliases()
    sheet.addAlias() // a second row, still empty
    sheet.draft.aliases[1]!.text = 'Vasq' // being typed
    await saving
    await nextTick()
    expect(sheet.draft.aliases.map((a) => a.text)).toEqual(['Lena', 'Vasq'])
    sheet.addAlias() // and an empty row beside them
    sheet.draft.aliases[0]!.text = 'Lena V'
    await sheet.saveAliases()
    await nextTick()
    expect(sheet.draft.aliases.map((a) => a.text)).toEqual(['Lena V', 'Vasq', ''])
  })

  it('a name changed on another device still comes in', async () => {
    const { session, id, sheet } = await sheetOf()
    await setDetails(session, id, { aliases: [{ text: 'Lena' }] })
    await nextTick()
    expect(sheet.draft.aliases.map((a) => a.text)).toEqual(['Lena'])
  })

  it('the summary typed after a save began is not wiped when it lands, but another device’s still comes in', async () => {
    const { session, id, sheet } = await sheetOf()
    sheet.draft.summary = 'A smuggler'
    const first = sheet.saveSummary()
    sheet.draft.summary = 'A smuggler’s daughter' // typed on while the first is being written
    await first
    await nextTick()
    expect(sheet.draft.summary).toBe('A smuggler’s daughter')
    await setDetails(session, id, { summary: 'From elsewhere' })
    await nextTick()
    expect(sheet.draft.summary).toBe('From elsewhere')
  })

  it('a save that fails keeps every draft on screen and says why', async () => {
    const { session, sheet } = await sheetOf()
    sheet.draft.summary = 'Typed, not saved'
    sheet.draft.fields.role = 'Hero'
    sheet.addAlias()
    sheet.draft.aliases[0]!.text = 'Lena'
    ;(session as unknown as { otherTab: boolean }).otherTab = true // another tab writes now
    await sheet.saveField('role')
    expect(sheet.error.value).toMatch(/another tab|read-only|cannot/i)
    expect(sheet.draft.summary).toBe('Typed, not saved')
    expect(sheet.draft.fields.role).toBe('Hero')
    expect(sheet.draft.aliases.map((a) => a.text)).toEqual(['Lena'])
    await nextTick()
    expect(sheet.draft.summary).toBe('Typed, not saved')
  })
})
