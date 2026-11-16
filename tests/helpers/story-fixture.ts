// SPDX-License-Identifier: AGPL-3.0-or-later
import { freshKeys } from '@/domain/order'
import { sampleId } from '@/sample/ids'
import { validateWorkspaceData, type WorkspaceData } from '@/domain/workspace-data'

export interface SceneSpec {
  /** A short name; the scene's ID and title come from it. */
  key: string
  /** [label, key of the target scene (or any ID for a broken choice)] */
  choices?: [string, string][]
  ending?: boolean
  chapter?: string
}

export const scn = (key: string) => sampleId('scn', key)

/** One book from a list of scenes (branching unless said otherwise). */
export function storyBook(
  scenes: SceneSpec[],
  opts: { start?: string; mode?: 'linear' | 'branching'; dismissed?: string[] } = {},
): WorkspaceData {
  const bok = sampleId('bok', 'story')
  const unv = sampleId('unv', 'story')
  const keys = freshKeys(scenes.length)
  const chapters = Array.from(new Set(scenes.map((s) => s.chapter ?? 'c1')))
  return validateWorkspaceData({
    workspace: { schemaVersion: 1, id: sampleId('wsp', 'story'), name: 'Story', universes: [unv] },
    universes: [{ title: 'U', schemaVersion: 1, id: unv, kind: 'standalone', books: [bok] }],
    books: [
      {
        title: 'Story',
        schemaVersion: 1,
        id: bok,
        mode: opts.mode ?? 'branching',
        ...(opts.start ? { start: scn(opts.start) } : {}),
        ...(opts.dismissed ? { dismissedFindings: opts.dismissed } : {}),
      },
    ],
    parts: [],
    chapters: chapters.map((c, i) => ({
      title: c,
      schemaVersion: 1,
      id: sampleId('chp', c),
      book: bok,
      order: String.fromCharCode(97 + i),
    })),
    scenes: scenes.map((s, i) => ({
      meta: {
        title: s.key,
        schemaVersion: 1,
        id: scn(s.key),
        chapter: sampleId('chp', s.chapter ?? 'c1'),
        order: keys[i]!,
        ...(s.ending ? { ending: true } : {}),
        ...(s.choices
          ? {
              choices: s.choices.map(([label, target], n) => ({
                id: sampleId('chc', `${s.key}:${n}`),
                label,
                target: target.includes('_') ? target : scn(target),
              })),
            }
          : {}),
      },
      body: '',
      words: 100,
      book: bok,
    })),
    records: [],
  })
}

export const bookIdOf = (data: WorkspaceData) => data.books[0]!.id
