// SPDX-License-Identifier: AGPL-3.0-or-later
// Places as a free hierarchy: a place or world says which one it sits inside (`parent`), at any
// depth (planet → country → city → room). Plain data in, plain data out; nothing here writes.
import type { RecordDoc } from './workspace-data'

type PlaceRecord = Pick<RecordDoc, 'meta' | 'universe'>
const isPlace = (r: PlaceRecord) => r.meta.type === 'place' || r.meta.type === 'world'

export interface PlaceNode {
  id: string
  title: string
  type: 'place' | 'world'
  /** The author's own level name ("City", "Room"), when they gave one. */
  kind?: string
  children: PlaceNode[]
}

const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title)

/**
 * Where each place's parent link is followed. A link to a record that is not here (deleted, in
 * another book) or one that would close a loop (two devices each moved a place under the other)
 * is not followed: that place stands at the top. Nothing is hidden and nothing loops.
 */
function parents(records: PlaceRecord[]): Map<string, string | undefined> {
  const places = new Map(records.filter(isPlace).map((r) => [r.meta.id, r]))
  const out = new Map<string, string | undefined>()
  for (const [id, r] of places)
    out.set(id, places.has(r.meta.parent ?? '') ? r.meta.parent : undefined)
  // A loop: walk up from each place; a place met twice on one walk is in a loop, and the one with
  // the smallest ID in it is the one that stands at the top.
  const done = new Set<string>()
  for (const start of out.keys()) {
    const walk: string[] = []
    const seen = new Map<string, number>()
    let at: string | undefined = start
    while (at && !done.has(at) && !seen.has(at)) {
      seen.set(at, walk.length)
      walk.push(at)
      at = out.get(at)
    }
    if (at && seen.has(at)) {
      const loop = walk.slice(seen.get(at))
      out.set(
        loop.reduce((a, b) => (b < a ? b : a)),
        undefined,
      )
    }
    walk.forEach((id) => done.add(id))
  }
  return out
}

/** The worlds and places of `records` as trees, by name. */
export function placeTree(records: PlaceRecord[]): PlaceNode[] {
  const up = parents(records)
  const nodes = new Map<string, PlaceNode>()
  for (const r of records)
    if (isPlace(r))
      nodes.set(r.meta.id, {
        id: r.meta.id,
        title: r.meta.title,
        type: r.meta.type as 'place' | 'world',
        ...(r.meta.kind?.trim() ? { kind: r.meta.kind.trim() } : {}),
        children: [],
      })
  const roots: PlaceNode[] = []
  for (const [id, node] of nodes) {
    const parent = up.get(id)
    ;(parent ? nodes.get(parent)!.children : roots).push(node)
  }
  const sort = (list: PlaceNode[]) => {
    list.sort(byTitle)
    list.forEach((n) => sort(n.children))
  }
  sort(roots)
  return roots
}

/** The places above `id`, the outermost first: the breadcrumb ("Earth › France › Paris"). */
export function placeAncestors(
  records: PlaceRecord[],
  id: string,
): { id: string; title: string }[] {
  const up = parents(records)
  const title = new Map(records.map((r) => [r.meta.id, r.meta.title]))
  const chain: { id: string; title: string }[] = []
  for (let at = up.get(id); at && chain.length < 100; at = up.get(at))
    chain.unshift({ id: at, title: title.get(at) ?? at })
  return chain
}

/** The places directly inside `id`, by name. */
export function placeChildren(records: PlaceRecord[], id: string): { id: string; title: string }[] {
  const up = parents(records)
  return records
    .filter((r) => isPlace(r) && up.get(r.meta.id) === id)
    .map((r) => ({ id: r.meta.id, title: r.meta.title }))
    .sort(byTitle)
}

export type PlaceMove = { ok: true } | { ok: false; reason: string }

/**
 * Whether `id` may go inside `parentId` (null: to the top). Never inside itself or anything
 * inside it, only inside a place or world, and only where it can be seen from: a place of the
 * whole universe cannot sit inside one that belongs to a single book.
 */
export function canMovePlace(
  records: PlaceRecord[],
  id: string,
  parentId: string | null,
): PlaceMove {
  const me = records.find((r) => r.meta.id === id)
  if (!me || !isPlace(me)) return { ok: false, reason: 'Only a place or a world can be moved.' }
  if (parentId === null) return { ok: true }
  const to = records.find((r) => r.meta.id === parentId)
  if (!to || !isPlace(to))
    return { ok: false, reason: 'A place can only go inside a place or a world.' }
  if (to.universe !== me.universe)
    return { ok: false, reason: 'A place can only go inside one of the same universe.' }
  if (parentId === id) return { ok: false, reason: 'A place cannot go inside itself.' }
  if (placeAncestors(records, parentId).some((a) => a.id === id))
    return { ok: false, reason: 'A place cannot go inside one that is inside it.' }
  if (me.meta.scope === 'universe' && to.meta.scope !== 'universe')
    return {
      ok: false,
      reason:
        'A place shared by the whole universe cannot go inside one that belongs to a single book.',
    }
  if (
    me.meta.scope !== 'universe' &&
    to.meta.scope !== 'universe' &&
    to.meta.scope !== me.meta.scope
  )
    return { ok: false, reason: 'That place belongs to another book.' }
  return { ok: true }
}

/** Where a place goes when it is moved one level out (to its parent's level) or one level in (under the place above it). */
export function stepTarget(
  records: PlaceRecord[],
  id: string,
  step: 'out' | 'in',
): string | null | undefined {
  const up = parents(records)
  if (step === 'out') {
    const parent = up.get(id)
    return parent === undefined ? undefined : (up.get(parent) ?? null)
  }
  const parent = up.get(id)
  const mine =
    parent === undefined
      ? placeTree(records).map((n) => n.id)
      : placeChildren(records, parent).map((c) => c.id)
  const at = mine.indexOf(id)
  return at > 0 ? mine[at - 1] : undefined
}
