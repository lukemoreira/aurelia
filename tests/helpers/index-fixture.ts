// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Alias, RecordType } from '@/domain/schema/record'
import type { RecordDoc, SceneDoc, WorkspaceData } from '@/domain/workspace-data'

/** A valid ID: `chr_0000000007` for ('chr', 7). */
export const id = (prefix: string, n: number | string) => `${prefix}_${String(n).padStart(10, '0')}`

interface SceneSpec {
  n: number
  title?: string
  body: string
  /** 1 or 2: which book (default 1). */
  book?: 1 | 2
  ignoreNames?: string[]
  summary?: string
}
interface RecordSpec {
  n: number
  type?: RecordType
  title: string
  aliases?: Alias[]
  /** `universe`, or `1` / `2` for a record private to that book. */
  scope?: 'universe' | 1 | 2
  summary?: string
  body?: string
}

const PREFIX: Partial<Record<RecordType, string>> = { character: 'chr', place: 'plc', item: 'itm' }

/** A small workspace: one shared universe with books 1 and 2, one chapter each, and the scenes and records given. */
export function fixture(scenes: SceneSpec[], records: RecordSpec[] = []): WorkspaceData {
  const books = [1, 2].map((n) => ({
    title: `Book ${n}`,
    schemaVersion: 1,
    id: id('bok', n),
    mode: 'linear' as const,
  }))
  return {
    workspace: { name: 'Test', schemaVersion: 1, id: id('wsp', 1), universes: [id('unv', 1)] },
    universes: [
      {
        title: 'Saltmarch',
        schemaVersion: 1,
        id: id('unv', 1),
        kind: 'shared',
        books: books.map((b) => b.id),
      },
    ],
    books,
    parts: [],
    chapters: [1, 2].map((n) => ({
      title: `Chapter ${n}`,
      schemaVersion: 1,
      id: id('chp', n),
      book: id('bok', n),
      order: 'a0',
    })),
    scenes: scenes.map((s): SceneDoc => ({
      meta: {
        title: s.title ?? `Scene ${s.n}`,
        schemaVersion: 1,
        id: id('scn', s.n),
        chapter: id('chp', s.book ?? 1),
        order: `a${s.n}`,
        ...(s.ignoreNames ? { ignoreNames: s.ignoreNames } : {}),
        ...(s.summary ? { summary: s.summary } : {}),
      },
      body: s.body,
      words: s.body.split(/\s+/).length,
      book: id('bok', s.book ?? 1),
    })),
    records: records.map((r): RecordDoc => {
      const type = r.type ?? 'character'
      return {
        meta: {
          title: r.title,
          schemaVersion: 1,
          id: id(PREFIX[type] ?? 'nte', r.n),
          type,
          scope:
            r.scope === undefined || r.scope === 'universe'
              ? 'universe'
              : `book:${id('bok', r.scope)}`,
          ...(r.aliases ? { aliases: r.aliases } : {}),
        },
        universe: id('unv', 1),
        ...(r.summary ? { summary: r.summary } : {}),
        ...(r.body !== undefined ? { body: r.body } : {}),
      }
    }),
  }
}
