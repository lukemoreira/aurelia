// SPDX-License-Identifier: AGPL-3.0-or-later
// The story base (ADR-0016): written by hand, and by an accepted suggestion (a base section, a character).
import { beforeEach, describe, expect, it } from 'vitest'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { newId } from '@/domain/ids'
import { proposalPath, type Proposal } from '@/domain/proposals'
import { baseOf } from '@/domain/story-base'
import { OUT_OF_DATE, acceptProposal, stillApplies } from './proposal-actions'
import { restoreBook } from './snapshot-restore'
import { listSnapshots, readSnapshot } from './snapshots'
import { setBaseSection } from './story-base-actions'
import type { WorkspaceSession } from './session'

type Rig = Awaited<ReturnType<typeof outlineRig>>
let rig: Rig
beforeEach(async () => {
  rig = await outlineRig()
})

const bookOf = (s: WorkspaceSession) => s.data.books[0]!
const base = (s: WorkspaceSession) => baseOf(bookOf(s))

async function write<P extends Proposal>(s: WorkspaceSession, p: P): Promise<P> {
  await s.adapter.write(proposalPath(p.id), JSON.stringify(p))
  return p
}
const common = () => ({
  schemaVersion: 1 as const,
  id: newId('prp'),
  createdAt: new Date().toISOString(),
  by: 'Claude',
  why: 'From your answers.',
})
const baseProposal = (
  s: WorkspaceSession,
  sections: Record<string, { before: string; after: string }>,
) =>
  write(s, {
    ...common(),
    kind: 'base',
    bookId: bookOf(s).id,
    bookTitle: bookOf(s).title,
    sections,
  })
const characterProposal = (s: WorkspaceSession, name = 'Tomas Brandt') =>
  write(s, {
    ...common(),
    kind: 'character',
    bookId: bookOf(s).id,
    name,
    summary: 'A customs clerk.',
    fields: { role: 'Protagonist', goal: 'To leave the port', fear: '' },
  })

describe('the story base by hand', () => {
  it('is kept in book.json, one section at a time, and an emptied base takes the key away', async () => {
    const s = rig.session
    const path = s.pathOf(bookOf(s).id)!
    await setBaseSection(s, bookOf(s).id, 'objectives', 'A slow-burn mystery for adults.')
    await setBaseSection(s, bookOf(s).id, 'world', 'A port city under a dying empire.')
    expect(base(s)).toEqual({
      objectives: 'A slow-burn mystery for adults.',
      world: 'A port city under a dying empire.',
      narrative: '',
    })
    const saved = JSON.parse((await rig.adapter.read(path))!.text)
    expect(saved.storyBase).toEqual({
      objectives: 'A slow-burn mystery for adults.',
      world: 'A port city under a dying empire.',
    })
    expect(saved.title).toBe('My Book') // the rest of the file stays
    await setBaseSection(s, bookOf(s).id, 'objectives', '')
    await setBaseSection(s, bookOf(s).id, 'world', '  ')
    expect('storyBase' in JSON.parse((await rig.adapter.read(path))!.text)).toBe(false)
    // Read again from the files, by a new session.
    await setBaseSection(s, bookOf(s).id, 'narrative', 'Tomas finds the ledger.')
    const again = await rig.open()
    expect(baseOf(again.data.books[0]).narrative).toBe('Tomas finds the ledger.')
  })
})

