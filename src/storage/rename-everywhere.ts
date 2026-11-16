// SPDX-License-Identifier: AGPL-3.0-or-later
// Rename everywhere (ADR-0010 §6): the writing of it. The files are changed through the session,
// so each is a compare-and-write like any edit; a refusal stops the run and says how far it got.
import type { Alias } from '@/domain/schema/record'
import { rewrites, type RenamePlan } from '@/index/rename'
import { StorageError } from './errors'
import { aliasesPatch } from './record-actions'
import { safetyPathFor, stampOf } from './paths'
import type { WorkspaceSession } from './session'

/** What was changed: enough to put every file back as it was. */
export interface RenameRun {
  files: { id: string; kind: 'scene' | 'record'; before: string; after: string }[]
  recordId: string
  /** The record's other names, before and after (undefined: not changed). */
  aliases?: { before: Alias[]; after: Alias[] }
  /** The other names were (being) written. */
  aliasesDone?: boolean
  places: number
  /** Files written completely (`files` also holds the one a stop happened in). */
  done: number
  /** A version really reached the server first. A copy of each file is always kept in the folder as well. */
  versioned: boolean
  /** The run stopped here: this file changed under it, or could not be written. */
  stopped?: { title: string; why: 'changed' | 'save' }
}

const bodyOf = (s: WorkspaceSession, id: string, kind: 'scene' | 'record') =>
  kind === 'scene'
    ? s.data.scenes.find((x) => x.meta.id === id)?.body
    : s.data.records.find((x) => x.meta.id === id)?.body

const titleOf = (s: WorkspaceSession, id: string) =>
  s.data.scenes.find((x) => x.meta.id === id)?.meta.title ??
  s.data.records.find((x) => x.meta.id === id)?.meta.title ??
  'a file'

/** Put a text into a scene or a record's notes and wait until it is in the file. Throws when it is not. */
async function put(s: WorkspaceSession, id: string, kind: 'scene' | 'record', text: string) {
  await (kind === 'scene' ? s.editScene(id, text) : s.editNotes(id, text))
  const path = s.pathOf(id) ?? ''
  await s.flushPaths([path])
  if (bodyOf(s, id, kind) !== text || s.pipeline.isBusy(path))
    throw new StorageError('other', `“${titleOf(s, id)}” could not be saved.`)
}

/**
 * Change the ticked places. A version is asked for first (in sync mode that may bring in changes
 * from another device), then nothing is touched if any file differs from what the places were
 * found in, or has unsaved words. A copy of each file under `.aurelia/safety/` is always kept
 * before the first write, and each file is compared once more just before it is written. A file
 * that cannot be written stops the run, which says how far it got; `undoRename` puts it back.
 */
export async function applyRename(
  s: WorkspaceSession,
  plan: RenamePlan,
  ticked: ReadonlySet<string>,
  opts: {
    recordId: string
    /** The record's other names, and what they become. Undefined leaves them. */
    aliases?: { before: Alias[]; after: Alias[] }
    /** Save a version of the workspace; true when one was saved. */
    saveVersion: () => Promise<boolean>
  },
): Promise<RenameRun> {
  const files = rewrites(plan, ticked)
  // First, and outside the action: in sync mode a version is a sync round, which may bring in
  // changes from another device. What the places were found in is compared only after it.
  const versioned = await opts.saveVersion().catch(() => false)
  return s.exclusive(async () => {
    const paths = files.map((f) => s.pathOf(f.docId) ?? '')
    await s.flushPaths(paths)
    for (const f of files)
      if (bodyOf(s, f.docId, f.kind) !== f.before)
        throw new StorageError(
          'other',
          `“${titleOf(s, f.docId)}” changed since the places were found, so nothing was changed. Look again.`,
        )
    if (paths.some((p) => !p || s.pipeline.isBusy(p)))
      throw new StorageError('other', 'Aurelia is still saving. Try again in a moment.')

    // The old texts are always kept in the folder: a version may not have reached the server.
    const stamp = stampOf(new Date())
    for (const p of [...paths, ...(opts.aliases ? [s.pathOf(opts.recordId) ?? ''] : [])]) {
      const text = s.current(p)
      if (p && text !== undefined) await s.adapter.write(safetyPathFor(p, stamp), text)
    }

    const run: RenameRun = {
      recordId: opts.recordId,
      files: [],
      done: 0,
      places: 0,
      versioned,
      ...(opts.aliases ? { aliases: opts.aliases } : {}),
    }
    for (const f of files) {
      // Nothing may have landed since the compare above (a save, a change from another device).
      if (bodyOf(s, f.docId, f.kind) !== f.before) {
        run.stopped = { title: titleOf(s, f.docId), why: 'changed' }
        return run
      }
      // Recorded before it is written: a stop in the middle of the write must still be undone.
      run.files.push({ id: f.docId, kind: f.kind, before: f.before, after: f.after })
      try {
        await put(s, f.docId, f.kind, f.after)
      } catch {
        // The file is not renamed on screen either: what is waiting to be saved is the old text.
        await (
          f.kind === 'scene' ? s.editScene(f.docId, f.before) : s.editNotes(f.docId, f.before)
        ).catch(() => undefined)
        run.stopped = { title: titleOf(s, f.docId), why: 'save' }
        return run
      }
      run.done++
      run.places += f.count
    }
    if (opts.aliases) {
      run.aliasesDone = true
      try {
        await s.setFields(opts.recordId, { aliases: aliasesPatch(opts.aliases.after) })
        await s.flushPaths([s.pathOf(opts.recordId) ?? ''])
      } catch {
        run.stopped = { title: titleOf(s, opts.recordId), why: 'save' }
      }
    }
    return run
  })
}

export interface UndoResult {
  restored: number
  /** Files that were typed in since, and so were left as they are. */
  kept: string[]
}

/** Put the files of a run back as they were. A file written to since is left alone and named. */
export async function undoRename(s: WorkspaceSession, run: RenameRun): Promise<UndoResult> {
  return s.exclusive(async () => {
    const result: UndoResult = { restored: 0, kept: [] }
    for (const f of [...run.files].reverse()) {
      const now = bodyOf(s, f.id, f.kind)
      if (now === f.before) continue // a write that stopped before it began: nothing to put back
      if (now !== f.after) {
        result.kept.push(titleOf(s, f.id))
        continue
      }
      await put(s, f.id, f.kind, f.before)
      result.restored++
    }
    if (run.aliasesDone && run.aliases) {
      const now = s.data.records.find((r) => r.meta.id === run.recordId)?.meta.aliases
      const names = (list: Alias[] | undefined) => JSON.stringify(aliasesPatch(list ?? []) ?? [])
      if (names(now) === names(run.aliases.before)) {
        // never written
      } else if (names(now) === names(run.aliases.after)) {
        await s.setFields(run.recordId, { aliases: aliasesPatch(run.aliases.before) })
        await s.flushPaths([s.pathOf(run.recordId) ?? ''])
      } else result.kept.push(titleOf(s, run.recordId))
    }
    return result
  })
}
