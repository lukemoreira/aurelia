// SPDX-License-Identifier: AGPL-3.0-or-later
// The whole universe, read in the order of its books (ADR-0006, "This book / Whole universe"): each
// book is read for continuity as it stands, starting from what is true at the end of the book before
// it, and the books are laid end to end as one model for the views that draw across them. Plain TS.
import type { ChapterInfo, ContinuityInput, ContinuityModel, SceneInfo } from './continuity'
import { continuityModel, endState } from './continuity'
import { EMPTY_STATE } from './continuity-state'
import type { WorkspaceData } from './workspace-data'

/** The books of the universe a book is in, in the order the universe lists them. */
export function universeBookIds(data: WorkspaceData, bookId: string): string[] {
  const universe = data.universes.find((u) => u.books.includes(bookId))
  const known = new Set(data.books.map((b) => b.id))
  const ids = [...new Set(universe?.books ?? [])].filter((id) => known.has(id))
  return ids.length ? ids : [bookId]
}

/** Which books are read: this one alone, or every book of its universe. */
export type Scope = 'book' | 'universe'
/** The one choice of scope, in the one order and words, for every screen that offers it. */
export const SCOPE_LABEL = 'Scope'
export const SCOPES: { value: Scope; label: string }[] = [
  { value: 'book', label: 'This book' },
  { value: 'universe', label: 'Whole universe' },
]

/** One model per book, each starting from the end of the one before. */
export function universeModels(
  data: WorkspaceData,
  bookId: string,
  inputFor: (bookId: string) => ContinuityInput,
): ContinuityModel[] {
  const models: ContinuityModel[] = []
  let carry = EMPTY_STATE
  for (const id of universeBookIds(data, bookId)) {
    const earlier = [...models]
    const m = continuityModel(inputFor(id), {
      state: carry,
      sceneName: (scene) => {
        const from = earlier.find((e) => e.byId.has(scene))
        return from && `${bookTitle(from)}, ${from.sceneName(scene)}`
      },
    })
    models.push(m)
    carry = endState(m) ?? carry
  }
  return models
}

export const bookTitle = (m: ContinuityModel) =>
  m.data.books.find((b) => b.id === m.bookId)?.title ?? 'Untitled book'

/**
 * The books end to end: chapters keep their own numbers (the book's title heads them, as a part's does),
 * scenes keep their place in reading order across the universe, and the state at a scene is the one
 * its book's model reached, carried on from the books before.
 */
export function mergeModels(models: readonly ContinuityModel[]): ContinuityModel {
  const first = models[0]!
  const chapters: ChapterInfo[] = []
  const scenes: SceneInfo[] = []
  // Real chapters come first and the "Unfiled" stand-ins after them, as one book has them.
  const slots = models.flatMap((m) => m.chapters.map((c) => ({ m, c })))
  const ordered = [...slots.filter((s) => s.c.id), ...slots.filter((s) => !s.c.id)]
  const offset = new Map<ContinuityModel, number>()
  models.reduce((n, m) => (offset.set(m, n), n + m.scenes.length), 0)
  for (const { m, c } of ordered) {
    const part = [bookTitle(m), c.part].filter(Boolean).join(' · ')
    const chapter = chapters.length
    const copies = c.scenes.map((s) => ({ ...s, index: offset.get(m)! + s.index, chapter }))
    chapters.push({ ...c, part, scenes: copies })
    scenes.push(...copies)
  }
  scenes.sort((a, b) => a.index - b.index)
  const byId = new Map(scenes.map((s) => [s.id, s]))
  const sceneName = (id: string) => {
    const s = byId.get(id)
    return s ? `${s.ref} · ${s.title}` : 'a scene that is no longer here'
  }
  const union = <K, V>(of: (m: ContinuityModel) => ReadonlyMap<K, V>) =>
    new Map(models.flatMap((m) => [...of(m)]))
  return {
    ...first,
    scenes,
    byId,
    chapters,
    chapterCount: chapters.filter((c) => c.id).length,
    graph: undefined,
    presence: union((m) => m.presence),
    flow: { before: union((m) => m.flow.before), after: union((m) => m.flow.after) },
    characters: union((m) => m.characters),
    sceneName,
    changes: (id) => byId.get(id)?.doc.meta.changes ?? [],
  }
}
