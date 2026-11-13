// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
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
