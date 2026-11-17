// SPDX-License-Identifier: AGPL-3.0-or-later
// What the author does to the continuity of a scene: record, correct and remove its changes, set
// its story time, and name a calendar. A scene's changes have no IDs, so a correction names the
// change by its place in the list AND the change as the author saw it; if the file has moved on
// (another device, another tab), nothing is written and the author is told. Each is one turn of
// the session's queue, read and written together, so quick changes each start from the one before.
import { changeProblem, type Change } from '@/domain/change-kinds'
import { newId } from '@/domain/ids'
import { StorageError } from './errors'
import type { WorkspaceSession } from './session'
import { patchListItem, type ListEdit } from './yaml-edit'

function sceneOrThrow(s: WorkspaceSession, id: string) {
  const scene = s.data.scenes.find((x) => x.meta.id === id)
  if (!scene) throw new StorageError('other', 'That scene is no longer in the workspace.')
  return scene
}

/** A change as it is stored: nothing blank, and the words trimmed. */
function clean(c: Change): Change {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(c)) {
    const value = typeof v === 'string' ? v.trim() : v
    if (value !== undefined && value !== '') out[k] = value
  }
  return out as Change
}

/**
 * Change a list in a file's details: `edit` is given the list as it is NOW (inside the queue) and
 * answers the one-item change to make. The item is edited in place (comments and the other items
 * stay as they were); where that cannot be done, the whole list is set.
 */
function changeList<T extends Record<string, unknown>>(
  s: WorkspaceSession,
  id: string,
  key: string,
  edit: (now: T[]) => { list: T[]; item: ListEdit | null },
) {
  return s.exclusive(async () => {
    const owner =
      s.data.scenes.find((x) => x.meta.id === id)?.meta ?? s.data.universes.find((u) => u.id === id)
    if (!owner) throw new StorageError('other', 'That is no longer in the workspace.')
    const now = [...(((owner as Record<string, unknown>)[key] as T[] | undefined) ?? [])]
    const { list, item } = edit(now)
    const path = s.pathOf(id) ?? ''
    const text = s.current(path)
    const patched = text === undefined || !item ? undefined : patchListItem(text, key, item)
    if (patched !== undefined) await s.write(path, patched)
    else await s.setFields(id, { [key]: list.length ? list : undefined })
    await s.flushPaths([path])
  })
}

/** What the board edits on a change. Anything else on one is not its to drop. */
const BOARD_KEYS = ['kind', 'who', 'with', 'item', 'id', 'of', 'value', 'quote']

const moved = () =>
  new StorageError(
    'other',
    'That change was edited somewhere else. Open the scene again to see it.',
  )
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Record a change at the end of a scene's list. A set-up gets its ID here, so a pay-off can name it. */
export async function addChange(s: WorkspaceSession, sceneId: string, change: Change) {
  sceneOrThrow(s, sceneId)
  const made = clean(
    change.kind === 'setup' && !change.id ? { ...change, id: newId('stp') } : change,
  )
  const problem = changeProblem(made)
  if (problem) throw new StorageError('other', problem)
  await changeList<Change>(s, sceneId, 'changes', (now) => ({
    list: [...now, made],
    item: { op: 'add', item: made },
  }))
  return made
}

/** Put a removed change back where it was (the Undo of a removal). */
export async function restoreChange(
  s: WorkspaceSession,
  sceneId: string,
  at: number,
  change: Change,
) {
  await changeList<Change>(s, sceneId, 'changes', (now) => {
    const place = Math.min(at, now.length)
    const list = [...now.slice(0, place), change, ...now.slice(place)]
    // At the end it is an addition to the list; in the middle the list is set whole.
    return { list, item: place === now.length ? { op: 'add', item: change } : null }
  })
}

