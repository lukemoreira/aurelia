// SPDX-License-Identifier: AGPL-3.0-or-later
// The Review inbox's work (ADR-0008, ADR-0015): read the assistant's proposals, and the author's Accept
// and Reject. Accept is the only way a proposal reaches the manuscript: a snapshot first, then an
// ordinary compare-and-write edit through the session.
import {
  PROPOSALS_DIR,
  mergeChanges,
  proposalPath,
  proposalSchema,
  type Proposal,
} from '@/domain/proposals'
import type { StorageAdapter } from './adapter'
import { StorageError } from './errors'
import { renameItem } from './outline-actions'
import type { WorkspaceSession } from './session'
import { blocker, bodyNow, put } from './snapshot-restore'
import { writeSnapshot } from './snapshots'

export const OUT_OF_DATE = 'The text changed after this was suggested — ask again.'

/**
 * Every readable proposal, newest first. A revision replaces the one it names: the older file is
 * removed here, once the newer one is in place, so the two show as one. A file that does not read
 * (a newer Aurelia's, a damaged one) is left alone and not listed.
 */
export async function listProposals(adapter: StorageAdapter): Promise<Proposal[]> {
  const found: Proposal[] = []
  for (const path of await adapter.list()) {
    if (!path.startsWith(`${PROPOSALS_DIR}/`) || !path.endsWith('.json')) continue
    try {
      const file = await adapter.read(path)
      const p = file && proposalSchema.safeParse(JSON.parse(file.text))
      if (p?.success && proposalPath(p.data.id) === path) found.push(p.data)
    } catch {
      // not listed
    }
  }
  const replaced = new Set(found.flatMap((p) => (p.replaces ? [p.replaces] : [])))
  for (const p of found)
    if (replaced.has(p.id)) await adapter.remove(proposalPath(p.id)).catch(() => undefined)
  return found
    .filter((p) => !replaced.has(p.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** Whether Accept would apply as things stand (an edit's blocks still read as they did). */
export function stillApplies(s: WorkspaceSession, p: Proposal): boolean {
  if (p.kind === 'scene') return s.data.chapters.some((c) => c.id === p.chapterId)
  const body = bodyNow(s, p.sceneId)
  return body !== undefined && mergeChanges(body, p.changes).ok
}

export type Accepted = { sceneId: string; snapshot?: string }

/** Reject: the proposal file goes; nothing else changes. */
export const rejectProposal = (s: WorkspaceSession, id: string) =>
  s.adapter.remove(proposalPath(id))

/**
 * Accept. An edit takes a "Before a suggestion" snapshot of the scene first, then puts the merged text in
 * (refused, with nothing changed, when an anchored block changed or is gone, or the scene cannot be
 * written safely right now). A new scene is added at the end of its chapter: nothing is overwritten, so
 * there is nothing to snapshot. The proposal file goes once the change is in.
 */
export async function acceptProposal(s: WorkspaceSession, p: Proposal): Promise<Accepted> {
  if (p.kind === 'scene') {
    if (!s.data.chapters.some((c) => c.id === p.chapterId))
      throw new StorageError('other', 'That chapter is no longer in the book.')
    const id = await s.createScene(p.chapterId)
    await renameItem(s, id, p.title)
    await s.editScene(id, p.text)
    await s.flush()
    await rejectProposal(s, p.id)
    return { sceneId: id }
  }
  const snapshot = await s.exclusive(async () => {
    const path = s.pathOf(p.sceneId)
    if (!path || bodyNow(s, p.sceneId) === undefined)
      throw new StorageError('other', 'That scene is no longer in the book.')
    const why = await blocker(s, p.sceneId, path)
    if (why) throw new StorageError('other', `This scene was left as it is: ${why}.`)
    const was = bodyNow(s, p.sceneId)!
    const merged = mergeChanges(was, p.changes)
    if (!merged.ok) throw new StorageError('other', OUT_OF_DATE)
    const before = await writeSnapshot(
      s,
      { kind: 'scene', id: p.sceneId },
      { reason: 'before-assistant' },
    )
    if (await put(s, p.sceneId, merged.body, path, was))
      throw new StorageError('other', OUT_OF_DATE)
    return before.id
  })
  await rejectProposal(s, p.id)
  return { sceneId: p.sceneId, snapshot }
}
