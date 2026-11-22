// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { newId } from '@/domain/ids'
import {
  anchorOf,
  proposalPath,
  recordFingerprint,
  sceneBlocks,
  type EditProposal,
  type Proposal,
} from '@/domain/proposals'
import { hashText } from './hash'
import {
  ALREADY_ACCEPTED,
  EDIT_REFUSED,
  NOT_CLEARED,
  OUT_OF_DATE,
  RECORD_CHANGED,
  acceptProposal,
  listProposals,
  rejectProposal,
  stillApplies,
} from './proposal-actions'
import { restoreDeleted } from './outline-actions'
import { addRecord } from './record-actions'
import { listTrash } from './set-aside'
import { listSnapshots, readSnapshot } from './snapshots'
import type { WorkspaceSession } from './session'

type Rig = Awaited<ReturnType<typeof outlineRig>>
let rig: Rig
beforeEach(async () => {
  rig = await outlineRig()
})

const TEXT = 'Tomas came down to the quay at dusk.\n\nThe clerk counted the crates.'
const sceneOf = (s: WorkspaceSession) => s.data.scenes[0]!.meta.id
const body = (s: WorkspaceSession, id: string) => s.data.scenes.find((x) => x.meta.id === id)?.body

async function write(s: WorkspaceSession, p: Proposal) {
  await s.adapter.write(proposalPath(p.id), JSON.stringify(p))
  return p
}
async function editProposal(
  s: WorkspaceSession,
  after = 'Tomas came down to the quay in the late afternoon.',
) {
  const id = sceneOf(s)
  const b = body(s, id)!
  const blocks = sceneBlocks(b)
  const first = blocks[0]!
  return write(s, {
    schemaVersion: 1,
    id: newId('prp'),
    createdAt: new Date().toISOString(),
    by: 'Claude',
    why: 'Dusk clashes with chapter 7.',
    kind: 'edit',
    sceneId: id,
    sceneTitle: 'Untitled scene',
    baseHash: await hashText(b),
    changes: [{ block: first.id, before: first.text, after, ...anchorOf(blocks, first) }],
  })
}

const sceneProposal = (s: WorkspaceSession, title = 'The Gate'): Promise<Proposal> =>
  write(s, {
    schemaVersion: 1,
    id: newId('prp'),
    createdAt: new Date().toISOString(),
    by: 'Claude',
    why: 'A bridge.',
    kind: 'scene',
    chapterId: s.data.chapters[0]!.id,
    title,
    text: 'Night fell over the gate.',
  })

describe('Accept', () => {
  beforeEach(async () => {
    await rig.session.editScene(sceneOf(rig.session), TEXT)
    await rig.session.flush()
  })

  it('takes a "Before a suggestion" snapshot of the scene first, then writes the merged text, then drops the proposal', async () => {
    const s = rig.session
    const p = await editProposal(s)
    // The author kept writing meanwhile, in another paragraph: that stays.
    await s.editScene(sceneOf(s), `${TEXT}\n\nA new last line.`)
    const done = await acceptProposal(s, p)
    expect(body(s, sceneOf(s))).toBe(
      'Tomas came down to the quay in the late afternoon.\n\nThe clerk counted the crates.\n\nA new last line.',
    )
    const [snap] = await listSnapshots(s.adapter)
    expect(snap).toMatchObject({ id: done.snapshot, reason: 'before-assistant', kind: 'scene' })
    expect([...(await readSnapshot(s.adapter, snap!)).values()][0]).toContain('at dusk')
    expect(await s.adapter.read(proposalPath(p.id))).toBeNull()
    expect(await rig.adapter.read(s.pathOf(sceneOf(s))!)).toMatchObject({
      text: expect.stringContaining('in the late afternoon'),
    })
  })

  it('is refused with "text changed — ask again" when the anchored paragraph changed, and changes nothing', async () => {
    const s = rig.session
    const p = await editProposal(s)
    await s.editScene(sceneOf(s), TEXT.replace('at dusk', 'at night'))
    await s.flush()
    expect(stillApplies(s, p)).toBe(false)
    await expect(acceptProposal(s, p)).rejects.toThrow(OUT_OF_DATE)
    expect(body(s, sceneOf(s))).toContain('at night')
    expect(await listSnapshots(s.adapter)).toEqual([]) // no snapshot for nothing
    expect(await s.adapter.read(proposalPath(p.id))).not.toBeNull() // still waiting, marked out of date
  })

  it('adds a suggested new scene at the end of its chapter, with its title and text', async () => {
    const s = rig.session
    const chapter = s.data.chapters[0]!.id
    const p = await write(s, {
      schemaVersion: 1,
      id: newId('prp'),
      createdAt: new Date().toISOString(),
      by: 'Claude',
      why: 'A bridge.',
      kind: 'scene',
      chapterId: chapter,
      title: 'The Gate',
      text: 'Night fell over the gate.',
    })
    const { id: sceneId } = await acceptProposal(s, p)
    const added = s.data.scenes.find((x) => x.meta.id === sceneId)!
    expect(added.meta).toMatchObject({ title: 'The Gate', chapter })
    expect(added.body).toBe('Night fell over the gate.')
    expect(await s.adapter.read(proposalPath(p.id))).toBeNull()
  })
})

