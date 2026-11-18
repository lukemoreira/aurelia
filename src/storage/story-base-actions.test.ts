// SPDX-License-Identifier: AGPL-3.0-or-later
// The story base (ADR-0016): written by hand, and by an accepted suggestion (a base section, a character).
import { beforeEach, describe, expect, it } from 'vitest'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { newId } from '@/domain/ids'
import { proposalPath, type Proposal } from '@/domain/proposals'
import { baseOf, type BaseSection } from '@/domain/story-base'
import { OUT_OF_DATE, acceptProposal, stillApplies } from './proposal-actions'
import { restoreBook } from './snapshot-restore'
import { listSnapshots, readSnapshot } from './snapshots'
import { CHANGED_ELSEWHERE, setBaseSection } from './story-base-actions'
import type { WorkspaceSession } from './session'

type Rig = Awaited<ReturnType<typeof outlineRig>>
let rig: Rig
beforeEach(async () => {
  rig = await outlineRig()
})

const bookOf = (s: WorkspaceSession) => s.data.books[0]!
const base = (s: WorkspaceSession) => baseOf(bookOf(s))
/** The author types a section, starting from what it reads now. */
const type = (s: WorkspaceSession, key: BaseSection, text: string) =>
  setBaseSection(s, bookOf(s).id, key, text, base(s)[key])

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
    await type(s, 'objectives', 'A slow-burn mystery for adults.')
    await type(s, 'world', 'A port city under a dying empire.')
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
    await type(s, 'objectives', '')
    await type(s, 'world', '  ')
    expect('storyBase' in JSON.parse((await rig.adapter.read(path))!.text)).toBe(false)
    // Read again from the files, by a new session.
    await type(s, 'narrative', 'Tomas finds the ledger.')
    const again = await rig.open()
    expect(baseOf(again.data.books[0]).narrative).toBe('Tomas finds the ledger.')
  })
})

describe('what the story base holds that this version does not write', () => {
  /** book.json with a base written elsewhere: a section that is not text, and a key a later version adds. */
  async function handWritten() {
    const s = rig.session
    const path = s.pathOf(bookOf(s).id)!
    const json = JSON.parse((await rig.adapter.read(path))!.text)
    json.storyBase = { objectives: 'Long text', world: { draft: 'x' }, later: 1 }
    await rig.adapter.write(path, `${JSON.stringify(json, null, 2)}\n`)
    const again = await rig.open()
    return { s: again, path }
  }

  it('reads the sections that are text, and keeps everything else through a save, an Accept and a restore', async () => {
    const { s, path } = await handWritten()
    expect(base(s)).toEqual({ objectives: 'Long text', world: '', narrative: '' })
    const stored = async () => JSON.parse((await rig.adapter.read(path))!.text).storyBase
    await type(s, 'narrative', 'An ending.')
    expect(await stored()).toEqual({
      objectives: 'Long text',
      world: { draft: 'x' },
      later: 1,
      narrative: 'An ending.',
    })
    const p = await baseProposal(s, { objectives: { before: 'Long text', after: 'Short.' } })
    const done = await acceptProposal(s, p)
    expect(await stored()).toEqual({
      objectives: 'Short.',
      world: { draft: 'x' },
      later: 1,
      narrative: 'An ending.',
    })
    await restoreBook(s, done.snapshot!)
    expect(await stored()).toEqual({
      objectives: 'Long text',
      world: { draft: 'x' },
      later: 1,
      narrative: 'An ending.',
    })
  })
})

describe('a section changed on another device while the author typed', () => {
  it('is not written over: the save is refused and nothing changes', async () => {
    const s = rig.session
    await type(s, 'world', 'Theirs.') // what another device's sync brought in
    await expect(setBaseSection(s, bookOf(s).id, 'world', 'Mine.', '')).rejects.toThrow(
      CHANGED_ELSEWHERE,
    )
    expect(base(s).world).toBe('Theirs.')
  })
})

describe('Accept of a story-base suggestion', () => {
  it('fills empty sections with no snapshot (nothing is overwritten), and leaves the others as they are', async () => {
    const s = rig.session
    await type(s, 'narrative', 'Mine.')
    const p = await baseProposal(s, { objectives: { before: '', after: 'A mystery.' } })
    const done = await acceptProposal(s, p)
    expect(done).toMatchObject({ id: bookOf(s).id, cleared: true })
    expect(done.snapshot).toBeUndefined()
    expect(base(s)).toEqual({ objectives: 'A mystery.', world: '', narrative: 'Mine.' })
    expect(await s.adapter.read(proposalPath(p.id))).toBeNull()
  })

  it('takes a "Before a suggestion" snapshot of the book first when it replaces the author’s text', async () => {
    const s = rig.session
    await type(s, 'world', 'An island.')
    const p = await baseProposal(s, { world: { before: 'An island.', after: 'Two islands.' } })
    const done = await acceptProposal(s, p)
    const [snap] = await listSnapshots(s.adapter)
    expect(snap).toMatchObject({ id: done.snapshot, kind: 'book', reason: 'before-assistant' })
    const copied = [...(await readSnapshot(s.adapter, snap!))].find(([path]) =>
      path.endsWith('book.json'),
    )!
    expect(copied[1]).toContain('An island.')
    expect(base(s).world).toBe('Two islands.')
  })

  it('a restore of that snapshot puts the whole base back as it was, a section filled by the suggestion too', async () => {
    const s = rig.session
    await type(s, 'world', 'Old.')
    const p = await baseProposal(s, {
      objectives: { before: '', after: 'A.' },
      world: { before: 'Old.', after: 'New.' },
    })
    const done = await acceptProposal(s, p)
    expect(base(s)).toEqual({ objectives: 'A.', world: 'New.', narrative: '' })
    const back = await restoreBook(s, done.snapshot!)
    expect(back.restored).toContain('Story base')
    expect(base(s)).toEqual({ objectives: '', world: 'Old.', narrative: '' })
    // The base as it was before the restore is in the "Before restore" snapshot.
    const kept = (await listSnapshots(s.adapter)).find((x) => x.reason === 'before-restore')!
    const file = [...(await readSnapshot(s.adapter, kept))].find(([f]) => f.endsWith('book.json'))!
    expect(JSON.parse(file[1]).storyBase).toEqual({ objectives: 'A.', world: 'New.' })
  })

  it('a snapshot with no story base (an older one) leaves the base as it is', async () => {
    const s = rig.session
    const { writeSnapshot } = await import('./snapshots')
    const old = await writeSnapshot(s, { kind: 'book', id: bookOf(s).id }, {})
    await type(s, 'world', 'Written after.')
    await restoreBook(s, old.id)
    expect(base(s).world).toBe('Written after.')
  })

  it('is refused when a section changed since, changes nothing, and a second Accept is refused too', async () => {
    const s = rig.session
    const p = await baseProposal(s, {
      objectives: { before: '', after: 'A mystery.' },
      world: { before: '', after: 'A port.' },
    })
    await type(s, 'world', 'The author wrote this meanwhile.')
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

  it('is out of date, with no Accept, when the world already has a character of that name', async () => {
    const s = rig.session
    const p = await characterProposal(s)
    expect(stillApplies(s, p)).toBe(true)
    await acceptProposal(s, await characterProposal(s, 'TOMAS brandt'))
    expect(stillApplies(s, p)).toBe(false)
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