describe('Accept of a story-base suggestion', () => {
  it('fills empty sections with no snapshot (nothing is overwritten), and leaves the others as they are', async () => {
    const s = rig.session
    await setBaseSection(s, bookOf(s).id, 'narrative', 'Mine.')
    const p = await baseProposal(s, { objectives: { before: '', after: 'A mystery.' } })
    const done = await acceptProposal(s, p)
    expect(done).toMatchObject({ id: bookOf(s).id, cleared: true })
    expect(done.snapshot).toBeUndefined()
    expect(base(s)).toEqual({ objectives: 'A mystery.', world: '', narrative: 'Mine.' })
    expect(await s.adapter.read(proposalPath(p.id))).toBeNull()
  })

  it('takes a "Before a suggestion" snapshot of the book first when it replaces the author’s text', async () => {
    const s = rig.session
    await setBaseSection(s, bookOf(s).id, 'world', 'An island.')
    const p = await baseProposal(s, { world: { before: 'An island.', after: 'Two islands.' } })
    const done = await acceptProposal(s, p)
    const [snap] = await listSnapshots(s.adapter)
    expect(snap).toMatchObject({ id: done.snapshot, kind: 'book', reason: 'before-assistant' })
    const copied = [...(await readSnapshot(s.adapter, snap!))].find(([path]) =>
      path.endsWith('book.json'),
    )!
    expect(copied[1]).toContain('An island.')
    expect(base(s).world).toBe('Two islands.')
    // Restoring that snapshot puts the author's section back; one written since and not in it stays.
    await setBaseSection(s, bookOf(s).id, 'narrative', 'Written after.')
    const back = await restoreBook(s, done.snapshot!)
    expect(back.restored).toContain('Story base')
    expect(base(s)).toEqual({ objectives: '', world: 'An island.', narrative: 'Written after.' })
  })

  it('is refused when a section changed since, changes nothing, and a second Accept is refused too', async () => {
    const s = rig.session
    const p = await baseProposal(s, {
      objectives: { before: '', after: 'A mystery.' },
      world: { before: '', after: 'A port.' },
    })
    await setBaseSection(s, bookOf(s).id, 'world', 'The author wrote this meanwhile.')
    expect(stillApplies(s, p)).toBe(false)
    await expect(acceptProposal(s, p)).rejects.toThrow(OUT_OF_DATE)
    expect(base(s)).toEqual({
      objectives: '',
      world: 'The author wrote this meanwhile.',
      narrative: '',
    }) // nothing half-applied
    expect(await listSnapshots(s.adapter)).toEqual([])

    const q = await baseProposal(s, { narrative: { before: '', after: 'An ending.' } })
    rig.adapter.beforeRemove = (path) => {
      if (path.includes('/proposals/')) throw new Error('disk said no')
    }
    expect((await acceptProposal(s, q)).cleared).toBe(false)
    await expect(acceptProposal(s, q)).rejects.toThrow(OUT_OF_DATE)
    expect(base(s).narrative).toBe('An ending.')
  })
})

describe('Accept of a character suggestion', () => {
  it('makes a Character record in the book’s world with its sheet filled in (empty details left out)', async () => {
    const s = rig.session
    const p = await characterProposal(s)
    const { id, cleared } = await acceptProposal(s, p)
    expect(cleared).toBe(true)
    const r = s.data.records.find((x) => x.meta.id === id)!
    expect(r.meta).toMatchObject({
      type: 'character',
      title: 'Tomas Brandt',
      scope: 'universe',
      summary: 'A customs clerk.',
      role: 'Protagonist',
      goal: 'To leave the port',
    })
    expect('fear' in r.meta).toBe(false)
    expect(r.universe).toBe(s.data.universes[0]!.id)
  })

  it('a second Accept (the suggestion could not be cleared) or a name already there makes no second record', async () => {
    const s = rig.session
    const p = await characterProposal(s)
    rig.adapter.beforeRemove = (path) => {
      if (path.includes('/proposals/')) throw new Error('disk said no')
    }
    expect((await acceptProposal(s, p)).cleared).toBe(false)
    const count = s.data.records.length
    await expect(acceptProposal(s, p)).rejects.toThrow('already in this world')
    await expect(acceptProposal(s, await characterProposal(s, ' tomas  BRANDT '))).rejects.toThrow(
      'already in this world',
    )
    expect(s.data.records).toHaveLength(count)
  })
})
