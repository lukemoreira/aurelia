// SPDX-License-Identifier: AGPL-3.0-or-later
import { isId } from './ids'
import { freshKeys, keyAfter, keyBetween } from './order'
import type { WorkspaceData } from './workspace-data'

/** Where a dragged or moved item lands, against another item. */
export type MoveTarget = { id: string; where: 'before' | 'after' | 'inside' }

/**
 * What a move changes in the moved item's own file, and nothing else: its order key, and where it
 * hangs (a scene's chapter, a chapter's part; `null` takes the part away). Other files are never
 * touched, because the keys are fractions that always fit between two neighbours.
 */
export interface Move {
  id: string
  fields: { order: string; chapter?: string; part?: string | null }
  /** What was asked for, so the move can be told in words ("after “Gate”"). */
  target: MoveTarget
  /**
   * Siblings that are given fresh keys too. Only when no key fits between the neighbours (two
   * share a key, or one is "0" with nothing below it): the placement is always what was asked for.
   */
  also?: { id: string; order: string }[]
}

interface Sibling {
  id: string
  order: string
}
const bySort = (a: Sibling, b: Sibling) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

interface Placed {
  order: string
  also?: { id: string; order: string }[]
}

/**
 * The key for `moved` placed next to `anchor` (or at the end), among `all` the siblings. Null when
 * it is already exactly there, so a drop on itself writes nothing. When no key fits, every
 * sibling that needs one gets a fresh key (`also`), so the result is always the order asked for.
 */
function keyFor(all: Sibling[], moved: string, anchor: MoveTarget | 'end'): Placed | null {
  const sorted = [...all].sort(bySort)
  const others = sorted.filter((s) => s.id !== moved)
  if (anchor === 'end') {
    if (sorted.at(-1)?.id === moved) return null
    return { order: keyAfter(others.at(-1)?.order) }
  }
  const i = others.findIndex((s) => s.id === anchor.id)
  if (i < 0) return null
  const at = anchor.where === 'after' ? i + 1 : i
  if (sorted.findIndex((s) => s.id === moved) === at) return null
  const order = keyBetween(others[at - 1]?.order, others[at]?.order)
  if (order !== undefined) return { order }
  const ordered = [...others.slice(0, at), { id: moved, order: '' }, ...others.slice(at)]
  const keys = freshKeys(ordered.length)
  const also = ordered.flatMap((x, n) =>
    x.id !== moved && x.order !== keys[n] ? [{ id: x.id, order: keys[n]! }] : [],
  )
  return { order: keys[at]!, also }
}

const placedMove = (id: string, target: MoveTarget, placed: Placed, rest: object): Move => ({
  id,
  fields: { order: placed.order, ...rest },
  target,
  ...(placed.also?.length ? { also: placed.also } : {}),
})

const scenesOf = (data: WorkspaceData, chapter: string): Sibling[] =>
  data.scenes
    .filter((s) => s.meta.chapter === chapter)
    .map((s) => ({ id: s.meta.id, order: s.meta.order }))

/** The chapters of a book, in order. */
const chaptersOf = (data: WorkspaceData, book: string) =>
  data.chapters.filter((c) => c.book === book)

/** The book a scene's file is in. A scene never moves to a chapter of another book: its file stays in its folder. */
function sceneBook(data: WorkspaceData, id: string): string | undefined {
  const scene = data.scenes.find((s) => s.meta.id === id)
  return scene?.book ?? data.chapters.find((c) => c.id === scene?.meta.chapter)?.book
}
const chapterBook = (data: WorkspaceData, id: string) =>
  data.chapters.find((c) => c.id === id)?.book

