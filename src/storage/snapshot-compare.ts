// SPDX-License-Identifier: AGPL-3.0-or-later
// What differs between a snapshot and the text now, or between two snapshots (ADR-0013): scene by
// scene, matched by the scene's ID. Only the writing is compared, not the details at the top.
import { diffCounts, diffInfo, type DiffPart } from '@/domain/word-diff'
import type { StorageAdapter } from './adapter'
import { sceneBodyOf, titleOfFile } from './snapshot-restore'
import { readSnapshot, type Snapshot } from './snapshots'
import type { WorkspaceSession } from './session'

export interface SceneChange {
  id: string
  title: string
  /** `changed` and `same` are in both; the others are in only one of the two texts. */
  state: 'changed' | 'same' | 'only-older' | 'only-newer'
  older?: string
  newer?: string
}

export interface TextsToCompare {
  /** The whole files of the scenes, by path. */
  older: Map<string, string>
  newer: Map<string, string>
}

const ID = /\/(scn_\w+)\.md$/

const byId = (files: Map<string, string>) => {
  const out = new Map<string, string>()
  for (const [path, text] of files) {
    const id = ID.exec(path)?.[1]
    if (id) out.set(id, text)
  }
  return out
}

const RANK = { changed: 0, 'only-newer': 1, 'only-older': 2, same: 3 }

/** The scenes of two sets of files, matched by ID: changed first, then the ones in only one, then the same. */
export function compareScenes({ older, newer }: TextsToCompare): SceneChange[] {
  const [a, b] = [byId(older), byId(newer)]
  const rows: SceneChange[] = []
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const [x, y] = [a.get(id), b.get(id)]
    const title = titleOfFile((y ?? x)!, id)
    const state =
      x === undefined
        ? 'only-newer'
        : y === undefined
          ? 'only-older'
          : sceneBodyOf(x) === sceneBodyOf(y)
            ? 'same'
            : 'changed'
    rows.push({
      id,
      title,
      state,
      ...(x !== undefined ? { older: sceneBodyOf(x) } : {}),
      ...(y !== undefined ? { newer: sceneBodyOf(y) } : {}),
    })
  }
  return rows.sort((p, q) => RANK[p.state] - RANK[q.state] || p.title.localeCompare(q.title))
}

/** The words of one scene, as the pieces to show and how many words came and went. */
export function sceneDiff(row: SceneChange): {
  parts: DiffPart[]
  added: number
  removed: number
  /** Past the diff's edit limit: the counts are about, not exact. */
  rough: boolean
} {
  const { parts, rough } = diffInfo(row.older ?? '', row.newer ?? '')
  return { parts, rough, ...diffCounts(parts) }
}

/** The scenes of a book as the author has them now, with the words not yet saved. */
export function sceneFilesNow(s: WorkspaceSession, bookId: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const scene of s.data.scenes) {
    const path = s.pathOf(scene.meta.id)
    const text = path ? s.current(path) : undefined
    if (path && text !== undefined && path.includes(`/books/${bookId}/`)) out.set(path, text)
  }
  return out
}

/** A snapshot's scene files (only the scenes). */
export async function sceneFilesOf(adapter: StorageAdapter, snap: Snapshot) {
  const texts = await readSnapshot(adapter, snap)
  return new Map([...texts].filter(([p]) => ID.test(p)))
}

/** Which of two snapshots is older: the one made first. */
export const inTimeOrder = (a: Snapshot, b: Snapshot): [Snapshot, Snapshot] =>
  a.at <= b.at ? [a, b] : [b, a]
