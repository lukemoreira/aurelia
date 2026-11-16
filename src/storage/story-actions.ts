// SPDX-License-Identifier: AGPL-3.0-or-later
// What the author does to a branching story: add, change and remove a scene's choices, mark an
// ending, set the start, switch a book between straight and branching, and mark a finding as
// intended. Every change to a LIST reads it, changes it and writes it inside one turn of the
// session's queue, so changes made in quick succession each start from the one before.
import { newId } from '@/domain/ids'
import type { Scene } from '@/domain/schema/scene'
import { StorageError } from './errors'
import { renameItem, setDetails } from './outline-actions'
import type { WorkspaceSession } from './session'
import { patchListItem, type ListEdit } from './yaml-edit'

type Choice = NonNullable<Scene['choices']>[number]

function sceneOrThrow(s: WorkspaceSession, id: string) {
  const scene = s.data.scenes.find((x) => x.meta.id === id)
  if (!scene) throw new StorageError('other', 'That scene is no longer in the workspace.')
  return scene
}
const needWords = () => new StorageError('other', 'Say what the choice is, in the reader’s words.')

/**
 * Change a scene's choices: `edit` is given the list as it is NOW (inside the queue) and answers
 * the one-item change to make. The item is edited in place in the file (comments and the other
 * items stay as they were); where that cannot be done, the whole list is set.
 */
function changeChoices(
  s: WorkspaceSession,
  sceneId: string,
  edit: (now: Choice[]) => { list: Choice[]; item: ListEdit },
) {
  return s.exclusive(async () => {
    const now = [...(sceneOrThrow(s, sceneId).meta.choices ?? [])]
    const { list, item } = edit(now)
    const path = s.pathOf(sceneId) ?? ''
    const text = s.current(path)
    const patched = text === undefined ? undefined : patchListItem(text, 'choices', item)
    if (patched !== undefined) await s.write(path, patched)
    else await s.setFields(sceneId, { choices: list.length ? list : undefined })
    await s.flushPaths([path])
  })
}

/**
 * A choice at the end of a scene's list. With no `target` it leads to a new scene, made first in
 * the same chapter and named after the choice, so a stop in between leaves a scene nobody points
 * at (shown as unreachable) and never a choice that points at nothing. `onScene` is told the new
 * scene's ID as soon as it exists, so a caller whose save then fails can try again with that scene
 * as the target instead of making another. Returns the new IDs.
 */
export async function addChoice(
  s: WorkspaceSession,
  sceneId: string,
  input: { label: string; target?: string; onScene?: (id: string) => void },
): Promise<{ choice: string; target: string }> {
  const label = input.label.trim()
  if (!label) throw needWords()
  const from = sceneOrThrow(s, sceneId)
  let target = input.target
  if (target) sceneOrThrow(s, target)
  else {
    target = await s.createScene(from.meta.chapter)
    input.onScene?.(target)
    await renameItem(s, target, label).catch(() => undefined) // a title that does not pass stays "Untitled scene"
  }
  const choice = newId('chc')
  const made = { id: choice, label, target }
  await changeChoices(s, sceneId, (now) => ({
    list: [...now, made],
    item: { op: 'add', item: made },
  }))
  return { choice, target }
}

/** Change a choice's words or where it leads. Anything else kept on the choice stays as it was. */
export async function updateChoice(
  s: WorkspaceSession,
  sceneId: string,
  choiceId: string,
  patch: { label?: string; target?: string },
): Promise<void> {
  const label = patch.label?.trim()
  if (patch.label !== undefined && !label) throw needWords()
  if (patch.target) sceneOrThrow(s, patch.target)
  const fields = { ...(label ? { label } : {}), ...(patch.target ? { target: patch.target } : {}) }
  await changeChoices(s, sceneId, (now) => {
    if (!now.some((c) => c.id === choiceId))
      throw new StorageError('other', 'That choice is no longer there.')
    return {
      list: now.map((c) => (c.id === choiceId ? { ...c, ...fields } : c)),
      item: { op: 'update', id: choiceId, fields },
    }
  })
}

export const removeChoice = (s: WorkspaceSession, sceneId: string, choiceId: string) =>
  changeChoices(s, sceneId, (now) => ({
    list: now.filter((c) => c.id !== choiceId),
    item: { op: 'remove', id: choiceId },
  }))

/** "Mark as ending": a scene the story may finish in. Off takes the key away. */
export const setEnding = (s: WorkspaceSession, sceneId: string, ending: boolean) =>
  setDetails(s, sceneId, { ending: ending ? true : undefined })

/** The scene the reader starts in (`book.json`); the first scene when none is set. */
export async function setStart(s: WorkspaceSession, bookId: string, sceneId: string) {
  sceneOrThrow(s, sceneId)
  await setDetails(s, bookId, { start: sceneId })
}

export const setBookMode = (s: WorkspaceSession, bookId: string, mode: 'linear' | 'branching') =>
  setDetails(s, bookId, { mode })

/**
 * "Mark intended" (and its undo): the fingerprints a book hides, stored in `book.json`
 * (ADR-0006). `add` and `remove` are applied to the list as it is now, in the author's order;
 * what `found` (every fingerprint the checks give now) no longer includes is dropped on the way,
 * so a fix that came and went does not hide a new problem of the same kind later.
 */
export function setDismissed(
  s: WorkspaceSession,
  bookId: string,
  change: { add?: string; remove?: string; found: string[] },
) {
  return s.exclusive(async () => {
    const book = s.data.books.find((b) => b.id === bookId)
    if (!book) throw new StorageError('other', 'That book is no longer in the workspace.')
    const found = new Set(change.found)
    const list = (book.dismissedFindings ?? []).filter(
      (f) => found.has(f) && f !== change.remove && f !== change.add,
    )
    if (change.add && found.has(change.add)) list.push(change.add)
    await s.setFields(bookId, { dismissedFindings: list.length ? list : undefined })
    await s.flushPaths([s.pathOf(bookId) ?? ''])
  })
}