describe('Accept with the author’s own text', () => {
  beforeEach(async () => {
    await rig.session.editScene(sceneOf(rig.session), TEXT)
    await rig.session.flush()
  })
  const MINE = 'Tomas walked down to the quay at first light.'

  it('puts the author’s text in place of the assistant’s, through the same snapshot and write', async () => {
    const s = rig.session
    const p = await editProposal(s)
    const done = await acceptProposal(s, p, [`\n${MINE}  \n`])
    expect(body(s, sceneOf(s))).toBe(`${MINE}\n\nThe clerk counted the crates.`)
    expect(body(s, sceneOf(s))).not.toContain('late afternoon')
    const [snap] = await listSnapshots(s.adapter)
    expect(snap).toMatchObject({ id: done.snapshot, reason: 'before-assistant', kind: 'scene' })
    expect([...(await readSnapshot(s.adapter, snap!)).values()][0]).toContain('at dusk')
    expect(await s.adapter.read(proposalPath(p.id))).toBeNull()
  })

  it('keeps the stored proposal as it was (the edit is passed in, never written to the file)', async () => {
    const s = rig.session
    const p = await editProposal(s)
    const before = (await s.adapter.read(proposalPath(p.id)))!.text
    await acceptProposal(s, p, [MINE]).catch(() => undefined)
    await s.adapter.write(proposalPath(p.id), before)
    expect(JSON.parse((await s.adapter.read(proposalPath(p.id)))!.text).changes[0].after).toContain(
      'late afternoon',
    )
  })

  it('is still refused when the anchored paragraph changed: the anchors are the proposal’s', async () => {
    const s = rig.session
    const p = await editProposal(s)
    await s.editScene(sceneOf(s), TEXT.replace('at dusk', 'at night'))
    await s.flush()
    await expect(acceptProposal(s, p, [MINE])).rejects.toThrow(OUT_OF_DATE)
    expect(body(s, sceneOf(s))).toContain('at night')
    expect(body(s, sceneOf(s))).not.toContain('first light')
    expect(await listSnapshots(s.adapter)).toEqual([])
  })

  it('refuses a block left empty unless the suggestion itself removes that block', async () => {
    const s = rig.session
    const p = (await editProposal(s)) as EditProposal
    await expect(acceptProposal(s, p, ['  \n '])).rejects.toThrow(EDIT_REFUSED)
    await expect(acceptProposal(s, p, [])).rejects.toThrow(EDIT_REFUSED)
    expect(body(s, sceneOf(s))).toBe(TEXT)
    expect(await listSnapshots(s.adapter)).toEqual([])
    // A suggestion that removes the paragraph may be accepted with it still empty.
    const blocks = sceneBlocks(TEXT)
    const removal = await write(s, {
      ...p,
      id: newId('prp'),
      changes: [
        {
          block: blocks[1]!.id,
          before: blocks[1]!.text,
          after: '',
          ...anchorOf(blocks, blocks[1]!),
        },
      ],
    })
    await acceptProposal(s, removal, [''])
    expect(body(s, sceneOf(s))!.trim()).toBe('Tomas came down to the quay at dusk.')
  })

  it('is only for an edit to a scene', async () => {
    const s = rig.session
    const p = await write(s, {
      schemaVersion: 1,
      id: newId('prp'),
      createdAt: new Date().toISOString(),
      by: 'Claude',
      why: 'A bridge.',
      kind: 'scene',
      chapterId: s.data.chapters[0]!.id,
      title: 'The Gate',
      text: 'Night fell over the gate.',
    })
    await expect(acceptProposal(s, p, ['x'])).rejects.toThrow('Only a suggested edit')
    expect(s.data.scenes.some((x) => x.meta.title === 'The Gate')).toBe(false)
  })
})

