// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { placeTree } from '@/domain/places'
import { relationshipsOf } from '@/domain/relationships'
import { FakeLocks } from '../../tests/helpers/fake-locks'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { changes, outlineRig, snapshot } from '../../tests/helpers/outline-rig'
import { loadWorkspace } from './load'
import { setDetails } from './outline-actions'
import { addRecord } from './record-actions'
import { WorkspaceSession } from './session'
import {
  addEarth,
  addRelationship,
  movePlace,
  removeRelationship,
  renameRelationship,
} from './world-actions'

const universe = (s: WorkspaceSession) => s.data.universes[0]!.id
const make = (s: WorkspaceSession, type: 'character' | 'place' | 'world', title: string) =>
  addRecord(s, { type, title, universeId: universe(s) })
const meta = (s: WorkspaceSession, id: string) => s.data.records.find((r) => r.meta.id === id)!.meta

async function twoCharacters() {
  const rig = await outlineRig()
  const elena = await make(rig.session, 'character', 'Elena')
  const mirela = await make(rig.session, 'character', 'Mirela')
  return { ...rig, elena, mirela }
}

describe('relationships', () => {
  it('a change or removal made from a stale list is refused: the entry at that place is not the one shown', async () => {
    const { session, elena, mirela } = await twoCharacters()
    const corin = await make(session, 'character', 'Corin')
    await setDetails(session, elena, {
      relationships: [
        { with: mirela, type: 'mentor' },
        { with: corin, type: 'rival' },
      ],
    })
    // another device removed the first entry after this screen listed it: index 0 is now Corin
    await setDetails(session, elena, { relationships: [{ with: corin, type: 'rival' }] })
    await expect(removeRelationship(session, elena, 0, mirela)).rejects.toThrow(/no longer/)
    await expect(renameRelationship(session, elena, 0, mirela, 'x')).rejects.toThrow(/no longer/)
    expect(meta(session, elena).relationships).toEqual([{ with: corin, type: 'rival' }])
  })

  it('an entry written by hand with no words is kept when another is added or removed', async () => {
    const { session, elena, mirela } = await twoCharacters()
    const corin = await make(session, 'character', 'Corin')
    await setDetails(session, elena, { relationships: [{ with: mirela, type: '' }] })
    await addRelationship(session, elena, corin, 'rival')
    expect(meta(session, elena).relationships).toEqual([
      { with: mirela, type: '' },
      { with: corin, type: 'rival' },
    ])
    await removeRelationship(session, elena, 1, corin)
    expect(meta(session, elena).relationships).toEqual([{ with: mirela, type: '' }])
  })

  it('are written on one record only, and read from both sheets', async () => {
    const { session, adapter, elena, mirela } = await twoCharacters()
    const before = await snapshot(adapter)
    await addRelationship(session, elena, mirela, '  mentor ')
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [expect.stringContaining(elena)],
      added: [],
      removed: [],
    })
    expect(meta(session, elena).relationships).toEqual([{ with: mirela, type: 'mentor' }])
    expect(meta(session, mirela).relationships).toBeUndefined()
    const fromMirela = relationshipsOf(session.data.records, mirela)
    expect(fromMirela).toMatchObject([{ side: 'other', holder: elena, type: 'mentor' }])
    // and it is in the file in words an author can read
    expect((await adapter.read(session.pathOf(elena)!))!.text).toContain('relationships:')
    expect(await loadWorkspace(adapter)).toMatchObject({ problems: [] })
  })

  it('can be changed and removed from either sheet: the file that lists it is the one that changes', async () => {
    const { session, adapter, elena, mirela } = await twoCharacters()
    await addRelationship(session, elena, mirela, 'mentor')
    await addRelationship(session, mirela, elena, 'estranged')
    const rows = relationshipsOf(session.data.records, mirela)
    const written = rows.find((r) => r.side === 'other')!
    await renameRelationship(
      session,
      written.holder,
      written.index,
      written.with,
      'mentor, estranged',
    )
    expect(meta(session, elena).relationships).toEqual([
      { with: mirela, type: 'mentor, estranged' },
    ])
    expect(meta(session, mirela).relationships).toEqual([{ with: elena, type: 'estranged' }])
    await removeRelationship(session, written.holder, written.index, written.with)
    expect(meta(session, elena).relationships).toBeUndefined()
    expect(meta(session, mirela).relationships).toHaveLength(1)
    expect((await adapter.read(session.pathOf(elena)!))!.text).not.toContain('relationships')
  })

  it('keeps keys it does not know on a relationship (ADR-0003 rule 6)', async () => {
    const { session, elena, mirela } = await twoCharacters()
    await setDetails(session, elena, {
      relationships: [{ with: mirela, type: 'mentor', since: 'the spring tide' }],
    })
    await renameRelationship(session, elena, 0, mirela, 'teacher')
    expect(meta(session, elena).relationships).toEqual([
      { with: mirela, type: 'teacher', since: 'the spring tide' },
    ])
  })

  it('refuses, in words, no words, itself, a record that is gone, and an entry that is gone', async () => {
    const { session, elena, mirela } = await twoCharacters()
    await expect(addRelationship(session, elena, mirela, '   ')).rejects.toThrow(/Say what/)
    await expect(addRelationship(session, elena, elena, 'self')).rejects.toThrow(/itself/)
    await expect(addRelationship(session, elena, 'chr_zzzzzzzzzz', 'x')).rejects.toThrow(
      /no longer/,
    )
    await expect(removeRelationship(session, elena, 3, mirela)).rejects.toThrow(/no longer/)
    await expect(renameRelationship(session, elena, 0, mirela, 'x')).rejects.toThrow(/no longer/)
    expect(meta(session, elena).relationships).toBeUndefined()
  })
})

