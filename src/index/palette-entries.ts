// SPDX-License-Identifier: AGPL-3.0-or-later
import { STATUS_LABELS, type IconName } from '@/domain/ui-names'
import { bookOutline, sceneEyebrow } from '@/domain/outline'
import { colourOf } from '@/domain/scene-details'
import type { RecordFrontmatter } from '@/domain/schema/record'
import type { WorkspaceData } from '@/domain/workspace-data'

type EntryKind = 'record' | 'scene' | 'chapter' | 'book'

/** Something the palette and the pinned list can open. `key` is what is saved. */
export interface Entry {
  key: string
  kind: EntryKind
  id: string
  title: string
  sub: string
  icon: IconName
  hint?: string
  /** A character or arc colour, as a token name. */
  color?: string
  /** The book it belongs to. */
  bookId?: string
}

export const entryKey = (kind: EntryKind, id: string) => `${kind}:${id}`

const RECORD_ICON: Record<RecordFrontmatter['type'], IconName> = {
  character: 'user',
  place: 'place',
  world: 'globe',
  item: 'item',
  event: 'event',
  arc: 'arc',
  lore: 'lore',
  research: 'research',
  faction: 'lore',
  culture: 'lore',
  system: 'lore',
  note: 'lore',
}
const RECORD_LABEL: Record<RecordFrontmatter['type'], string> = {
  character: 'Character',
  place: 'Place',
  world: 'World',
  item: 'Item',
  event: 'Event',
  arc: 'Arc',
  lore: 'Lore',
  research: 'Research',
  faction: 'Faction',
  culture: 'Culture',
  system: 'System',
  note: 'Note',
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Every record, scene, chapter and book in the workspace, ready to search. */
export function buildEntries(data: WorkspaceData): Entry[] {
  const universeTitle = (id: string) => data.universes.find((u) => u.id === id)?.title ?? ''
  const bookTitle = (id: string) => data.books.find((b) => b.id === id)?.title ?? ''
  const firstBookOf = (universe: string) =>
    data.universes
      .find((u) => u.id === universe)
      ?.books.find((id) => data.books.some((b) => b.id === id))

  const records = data.records.map((r): Entry => {
    const scenes = data.scenes.filter(
      (s) => s.meta.pov === r.meta.id || s.meta.characters?.add?.includes(r.meta.id),
    ).length
    const scope =
      r.meta.scope === 'universe'
        ? `Shared in ${universeTitle(r.universe)}`
        : `${bookTitle(r.meta.scope.slice(5))} only`
    const color = colourOf(r)
    return {
      key: entryKey('record', r.meta.id),
      kind: 'record',
      id: r.meta.id,
      title: r.meta.title,
      sub: [RECORD_LABEL[r.meta.type], scope, r.summary].filter(Boolean).join(' · '),
      icon: RECORD_ICON[r.meta.type],
      ...(color ? { color } : {}),
      ...(scenes ? { hint: plural(scenes, 'scene') } : {}),
      bookId: r.meta.scope.startsWith('book:') ? r.meta.scope.slice(5) : firstBookOf(r.universe),
    }
  })

  const manuscript: Entry[] = []
  for (const book of data.books) {
    manuscript.push({
      key: entryKey('book', book.id),
      kind: 'book',
      id: book.id,
      title: book.title,
      sub: book.mode === 'branching' ? 'Branching book' : 'Book',
      icon: book.mode === 'branching' ? 'branch' : 'book',
      bookId: book.id,
    })
    for (const part of bookOutline(data, book.id))
      for (const c of part.chapters) {
        manuscript.push({
          key: entryKey('chapter', c.chapter.id),
          kind: 'chapter',
          id: c.chapter.id,
          title: c.chapter.title,
          sub: `Chapter ${c.number} · ${book.title}`,
          icon: 'chapter',
          bookId: book.id,
        })
        c.scenes.forEach((s, i) => {
          manuscript.push({
            key: entryKey('scene', s.meta.id),
            kind: 'scene',
            id: s.meta.id,
            title: s.meta.title,
            sub: `${sceneEyebrow(c.number, i + 1)} · ${book.title}`,
            icon: 'scene',
            ...(s.meta.status ? { hint: STATUS_LABELS[s.meta.status] } : {}),
            bookId: book.id,
          })
        })
      }
  }
  return [...records, ...manuscript]
}