describe('Accept that goes wrong half way', () => {
  beforeEach(async () => {
    await rig.session.editScene(sceneOf(rig.session), TEXT)
    await rig.session.flush()
  })

  it('says so when the change is in but the suggestion could not be cleared, and a second Accept adds nothing', async () => {
    const s = rig.session
    const p = await editProposal(s, 'Tomas came down to the quay at dusk.\n\nThe lamps were lit.')
    rig.adapter.beforeRemove = (path) => {
      if (path.includes('/proposals/')) throw new Error('disk said no')
    }
    expect(NOT_CLEARED).toBe('Accepted, but the suggestion could not be cleared — dismiss it.')
    const done = await acceptProposal(s, p)
    expect(done.cleared).toBe(false)
    const after = body(s, sceneOf(s))!
    expect(after.match(/The lamps were lit\./g)).toHaveLength(1)
    expect(await s.adapter.read(proposalPath(p.id))).not.toBeNull()
    await expect(acceptProposal(s, p)).rejects.toThrow(ALREADY_ACCEPTED)
    // Edited, the text no longer reads as the assistant's: refused all the same, never written twice.
    await expect(
      acceptProposal(s, p, ['Tomas came down to the quay at dusk.\n\nThe lamps were bright.']),
    ).rejects.toThrow(ALREADY_ACCEPTED)
    expect(body(s, sceneOf(s))).toBe(after)

    const scene = await sceneProposal(s)
    expect((await acceptProposal(s, scene)).cleared).toBe(false)
    const count = s.data.scenes.length
    await expect(acceptProposal(s, scene)).rejects.toThrow(ALREADY_ACCEPTED)
    expect(s.data.scenes).toHaveLength(count)
  })

  it('a new scene that cannot be finished leaves no empty "Untitled scene" behind, and the suggestion stays', async () => {
    const s = rig.session
    const p = await sceneProposal(s, '   ') // a title the outline refuses, after the scene was made
    const before = s.data.scenes.map((x) => x.meta.id)
    await expect(acceptProposal(s, p)).rejects.toThrow()
    expect(s.data.scenes.map((x) => x.meta.id)).toEqual(before)
    expect(await s.adapter.read(proposalPath(p.id))).not.toBeNull()
  })
})

