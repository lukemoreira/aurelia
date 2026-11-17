// SPDX-License-Identifier: AGPL-3.0-or-later
// What the author does in the World library besides making and renaming records: relate two
// records, move a place inside another, start from Earth. Each is a change to one record's own file.
import { canMovePlace } from '@/domain/places'
import type { Relationship } from '@/domain/schema/record'
import { StorageError } from './errors'
import { addRecord, relationshipsPatch } from './record-actions'
import { setDetails } from './outline-actions'
import type { WorkspaceSession } from './session'
import type { YamlPatch } from './yaml-edit'

const gone = () => new StorageError('other', 'That is no longer in the workspace.')

/** Set details of one item inside an action that already holds the session (`setDetails` would wait for itself). */
async function setHere(s: WorkspaceSession, id: string, patch: YamlPatch) {
  await s.setFields(id, patch)
  await s.flushPaths([s.pathOf(id) ?? ''])
}

/** The relationships a record lists now, changed by `change`, written as one change to its file. */
async function changeRelationships(
  s: WorkspaceSession,
  holder: string,
  change: (list: Relationship[]) => Relationship[],
) {
  await s.exclusive(async () => {
    const record = s.data.records.find((r) => r.meta.id === holder)
    if (!record) throw gone()
    const next = change((record.meta.relationships ?? []).map((r) => ({ ...r })))
    await setHere(s, holder, { relationships: relationshipsPatch(next) })
  })
}

/** `holder` lists a relationship to `other`, named `type` ("mentor"). Either end may be the holder: both sheets show it. */
export async function addRelationship(
  s: WorkspaceSession,
  holder: string,
  other: string,
  type: string,
): Promise<void> {
  const words = type.trim()
  if (!words)
    throw new StorageError('other', 'Say what they are to each other, for example “mentor”.')
  if (holder === other) throw new StorageError('other', 'A record cannot be related to itself.')
  if (!s.data.records.some((r) => r.meta.id === other)) throw gone()
  await changeRelationships(s, holder, (list) => [...list, { with: other, type: words }])
}

/** Change the words of one relationship, on the record that lists it. */
export async function renameRelationship(
  s: WorkspaceSession,
  holder: string,
  index: number,
  target: string,
  type: string,
): Promise<void> {
  const words = type.trim()
  if (!words)
    throw new StorageError('other', 'Say what they are to each other, for example “mentor”.')
  await changeRelationships(s, holder, (list) => {
    if (list[index]?.with !== target) throw gone() // the list changed since it was shown (another device)
    return list.map((r, i) => (i === index ? { ...r, type: words } : r))
  })
}

/** Take one relationship away, from the record that lists it (from either sheet). */
export async function removeRelationship(
  s: WorkspaceSession,
  holder: string,
  index: number,
  target: string,
): Promise<void> {
  await changeRelationships(s, holder, (list) => {
    if (list[index]?.with !== target) throw gone()
    return list.filter((_, i) => i !== index)
  })
}

/**
 * Put a place or world inside another (`parentId`) or at the top (null). One key of the place's
 * own file changes, so a stop leaves it where it was or where it is going, never between.
 */
export async function movePlace(
  s: WorkspaceSession,
  id: string,
  parentId: string | null,
): Promise<void> {
  await s.exclusive(async () => {
    const verdict = canMovePlace(s.data.records, id, parentId)
    if (!verdict.ok) throw new StorageError('other', verdict.reason)
    const now = s.data.records.find((r) => r.meta.id === id)?.meta.parent ?? null
    if (now === parentId) return
    await setHere(s, id, { parent: parentId ?? undefined })
  })
}

/** Earth, the world to start from for history writing: the one that is there, or a new one. Returns its ID. */
export async function addEarth(s: WorkspaceSession, universeId: string): Promise<string> {
  const found = s.data.records.find(
    (r) =>
      r.universe === universeId &&
      r.meta.scope === 'universe' &&
      r.meta.type === 'world' &&
      r.meta.title === 'Earth',
  )
  if (found) return found.meta.id
  const id = await addRecord(s, { type: 'world', title: 'Earth', universeId })
  await setDetails(s, id, { kind: 'Planet' })
  return id
}
