// SPDX-License-Identifier: AGPL-3.0-or-later
// What a sync round does with each file (ADR-0012). Pure: facts in, actions out.

/** What a device last agreed on with the server for one file. */
export interface Base {
  etag: string
  hash: string
}

export interface Tombstone {
  hash: string
  at: string
}

export type SyncAction =
  /** Local to server. `ifMatch` null: the file is not on the server (or is being put back). */
  | { kind: 'push'; path: string; ifMatch: string | null }
  /** Server to local, when the file on disk still has hash `expect` (null: there is none). */
  | { kind: 'pull'; path: string; expect: string | null }
  /** Both sides have it and the base cannot say who is right: look at the server's bytes. */
  | { kind: 'compare'; path: string }
  | { kind: 'remove-remote'; path: string; ifMatch: string }
  | { kind: 'remove-local'; path: string; expect: string }
  | { kind: 'forget'; path: string }

export interface SyncFacts {
  /** Every local file, by path: its hash. */
  local: ReadonlyMap<string, string>
  /** Every file in `current/`, by path: its ETag. */
  remote: ReadonlyMap<string, string>
  base: Readonly<Record<string, Base>>
  tombstones: Readonly<Record<string, Tombstone>>
}

export function planSync({ local, remote, base, tombstones }: SyncFacts): SyncAction[] {
  const paths = new Set([...local.keys(), ...remote.keys(), ...Object.keys(base)])
  const actions: SyncAction[] = []
  for (const path of [...paths].sort()) {
    const l = local.get(path)
    const r = remote.get(path)
    const b = base[path]
    if (!b) {
      if (l === undefined) {
        if (r !== undefined) actions.push({ kind: 'pull', path, expect: null })
      } else if (r === undefined) {
        // Only here, and never met the server: the author's own, so it goes up (a deleted file the author
        // brought back is words, and words are never removed for a note on the server).
        actions.push({ kind: 'push', path, ifMatch: null })
      } else actions.push({ kind: 'compare', path })
      continue
    }
    const localChanged = l !== undefined && l !== b.hash
    const remoteChanged = r !== undefined && r !== b.etag
    if (l !== undefined && r !== undefined) {
      if (localChanged && remoteChanged) actions.push({ kind: 'compare', path })
      else if (localChanged) actions.push({ kind: 'push', path, ifMatch: b.etag })
      else if (remoteChanged) actions.push({ kind: 'pull', path, expect: b.hash })
    } else if (l !== undefined) {
      // The server no longer has it.
      if (localChanged)
        actions.push({ kind: 'push', path, ifMatch: null }) // the edit wins
      else if (tombstones[path])
        // A device deleted it (the tombstone is written before the delete), and nothing here was written since this
        // device last agreed: a decision, even for a device that was behind (its bytes are older than the deleted ones).
        actions.push({ kind: 'remove-local', path, expect: b.hash })
      else actions.push({ kind: 'push', path, ifMatch: null }) // gone with no word of a delete: the server lost it, so it goes back
    } else if (r !== undefined) {
      // Deleted here.
      if (remoteChanged)
        actions.push({ kind: 'pull', path, expect: null }) // the edit wins
      else actions.push({ kind: 'remove-remote', path, ifMatch: b.etag })
    } else actions.push({ kind: 'forget', path })
  }
  return actions
}

/** The name of the copy that keeps the server's text: made from the text, so the same text is the same file. */
export function copyNameFor(path: string, hash: string): string {
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  return `${path.slice(0, slash + 1)}${stem} (Aurelia copy ${hash.slice(0, 8)})${ext}`
}