describe('the inbox', () => {
  it('Reject removes the proposal file and nothing else', async () => {
    const s = rig.session
    await s.editScene(sceneOf(s), TEXT)
    const p = await editProposal(s)
    await rejectProposal(s, p.id)
    expect((await listProposals(s.adapter)).proposals).toEqual([])
    expect(body(s, sceneOf(s))).toBe(TEXT)
  })

  it('shows a revision as one item: the replaced proposal goes once its revision is there; unreadable files are left alone', async () => {
    const s = rig.session
    await s.editScene(sceneOf(s), TEXT)
    const old = await editProposal(s)
    const revised = await write(s, {
      ...(await editProposal(s, 'Tomas came down at noon.')),
      replaces: old.id,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    })
    await s.adapter.write('.aurelia/proposals/prp_zzzzzzzzzz.json', '{ not json')
    const listed = await listProposals(s.adapter)
    expect(listed.proposals.map((p) => p.id)).toEqual([revised.id])
    expect(listed.unreadable).toBe(1)
    expect(await s.adapter.read(proposalPath(old.id))).toBeNull()
    expect(await s.adapter.read('.aurelia/proposals/prp_zzzzzzzzzz.json')).not.toBeNull()
  })

  it('counts the files it cannot read (a newer kind, a damaged one), and not a readable copy under another name', async () => {
    const s = rig.session
    await s.editScene(sceneOf(s), TEXT)
    const p = await editProposal(s)
    await s.adapter.write(
      '.aurelia/proposals/prp_newerkind1.json',
      JSON.stringify({ ...p, id: 'prp_newerkind1', kind: 'timeline' }),
    )
    await s.adapter.write('.aurelia/proposals/prp_damaged001.json', '{ not json')
    await s.adapter.write(
      `.aurelia/proposals/${p.id} (Aurelia copy 1a2b3c4d).json`,
      JSON.stringify(p),
    )
    await s.adapter.write('.aurelia/proposals/notes.txt', 'not a proposal')
    const listed = await listProposals(s.adapter)
    expect(listed.proposals.map((x) => x.id)).toEqual([p.id])
    expect(listed.unreadable).toBe(2)
    expect(await s.adapter.read('.aurelia/proposals/prp_newerkind1.json')).not.toBeNull()
    expect(await s.adapter.read('.aurelia/proposals/prp_damaged001.json')).not.toBeNull()
  })

  it('a revision clears only a suggestion about the same thing; a "replaces" that names another is ignored', async () => {
    const s = rig.session
    await s.editScene(sceneOf(s), TEXT)
    const edit = await editProposal(s)
    const scene = await sceneProposal(s)
    const other = await write(s, { ...(await editProposal(s, 'Elsewhere.')), replaces: scene.id })
    const listed = (await listProposals(s.adapter)).proposals.map((p) => p.id).sort()
    expect(listed).toEqual([edit.id, scene.id, other.id].sort())
    expect(await s.adapter.read(proposalPath(scene.id))).not.toBeNull()
  })
})