async function threePlaces(root = 'Earth') {
  const rig = await outlineRig()
  const earth = await make(rig.session, 'world', root)
  const france = await make(rig.session, 'place', 'France')
  const paris = await make(rig.session, 'place', 'Paris')
  await movePlace(rig.session, france, earth)
  await movePlace(rig.session, paris, france)
  return { ...rig, earth, france, paris }
}

describe('moving a place inside another', () => {
  it('changes one line of the place’s own file, and nothing else', async () => {
    const { session, adapter, earth, paris } = await threePlaces()
    const before = await snapshot(adapter)
    await movePlace(session, paris, earth)
    const diff = changes(before, await snapshot(adapter))
    expect(diff.added).toEqual([])
    expect(diff.changed).toEqual([expect.stringContaining(paris)])
    const text = (await adapter.read(session.pathOf(paris)!))!.text
    expect(text.replace(/parent: "[^"]+"/, 'parent: X')).toBe(
      before.get(session.pathOf(paris)!)!.replace(/parent: "[^"]+"/, 'parent: X'),
    )
    expect(meta(session, paris).parent).toBe(earth)
  })

  it('to the top takes the line away', async () => {
    const { session, adapter, paris } = await threePlaces()
    await movePlace(session, paris, null)
    expect(meta(session, paris).parent).toBeUndefined()
    expect((await adapter.read(session.pathOf(paris)!))!.text).not.toContain('parent')
  })

  it('refuses a cycle and an impossible home, in words, and writes nothing', async () => {
    const { session, adapter, earth, france, paris } = await threePlaces()
    const hero = await make(session, 'character', 'Elena')
    const before = await snapshot(adapter)
    await expect(movePlace(session, earth, paris)).rejects.toThrow(/inside it/)
    await expect(movePlace(session, france, france)).rejects.toThrow(/inside itself/)
    await expect(movePlace(session, paris, hero)).rejects.toThrow(/inside a place or a world/)
    await expect(movePlace(session, hero, null)).rejects.toThrow(/Only a place/)
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })

  it('moving where it already is writes nothing', async () => {
    const { session, adapter, france, earth } = await threePlaces()
    const before = await snapshot(adapter)
    await movePlace(session, france, earth)
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })

  it('a stop at any write leaves every place where it was or where it is going, never lost or looped', async () => {
    const probe = await threePlaces()
    let steps = 0
    probe.adapter.beforeWrite = () => void steps++
    await movePlace(probe.session, probe.paris, probe.earth)
    expect(steps).toBeGreaterThanOrEqual(1)
    for (let stopAt = 1; stopAt <= steps; stopAt++) {
      const rig = await threePlaces()
      let n = 0
      rig.adapter.beforeWrite = () => {
        if (++n === stopAt) throw new Error('disk stopped')
      }
      await movePlace(rig.session, rig.paris, rig.earth).catch(() => undefined)
      rig.adapter.beforeWrite = undefined
      const again = await loadWorkspace(rig.adapter)
      expect(again.problems).toEqual([])
      const parent = again.data.records.find((r) => r.meta.id === rig.paris)!.meta.parent
      expect([rig.france, rig.earth]).toContain(parent)
      const flat = (ns: ReturnType<typeof placeTree>): string[] =>
        ns.flatMap((x) => [x.id, ...flat(x.children)])
      expect(flat(placeTree(again.data.records)).sort()).toEqual(
        [rig.earth, rig.france, rig.paris].sort(),
      )
    }
  })
})

describe('Earth as the root for history writing', () => {
  it('is made once, as a world of the whole universe, and found again', async () => {
    const { session } = await outlineRig()
    const id = await addEarth(session, universe(session))
    expect(meta(session, id)).toMatchObject({
      title: 'Earth',
      type: 'world',
      kind: 'Planet',
      scope: 'universe',
    })
    expect(await addEarth(session, universe(session))).toBe(id)
    expect(session.data.records.filter((r) => r.meta.title === 'Earth')).toHaveLength(1)
  })
})

describe('refusals', () => {
  it('a newer version, another tab, a tab that is still settling: nothing is written', async () => {
    const { adapter, journal, elena, mirela, paris, earth } = await (async () => {
      const t = await threePlaces('Terra')
      const e = await make(t.session, 'character', 'Elena')
      const m = await make(t.session, 'character', 'Mirela')
      return { ...t, elena: e, mirela: m }
    })()
    const before = await snapshot(adapter)
    const refused = async (s: WorkspaceSession) => {
      await expect(addRelationship(s, elena, mirela, 'mentor')).rejects.toThrow()
      await expect(movePlace(s, paris, earth)).rejects.toThrow()
      await expect(addEarth(s, universe(s))).rejects.toThrow()
    }

    // another tab holds the workspace
    const locks = new FakeLocks()
    const first = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    const second = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    expect(second.view().otherTab).toBe(true)
    await refused(second)

    // a tab that has just taken over and is still re-reading the files
    ;(first as unknown as { settling: boolean }).settling = true
    await refused(first)
    ;(first as unknown as { settling: boolean }).settling = false

    // a workspace from a newer Aurelia
    const newer = new MemoryAdapter()
    for (const [path, text] of before)
      newer.putBytes(
        path,
        new TextEncoder().encode(text.replace(/schemaVersion"?: 1/g, (m) => m.replace('1', '2'))),
      )
    const readOnly = await WorkspaceSession.open(newer, { journal, debounceMs: 1e9 })
    expect(readOnly.view().newerVersion).toBe(true)
    await refused(readOnly)

    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
    first.dispose()
    second.dispose()
  })
})