/** A move, or null when the target does not make sense for the item or nothing would change. */
export function planMove(data: WorkspaceData, id: string, target: MoveTarget): Move | null {
  if (id === target.id) return null
  if (isId(id, 'scn')) {
    if (isId(target.id, 'chp') && target.where === 'inside') {
      if (chapterBook(data, target.id) !== sceneBook(data, id)) return null
      const placed = keyFor(scenesOf(data, target.id), id, 'end')
      return placed && placedMove(id, target, placed, { chapter: target.id })
    }
    const to = isId(target.id, 'scn') ? data.scenes.find((s) => s.meta.id === target.id) : undefined
    if (!to || target.where === 'inside') return null
    if (chapterBook(data, to.meta.chapter) !== sceneBook(data, id)) return null
    const placed = keyFor(scenesOf(data, to.meta.chapter), id, target)
    return placed && placedMove(id, target, placed, { chapter: to.meta.chapter })
  }
  if (isId(id, 'chp')) {
    const moved = data.chapters.find((c) => c.id === id)
    if (!moved) return null
    if (isId(target.id, 'prt') && target.where === 'inside') {
      if (!data.parts.some((p) => p.id === target.id)) return null
      const last = chaptersOf(data, moved.book)
        .filter((c) => c.part === target.id && c.id !== id)
        .map((c) => c.order)
        .sort()
        .at(-1)
      // The key is global and the view is per part: a chapter already past the part's last keeps its own.
      const order = last === undefined || moved.order > last ? moved.order : keyAfter(last)
      return moved.part === target.id && order === moved.order
        ? null
        : placedMove(id, target, { order }, { part: target.id })
    }
    const to = isId(target.id, 'chp') ? data.chapters.find((c) => c.id === target.id) : undefined
    if (!to || to.book !== moved.book || target.where === 'inside') return null
    // The neighbours that count are the ones in the same part: the order key is global, the view is per part.
    const group = chaptersOf(data, moved.book).filter((c) => c.part === to.part || c.id === id)
    const placed = keyFor(group, id, target)
    if (placed === null && moved.part === to.part) return null
    return placedMove(id, target, placed ?? { order: moved.order }, { part: to.part ?? null })
  }
  if (isId(id, 'prt')) {
    const moved = data.parts.find((p) => p.id === id)
    const to = isId(target.id, 'prt') ? data.parts.find((p) => p.id === target.id) : undefined
    if (!moved || !to || to.book !== moved.book || target.where === 'inside') return null
    const placed = keyFor(
      data.parts.filter((p) => p.book === moved.book),
      id,
      target,
    )
    return placed && placedMove(id, target, placed, {})
  }
  return null
}

/** One step up (-1) or down (+1) among the items it shares a parent with: the keyboard's move. */
export function planStep(data: WorkspaceData, id: string, step: -1 | 1): Move | null {
  let siblings: Sibling[] = []
  if (isId(id, 'scn')) {
    const chapter = data.scenes.find((s) => s.meta.id === id)?.meta.chapter
    siblings = chapter ? scenesOf(data, chapter) : []
  } else if (isId(id, 'chp')) {
    const moved = data.chapters.find((c) => c.id === id)
    siblings = moved
      ? chaptersOf(data, moved.book).filter(
          (c) => c.part === moved.part || (!c.part && !moved.part),
        )
      : []
  } else if (isId(id, 'prt')) {
    const moved = data.parts.find((p) => p.id === id)
    siblings = data.parts.filter((p) => p.book === moved?.book)
  }
  const sorted = [...siblings].sort(bySort)
  const next = sorted[sorted.findIndex((s) => s.id === id) + step]
  return next ? planMove(data, id, { id: next.id, where: step < 0 ? 'before' : 'after' }) : null
}

/** The chapters a scene can be moved or filed to: every chapter of its book, in reading order. */
export function chapterChoices(data: WorkspaceData, book: string) {
  return [...chaptersOf(data, book)]
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .map((c, i) => ({ id: c.id, label: `${i + 1} · ${c.title}` }))
}

/**
 * Which items have a place above and below them among their siblings, for every scene, chapter
 * and part at once (one pass, so a menu on every row costs nothing per row).
 */
export function stepAvailability(data: WorkspaceData): Map<string, { up: boolean; down: boolean }> {
  const groups = new Map<string, Sibling[]>()
  const add = (key: string, item: Sibling) => groups.set(key, [...(groups.get(key) ?? []), item])
  for (const s of data.scenes) add(`s:${s.meta.chapter}`, { id: s.meta.id, order: s.meta.order })
  for (const c of data.chapters) add(`c:${c.book}:${c.part ?? ''}`, { id: c.id, order: c.order })
  for (const p of data.parts) add(`p:${p.book}`, { id: p.id, order: p.order })
  const out = new Map<string, { up: boolean; down: boolean }>()
  for (const group of groups.values()) {
    group.sort(bySort)
    group.forEach((item, i) => out.set(item.id, { up: i > 0, down: i < group.length - 1 }))
  }
  return out
}