describe('Accept of a suggested record delete', () => {
  /** A character with details and notes, written as the author would, and a suggestion to delete it. */
  async function recordAndProposal(s: WorkspaceSession, title = 'Archie Collins') {
    const universeId = s.data.universes[0]!.id
    const id = await addRecord(s, { type: 'character', title, universeId })
    await s.setFields(id, { role: 'Clerk', summary: 'Counts the crates.' })
    await s.editNotes(id, 'He keeps a ledger.')
    await s.flush()
    const r = s.data.records.find((x) => x.meta.id === id)!
    const p = await write(s, {
      schemaVersion: 1,
      id: newId('prp'),
      createdAt: new Date().toISOString(),
      by: 'Claude',
      why: 'A duplicate of Archie.',
      kind: 'delete-record',
      recordId: id,
      recordType: 'character',
      title,
      fingerprint: recordFingerprint(r),
    })
    return { id, p }
  }

  it('reads the record as the server does: a fresh load gives the same fingerprint as the edited one', async () => {
    const s = rig.session
    const { id, p } = await recordAndProposal(s)
    const fresh = await rig.open()
    expect(recordFingerprint(fresh.data.records.find((x) => x.meta.id === id)!)).toBe(
      p.kind === 'delete-record' && p.fingerprint,
    )
    expect(stillApplies(fresh, p)).toBe(true)
  })

  it('moves the record to Recently deleted and drops the suggestion; a second Accept deletes nothing', async () => {
    const s = rig.session
    const { id, p } = await recordAndProposal(s)
    expect(stillApplies(s, p)).toBe(true)
    expect(await acceptProposal(s, p)).toMatchObject({ id, cleared: true })
    expect(s.data.records.some((x) => x.meta.id === id)).toBe(false)
    expect(await listTrash(s.adapter)).toEqual([
      expect.objectContaining({ kind: 'record', label: 'Archie Collins' }),
    ])
    expect(await s.adapter.read(proposalPath(p.id))).toBeNull()
    expect(stillApplies(s, p)).toBe(false)
    await expect(acceptProposal(s, p)).rejects.toThrow(RECORD_CHANGED)
    expect(await listTrash(s.adapter)).toHaveLength(1)
  })

  it('is out of date, and changes nothing, when the record was edited since', async () => {
    const s = rig.session
    const { id, p } = await recordAndProposal(s)
    await s.editNotes(id, 'He keeps two ledgers.')
    expect(stillApplies(s, p)).toBe(false)
    await expect(acceptProposal(s, p)).rejects.toThrow(RECORD_CHANGED)
    expect(s.data.records.some((x) => x.meta.id === id)).toBe(true)
    expect(await listTrash(s.adapter)).toEqual([])
    expect(await s.adapter.read(proposalPath(p.id))).not.toBeNull()
  })

  it('deletes the record it names, not another of the same title', async () => {
    const s = rig.session
    const { id, p } = await recordAndProposal(s)
    const twin = await addRecord(s, {
      type: 'character',
      title: 'Archie Collins',
      universeId: s.data.universes[0]!.id,
    })
    await acceptProposal(s, p)
    expect(s.data.records.map((x) => x.meta.id)).toContain(twin)
    expect(s.data.records.map((x) => x.meta.id)).not.toContain(id)
  })

  it('comes back intact when restored from Recently deleted after an Accept', async () => {
    const s = rig.session
    const { id, p } = await recordAndProposal(s)
    const path = s.pathOf(id)!
    const text = (await s.adapter.read(path))!.text
    await acceptProposal(s, p)
    const [entry] = await listTrash(s.adapter)
    await restoreDeleted(s, entry!.stamp)
    expect((await s.adapter.read(path))!.text).toBe(text)
    expect(stillApplies(s, p)).toBe(true) // the same record, as it was read
  })

  it('is refused while two files share the record’s ID: which one would go is a guess', async () => {
    const { id, p } = await recordAndProposal(rig.session)
    const path = rig.session.pathOf(id)!
    const copy = path.replace(/\.md$/, ' (conflict).md')
    await rig.adapter.write(copy, (await rig.adapter.read(path))!.text)
    const s = await rig.open()
    expect(s.data.records.filter((x) => x.meta.id === id)).toHaveLength(1) // the loader shows one
    expect(stillApplies(s, p)).toBe(false)
    await expect(acceptProposal(s, p)).rejects.toThrow(RECORD_CHANGED)
    expect(await rig.adapter.read(path)).not.toBeNull()
    expect(await rig.adapter.read(copy)).not.toBeNull()
    expect(await listTrash(s.adapter)).toEqual([])
  })

  it('never deletes a scene, even when one is named', async () => {
    const s = rig.session
    const { p } = await recordAndProposal(s)
    const scene = sceneOf(s)
    const bad = { ...p, recordId: scene } as Proposal
    await s.adapter.write(proposalPath(p.id), JSON.stringify(bad))
    expect((await listProposals(s.adapter)).proposals).toEqual([]) // not a record: the file does not read
    expect(stillApplies(s, bad)).toBe(false)
    await expect(acceptProposal(s, bad)).rejects.toThrow(RECORD_CHANGED)
    expect(s.data.scenes.some((x) => x.meta.id === scene)).toBe(true)
    expect(await listTrash(s.adapter)).toEqual([])
  })
})
