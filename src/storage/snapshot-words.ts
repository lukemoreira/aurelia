// SPDX-License-Identifier: AGPL-3.0-or-later
// What a snapshot and a restore are called in the author's words.
import { versionWhen } from '@/backup/words'
import type { BookRestore, SceneRestore } from './snapshot-restore'
import type { Snapshot } from './snapshots'

const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`
const quoted = (titles: string[]) => titles.map((t) => `“${t}”`).join(', ')
const REASON_NAMES: Record<string, string> = {
  'before-restore': 'Before restore',
  'before-assistant': 'Before a suggestion',
}

/** The line a snapshot is listed by: the author's name for it, else why it was made. */
export const snapshotName = (s: Pick<Snapshot, 'name' | 'reason'>) =>
  s.name ?? REASON_NAMES[s.reason] ?? 'Snapshot'

/** One snapshot in a sentence, told apart by its time when it has no name: "the snapshot “First draft” from Today, 10:41". */
export function snapshotRef(s: Pick<Snapshot, 'name' | 'reason' | 'at'>, now = Date.now()): string {
  const when = versionWhen(new Date(s.at), now)
  const named = s.name ?? REASON_NAMES[s.reason]
  return named ? `the snapshot “${named}” from ${when}` : `the snapshot from ${when}`
}

/** What it holds: "This scene", "The whole book · 12 scenes". */
export function holds(s: Pick<Snapshot, 'kind' | 'files'>): string {
  if (s.kind === 'scene') return 'One scene'
  return `The whole book · ${many(s.files.filter((f) => f.path.includes('/scenes/')).length, 'scene')}`
}

export function sceneRestoreWords(r: SceneRestore): string {
  return r.changed
    ? 'The scene is back as it was. What you had is saved in History as “Before restore”.'
    : 'Nothing to change: the scene already reads the same.'
}

export function bookRestoreWords(r: BookRestore): string {
  const out: string[] = []
  if (r.restored.length) out.push(`Put back the words of ${many(r.restored.length, 'scene')}.`)
  if (r.broughtBack.length)
    out.push(
      `Brought back ${many(r.broughtBack.length, 'deleted scene')}: ${quoted(r.broughtBack)}.`,
    )
  if (r.kept.length)
    out.push(
      `${many(r.kept.length, 'scene')} you wrote since ${r.kept.length === 1 ? 'is' : 'are'} not in the snapshot, so ${r.kept.length === 1 ? 'it stays' : 'they stay'} as ${r.kept.length === 1 ? 'it is' : 'they are'}: ${quoted(r.kept)}.`,
    )
  for (const k of r.skipped) out.push(`“${k.title}” was left as it is: ${k.why}.`)
  if (!r.restored.length && !r.broughtBack.length && !r.skipped.length)
    out.unshift('Nothing to change: every scene already reads the same.')
  if (r.before) out.push('What you had is saved in History as “Before restore”.')
  return out.join(' ')
}
