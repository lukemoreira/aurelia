// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { canMovePlace, placeAncestors, placeChildren, placeTree, stepTarget } from './places'
import type { RecordDoc } from './workspace-data'

const id = (prefix: string, n: number) => `${prefix}_${String(n).padStart(10, '0')}`
const make = (
  n: number,
  title: string,
  extra: Partial<RecordDoc['meta']> = {},
  type: 'place' | 'world' = 'place',
): RecordDoc => ({
  universe: id('unv', 1),
  meta: {
    title,
    schemaVersion: 1,
    id: id(type === 'world' ? 'wld' : 'plc', n),
    type,
    scope: 'universe',
    ...extra,
  },
})

const earth = make(1, 'Earth', { kind: 'Planet' }, 'world')
const france = make(2, 'France', { parent: earth.meta.id, kind: 'Country' })
const paris = make(3, 'Paris', { parent: france.meta.id })
const louvre = make(4, 'Louvre', { parent: paris.meta.id, kind: 'Museum' })
const mars = make(5, 'Mars', {}, 'world')
const all = [earth, france, paris, louvre, mars]

describe('the place tree', () => {
  it('nests a planet, a country, a city and a room, by name, with the author’s own level names', () => {
    const tree = placeTree(all)
    expect(tree.map((n) => n.title)).toEqual(['Earth', 'Mars'])
    expect(tree[0]!.kind).toBe('Planet')
    const room = tree[0]!.children[0]!.children[0]!.children[0]!
    expect(room).toMatchObject({ title: 'Louvre', kind: 'Museum', children: [] })
  })

  it('ignores records that are not places or worlds', () => {
    const hero = make(9, 'Elena', {})
    hero.meta = { ...hero.meta, type: 'character', id: id('chr', 9) }
    expect(placeTree([...all, hero]).flatMap((n) => n.title)).toEqual(['Earth', 'Mars'])
  })

  it('a parent that is not here (deleted, in another book) puts the place at the top, and hides nothing', () => {
    const lost = make(6, 'Lost Quay', { parent: id('plc', 99) })
    expect(placeTree([...all, lost]).map((n) => n.title)).toEqual(['Earth', 'Lost Quay', 'Mars'])
  })

  it('a loop made by two devices (each moved a place under the other) neither hangs nor hides a place', () => {
    const a = make(10, 'A', { parent: id('plc', 11) })
    const b = make(11, 'B', { parent: id('plc', 10) })
    const c = make(12, 'C', { parent: id('plc', 11) })
    const tree = placeTree([a, b, c])
    const flat = (ns: typeof tree): string[] => ns.flatMap((n) => [n.title, ...flat(n.children)])
    expect(flat(tree).sort()).toEqual(['A', 'B', 'C'])
    expect(tree).toHaveLength(1) // the loop is cut at one place; the rest stays nested
    expect(placeAncestors([a, b, c], a.meta.id).length).toBeLessThan(3)
  })

  it('knows the breadcrumb and what is directly inside', () => {
    expect(placeAncestors(all, louvre.meta.id).map((a) => a.title)).toEqual([
      'Earth',
      'France',
      'Paris',
    ])
    expect(placeAncestors(all, earth.meta.id)).toEqual([])
    expect(placeChildren(all, france.meta.id).map((c) => c.title)).toEqual(['Paris'])
  })
})

describe('which moves are allowed', () => {
  it('a place may go inside another place or world, or to the top', () => {
    expect(canMovePlace(all, paris.meta.id, mars.meta.id)).toEqual({ ok: true })
    expect(canMovePlace(all, paris.meta.id, null)).toEqual({ ok: true })
  })

  it('never inside itself or inside anything inside it (no cycles)', () => {
    expect(canMovePlace(all, france.meta.id, france.meta.id)).toMatchObject({ ok: false })
    expect(canMovePlace(all, earth.meta.id, louvre.meta.id)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/inside it/),
    })
    expect(canMovePlace(all, france.meta.id, paris.meta.id)).toMatchObject({ ok: false })
  })

  it('not inside something that is not a place, or a place that is not there', () => {
    const hero = make(9, 'Elena', {})
    hero.meta = { ...hero.meta, type: 'character', id: id('chr', 9) }
    expect(canMovePlace([...all, hero], paris.meta.id, hero.meta.id)).toMatchObject({ ok: false })
    expect(canMovePlace(all, paris.meta.id, id('plc', 77))).toMatchObject({ ok: false })
    expect(canMovePlace([...all, hero], hero.meta.id, null)).toMatchObject({ ok: false })
  })

  it('a place of the whole universe cannot go inside one that belongs to a single book', () => {
    const own = make(7, 'Book-only quay', { scope: `book:${id('bok', 1)}` })
    expect(canMovePlace([...all, own], paris.meta.id, own.meta.id)).toMatchObject({ ok: false })
    // the other way round is fine: a book's own place may sit in a shared one
    expect(canMovePlace([...all, own], own.meta.id, paris.meta.id)).toEqual({ ok: true })
    const other = make(8, 'Other-book hut', { scope: `book:${id('bok', 2)}` })
    expect(canMovePlace([...all, own, other], own.meta.id, other.meta.id)).toMatchObject({
      ok: false,
    })
  })

  it('steps out to the parent’s level, and in under the place above', () => {
    const rue = make(13, 'Rue Cler', { parent: france.meta.id })
    const set = [...all, rue]
    expect(stepTarget(set, louvre.meta.id, 'out')).toBe(france.meta.id)
    expect(stepTarget(set, paris.meta.id, 'out')).toBe(earth.meta.id)
    expect(stepTarget(set, france.meta.id, 'out')).toBeNull() // France's parent, Earth, is a root
    expect(stepTarget(set, earth.meta.id, 'out')).toBeUndefined() // already at the top
    // Paris sorts before Rue Cler: Rue Cler can go in under Paris; Paris has nothing above it
    expect(stepTarget(set, rue.meta.id, 'in')).toBe(paris.meta.id)
    expect(stepTarget(set, paris.meta.id, 'in')).toBeUndefined()
    expect(stepTarget(set, mars.meta.id, 'in')).toBe(earth.meta.id) // roots are siblings too
  })
})
