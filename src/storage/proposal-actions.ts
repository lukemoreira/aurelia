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
import { deleteItem, renameItem } from './outline-actions'
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
  // A revision may stand in only for a suggestion about the same thing: the model writes `replaces`,
  // and a wrong or hostile one must not clear the author's other suggestions.
  const byId = new Map(found.map((p) => [p.id, p]))
  const replaced = new Set(
    found.flatMap((p) => {
      const old = p.replaces ? byId.get(p.replaces) : undefined
      return old && old.id !== p.id && targetOf(old) === targetOf(p) ? [old.id] : []
    }),
  )
  for (const p of found)
    if (replaced.has(p.id)) await adapter.remove(proposalPath(p.id)).catch(() => undefined)
  return found
    .filter((p) => !replaced.has(p.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** What a suggestion is about: one scene's text, or a new scene in one chapter. */
const targetOf = (p: Proposal) => (p.kind === 'edit' ? `edit:${p.sceneId}` : `scene:${p.chapterId}`)

/** Whether Accept would apply as things stand (an edit's blocks still read as they did). */
export function stillApplies(s: WorkspaceSession, p: Proposal): boolean {
  if (p.kind === 'scene') return s.data.chapters.some((c) => c.id === p.chapterId)
  const body = bodyNow(s, p.sceneId)
  return body !== undefined && mergeChanges(body, p.changes).ok
}

/** `cleared`: false when the change is in but the suggestion's file could not be removed. */
export type Accepted = { sceneId: string; snapshot?: string; cleared: boolean }

export const NOT_CLEARED = 'Accepted, but the suggestion could not be cleared — reject it.'

/** Remove the suggestion once its change is in; a failure is said, never taken for "nothing changed". */
const clear = (s: WorkspaceSession, id: string) =>
  rejectProposal(s, id).then(
    () => true,
    () => false,
  )

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
    // Accepted before, and the suggestion could not be cleared then: a second Accept would make it twice.
    if (
      s.data.scenes.some(
        (x) => x.meta.chapter === p.chapterId && x.meta.title === p.title && x.body === p.text,
      )
    )
      throw new StorageError('other', 'This scene is already in the book. Reject the suggestion.')
    const id = await s.createScene(p.chapterId)
    try {
      await renameItem(s, id, p.title)
      await s.editScene(id, p.text)
      await s.flush()
    } catch (e) {
      // No half-made "Untitled scene" left behind (a retry would make another): it goes to Recently deleted.
      await deleteItem(s, id).catch(() => undefined)
      throw e
    }
    return { sceneId: id, cleared: await clear(s, p.id) }
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
  return { sceneId: p.sceneId, snapshot, cleared: await clear(s, p.id) }
}