/** Correct the change at `at`. `was` is what the author saw there: a mismatch writes nothing. */
export async function updateChange(
  s: WorkspaceSession,
  sceneId: string,
  at: number,
  was: Change,
  change: Change,
) {
  sceneOrThrow(s, sceneId)
  const made = clean(change)
  const problem = changeProblem(made)
  if (problem) throw new StorageError('other', problem)
  await changeList<Change>(s, sceneId, 'changes', (now) => {
    if (!now[at] || !same(now[at], was)) throw moved()
    // The board's own fields are replaced (one it no longer has is taken away); a key it never
    // showed (written by hand, or by a newer Aurelia) is kept as it was.
    const next: Record<string, unknown> = { ...now[at] }
    const fields: Record<string, unknown> = {}
    for (const k of BOARD_KEYS) {
      delete next[k]
      fields[k] = undefined
    }
    Object.assign(next, made)
    Object.assign(fields, made)
    return {
      list: now.map((c, i) => (i === at ? (next as Change) : c)),
      item: { op: 'update', at, fields },
    }
  })
}

export async function removeChange(s: WorkspaceSession, sceneId: string, at: number, was: Change) {
  await changeList<Change>(s, sceneId, 'changes', (now) => {
    if (!now[at] || !same(now[at], was)) throw moved()
    return { list: now.filter((_, i) => i !== at), item: { op: 'remove', at } }
  })
}

export type TimeOrder = 'normal' | 'flashback' | 'flash-forward'

/** A scene's story time (null takes it away) and whether it is out of order on purpose. */
export function setSceneTime(
  s: WorkspaceSession,
  sceneId: string,
  time: { calendar: string; at: string; until?: string; label?: string } | null,
  order: TimeOrder = 'normal',
) {
  return s.exclusive(async () => {
    const stored = sceneOrThrow(s, sceneId).meta.time
    // The time keeps any key it has beyond the board's (a season, say); the board's own are set or dropped.
    const rest: Record<string, unknown> = { ...stored }
    delete rest.until
    delete rest.label
    const until = time?.until?.trim()
    const label = time?.label?.trim()
    const value = time
      ? {
          ...rest,
          calendar: time.calendar,
          at: time.at.trim(),
          ...(until ? { until } : {}),
          ...(label ? { label } : {}),
        }
      : undefined
    await s.setFields(sceneId, {
      time: value,
      flashback: order === 'flashback' ? true : undefined,
      flashForward: order === 'flash-forward' ? true : undefined,
    })
    await s.flushPaths([s.pathOf(sceneId) ?? ''])
  })
}

/** A new calendar for a universe, named; the key still sorts the same, only its words differ. */
export async function addCalendar(
  s: WorkspaceSession,
  universeId: string,
  input: { name: string; era?: string; months?: string[] },
): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new StorageError('other', 'Give the calendar a name.')
  const universe = s.data.universes.find((u) => u.id === universeId)
  if (!universe) throw new StorageError('other', 'That universe is no longer in the workspace.')
  const id = newId('cal')
  const months = (input.months ?? []).map((m) => m.trim()).filter(Boolean)
  const calendar = {
    id,
    name,
    ...(input.era?.trim() ? { era: input.era.trim() } : {}),
    ...(months.length ? { months } : {}),
  }
  await changeList(s, universeId, 'calendars', (now) => ({
    list: [...now, calendar],
    item: { op: 'add', item: calendar },
  }))
  return id
}

/** When an event happens (`time`) or when a character was born (`born`) on their sheet; null takes it away. */
export function setRecordTime(
  s: WorkspaceSession,
  recordId: string,
  key: 'time' | 'born',
  time: { calendar: string; at: string; label?: string } | null,
) {
  return s.exclusive(async () => {
    const record = s.data.records.find((r) => r.meta.id === recordId)
    if (!record) throw new StorageError('other', 'That is no longer in the workspace.')
    // Any key the file has beyond the sheet's own (a season, say) stays; the sheet's are set or dropped.
    const rest: Record<string, unknown> = { ...record.meta[key] }
    delete rest.label
    const label = time?.label?.trim()
    await s.setFields(recordId, {
      [key]: time
        ? { ...rest, calendar: time.calendar, at: time.at.trim(), ...(label ? { label } : {}) }
        : undefined,
    })
    await s.flushPaths([s.pathOf(recordId) ?? ''])
  })
}
