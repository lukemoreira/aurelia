// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { newId } from '@/domain/ids'
import { anchorOf, proposalPath, sceneBlocks, type Proposal } from '@/domain/proposals'
import { hashText } from './hash'
import {
  NOT_CLEARED,
  OUT_OF_DATE,
  acceptProposal,
  listProposals,
  rejectProposal,
  stillApplies,
} from './proposal-actions'
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
    const { sceneId } = await acceptProposal(s, p)
    const added = s.data.scenes.find((x) => x.meta.id === sceneId)!
    expect(added.meta).toMatchObject({ title: 'The Gate', chapter })
    expect(added.body).toBe('Night fell over the gate.')
    expect(await s.adapter.read(proposalPath(p.id))).toBeNull()
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
    expect(NOT_CLEARED).toBe('Accepted, but the suggestion could not be cleared — reject it.')
    const done = await acceptProposal(s, p)
    expect(done.cleared).toBe(false)
    const after = body(s, sceneOf(s))!
    expect(after.match(/The lamps were lit\./g)).toHaveLength(1)
    expect(await s.adapter.read(proposalPath(p.id))).not.toBeNull()
    await expect(acceptProposal(s, p)).rejects.toThrow(OUT_OF_DATE)
    expect(body(s, sceneOf(s))).toBe(after)

    const scene = await sceneProposal(s)
    expect((await acceptProposal(s, scene)).cleared).toBe(false)
    const count = s.data.scenes.length
    await expect(acceptProposal(s, scene)).rejects.toThrow('already in the book')
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
    expect(await listProposals(s.adapter)).toEqual([])
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
    expect(listed.map((p) => p.id)).toEqual([revised.id])
    expect(await s.adapter.read(proposalPath(old.id))).toBeNull()
    expect(await s.adapter.read('.aurelia/proposals/prp_zzzzzzzzzz.json')).not.toBeNull()
  })

  it('a revision clears only a suggestion about the same thing; a "replaces" that names another is ignored', async () => {
    const s = rig.session
    await s.editScene(sceneOf(s), TEXT)
    const edit = await editProposal(s)
    const scene = await sceneProposal(s)
    const other = await write(s, { ...(await editProposal(s, 'Elsewhere.')), replaces: scene.id })
    const listed = (await listProposals(s.adapter)).map((p) => p.id).sort()
    expect(listed).toEqual([edit.id, scene.id, other.id].sort())
    expect(await s.adapter.read(proposalPath(scene.id))).not.toBeNull()
  })
})
