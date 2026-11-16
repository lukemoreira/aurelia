// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { addRecord } from '@/storage/record-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { useNotAName } from './useSceneNames'

beforeEach(() => localStorage.clear())

async function setup() {
  const rig = await outlineRig()
  const s = rig.session
  setActivePinia(createPinia())
  const ws = useWorkspaceStore()
  ws.attach(s)
  const will = await addRecord(s, {
    type: 'character',
    title: 'Will Ashby',
    universeId: s.data.universes[0]!.id,
  })
  await s.setFields(will, { aliases: [{ text: 'Will' }] })
  const scene = s.data.scenes[0]!.meta.id
  await s.editScene(scene, 'Will you stop? Will ran.\n')
  await s.flush()
  const ignored = () => ws.data!.scenes.find((x) => x.meta.id === scene)!.meta.ignoreNames
  return { ws, s, scene, ignored, edits: useEditsStore(), notAName: useNotAName() }
}

describe('"not a name", from anywhere', () => {
  it('writes the answer, says so, and Undo puts the scene’s answers back as they were', async () => {
    const t = await setup()
    await t.notAName(t.scene, ['Will:1', 'Will:2'])
    expect(t.ignored()).toEqual(['Will:1', 'Will:2'])
    expect(t.edits.toast!.text).toBe('Marked 2 places as not a name.')
    await t.edits.toast!.undo!()
    await t.s.flush()
    expect(t.ignored()).toBeUndefined()
    // …and with an earlier answer, back to that one.
    await t.notAName(t.scene, ['Will:1'])
    await t.notAName(t.scene, ['Will:2'])
    expect(t.edits.toast!.text).toBe('Marked as not a name.')
    await t.edits.toast!.undo!()
    await t.s.flush()
    expect(t.ignored()).toEqual(['Will:1'])
  })

  it('says it could not, and changes nothing, when the scene is gone', async () => {
    const t = await setup()
    await t.notAName('scn_gone000001', ['Will:1'])
    expect(t.edits.toast!.error).toBe(true)
    expect(t.ignored()).toBeUndefined()
  })
})
