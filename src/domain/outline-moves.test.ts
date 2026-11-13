// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { saltmarchSample } from '@/sample/saltmarch'
import { bookOutline } from './outline'
import { chapterChoices, planMove, planStep, stepAvailability, type Move } from './outline-moves'
import type { WorkspaceData } from './workspace-data'

/** The data as it would read after the one file the move changes was written. */
function applied(data: WorkspaceData, move: Move): WorkspaceData {
  const { order, chapter, part } = move.fields
  const rekeyed = new Map((move.also ?? []).map((o) => [o.id, o.order]))
  return {
    ...data,
    scenes: data.scenes.map((s) =>
      s.meta.id === move.id
        ? { ...s, meta: { ...s.meta, order, ...(chapter ? { chapter } : {}) } }
        : rekeyed.has(s.meta.id)
          ? { ...s, meta: { ...s.meta, order: rekeyed.get(s.meta.id)! } }
          : s,
    ),
    chapters: data.chapters.map((c) => {
      if (c.id !== move.id) return c
      const { part: _old, ...rest } = c
      void _old
      return {
        ...rest,
        order,
        ...(part === undefined ? (c.part ? { part: c.part } : {}) : part ? { part } : {}),
      }
    }),
    parts: data.parts.map((p) => (p.id === move.id ? { ...p, order } : p)),
  }
}

const sample = () => {
  const data = saltmarchSample()
  const book = data.books[0]!.id
  return { data, book, outline: () => bookOutline(data, book) }
}
const sceneIds = (data: WorkspaceData, book: string, chapterIndex: number) =>
  bookOutline(data, book)
    .flatMap((g) => g.chapters)
    [chapterIndex]!.scenes.map((s) => s.meta.id)

describe('planStep', () => {
  it('moves a scene one place up or down among its chapter’s scenes, and rewrites only its own order', () => {
    const { data, book } = sample()
    const [a, b, c] = sceneIds(data, book, 0)
    expect(a && b && c).toBeTruthy()
    const down = planStep(data, a!, 1)!
    expect(Object.keys(down.fields)).toEqual(['order', 'chapter']) // its own file: nothing about a neighbour
    expect(sceneIds(applied(data, down), book, 0).slice(0, 3)).toEqual([b, a, c])
    const up = planStep(data, c!, -1)!
    expect(sceneIds(applied(data, up), book, 0).slice(0, 3)).toEqual([a, c, b])
  })

  it('has nowhere to go at either end', () => {
    const { data, book } = sample()
    const ids = sceneIds(data, book, 0)
    expect(planStep(data, ids[0]!, -1)).toBeNull()
    expect(planStep(data, ids.at(-1)!, 1)).toBeNull()
  })

  it('moves chapters within their part, and parts among parts', () => {
    const { data, book } = sample()
    const groups = bookOutline(data, book).filter((g) => g.part && g.chapters.length > 1)
    const [first, second] = groups[0]!.chapters.map((c) => c.chapter.id)
    const moved = applied(data, planStep(data, first!, 1)!)
    const after = bookOutline(moved, book).find((g) => g.part?.id === groups[0]!.part!.id)!
    expect(after.chapters.slice(0, 2).map((c) => c.chapter.id)).toEqual([second, first])
    const [p1, p2] = data.parts
      .filter((p) => p.book === book)
      .sort((a, b) => (a.order < b.order ? -1 : 1))
    const swapped = applied(data, planStep(data, p1!.id, 1)!)
    const order = bookOutline(swapped, book)
      .filter((g) => g.part)
      .map((g) => g.part!.id)
    expect(order.slice(0, 2)).toEqual([p2!.id, p1!.id])
  })
})

describe('planMove', () => {
  it('drops a scene before or after another scene, in another chapter too (its chapter changes with it)', () => {
    const { data, book } = sample()
    const mover = sceneIds(data, book, 0)[0]!
    const target = sceneIds(data, book, 1)[1]!
    const before = planMove(data, mover, { id: target, where: 'before' })!
    const targetChapter = data.scenes.find((s) => s.meta.id === target)!.meta.chapter
    expect(before.fields.chapter).toBe(targetChapter)
    const after = sceneIds(applied(data, before), book, 1)
    expect(after.indexOf(mover)).toBe(after.indexOf(target) - 1)
    const behind = planMove(data, mover, { id: target, where: 'after' })!
    const later = sceneIds(applied(data, behind), book, 1)
    expect(later.indexOf(mover)).toBe(later.indexOf(target) + 1)
  })

  it('drops a scene on a chapter to put it last in that chapter', () => {
    const { data, book } = sample()
    const mover = sceneIds(data, book, 0)[0]!
    const chapter = bookOutline(data, book).flatMap((g) => g.chapters)[2]!.chapter.id
    const result = sceneIds(
      applied(data, planMove(data, mover, { id: chapter, where: 'inside' })!),
      book,
      2,
    )
    expect(result.at(-1)).toBe(mover)
  })

  it('drops a chapter on a part to put it last in the part; before another chapter it takes that chapter’s part', () => {
    const { data, book } = sample()
    const chapters = bookOutline(data, book).flatMap((g) =>
      g.chapters.map((c) => ({ c, part: g.part })),
    )
    const mover = chapters.find((x) => !x.part)?.c ?? chapters[0]!.c
    const part = data.parts.find((p) => p.book === book && p.id !== mover.chapter.part)!
    const into = applied(data, planMove(data, mover.chapter.id, { id: part.id, where: 'inside' })!)
    const group = bookOutline(into, book).find((g) => g.part?.id === part.id)!
    expect(group.chapters.at(-1)?.chapter.id).toBe(mover.chapter.id)
    const other = chapters.find(
      (x) => x.part && x.part.id !== part.id && x.c.chapter.id !== mover.chapter.id,
    )!
    const next = planMove(into, mover.chapter.id, { id: other.c.chapter.id, where: 'before' })!
    expect(next.fields.part).toBe(other.part!.id)
  })

  it('answers null when nothing would change or the drop makes no sense', () => {
    const { data, book } = sample()
    const ids = sceneIds(data, book, 0)
    const chapterId = data.scenes.find((s) => s.meta.id === ids[0])!.meta.chapter
    expect(planMove(data, ids[0]!, { id: ids[0]!, where: 'after' })).toBeNull() // itself
    expect(planMove(data, ids[0]!, { id: ids[1]!, where: 'before' })).toBeNull() // already there
    expect(planMove(data, ids.at(-1)!, { id: chapterId, where: 'inside' })).toBeNull() // already last
    expect(planMove(data, ids[0]!, { id: ids[1]!, where: 'inside' })).toBeNull() // inside a scene
    expect(planMove(data, ids[0]!, { id: chapterId, where: 'before' })).toBeNull() // beside a chapter
    expect(planMove(data, chapterId, { id: ids[0]!, where: 'after' })).toBeNull() // a chapter beside a scene
    expect(planMove(data, 'scn_aaaaaaaaaa', { id: ids[0]!, where: 'after' })).toBeNull() // unknown
    expect(planMove(data, ids[0]!, { id: 'chp_aaaaaaaaaa', where: 'inside' })).toBeNull()
    expect(planMove(data, data.books[0]!.id, { id: ids[0]!, where: 'after' })).toBeNull() // a book
  })

  it('never moves a scene to a chapter of another book', () => {
    const { data, book } = sample()
    const other = data.books.find((b) => b.id !== book)
    const foreign = data.chapters.find((c) => c.book === other?.id)
    if (!foreign) return // the sample has one book with chapters; the storage tests cover two books
    const mover = sceneIds(data, book, 0)[0]!
    expect(planMove(data, mover, { id: foreign.id, where: 'inside' })).toBeNull()
  })
})

describe('chapterChoices', () => {
  it('lists the book’s chapters in reading order, numbered', () => {
    const { data, book } = sample()
    const choices = chapterChoices(data, book)
    expect(choices.length).toBe(data.chapters.filter((c) => c.book === book).length)
    expect(choices[0]!.label).toMatch(/^1 · /)
  })
})

describe('stepAvailability', () => {
  it('says the same as planStep for every scene, chapter and part', () => {
    const { data } = sample()
    const steps = stepAvailability(data)
    const ids = [
      ...data.scenes.map((s) => s.meta.id),
      ...data.chapters.map((c) => c.id),
      ...data.parts.map((p) => p.id),
    ]
    expect(ids.length).toBeGreaterThan(20)
    for (const id of ids)
      expect(steps.get(id), id).toEqual({
        up: planStep(data, id, -1) !== null,
        down: planStep(data, id, 1) !== null,
      })
  })
})

describe('a move where no key fits', () => {
  /** The first chapter's scenes with the keys given (the rest keep sorted keys after them). */
  function withKeys(keys: string[]) {
    const { data, book } = sample()
    const ids = sceneIds(data, book, 0)
    const crafted: WorkspaceData = {
      ...data,
      scenes: data.scenes.map((s) => {
        const i = ids.indexOf(s.meta.id)
        return i < 0 ? s : { ...s, meta: { ...s.meta, order: keys[i] ?? `z${i}` } }
      }),
    }
    return { data: crafted, book, ids }
  }

  it('puts the scene exactly where it was dropped when nothing sorts before the first key ("0")', () => {
    const { data, book, ids } = withKeys(['0', 'a', 'b'])
    const move = planMove(data, ids[1]!, { id: ids[0]!, where: 'before' })!
    expect(move.also?.length).toBeGreaterThan(0) // the neighbours got fresh keys
    expect(sceneIds(applied(data, move), book, 0).slice(0, 3)).toEqual([ids[1], ids[0], ids[2]])
  })

  it('puts it where it was dropped when two scenes share a key', () => {
    const { data, book, ids } = withKeys(['a', 'a', 'b'])
    const move = planMove(data, ids[2]!, { id: ids[1]!, where: 'before' })!
    const after = sceneIds(applied(data, move), book, 0)
    expect(after.indexOf(ids[2]!)).toBeLessThan(after.indexOf(ids[1]!))
    expect(after.indexOf(ids[2]!)).toBeGreaterThan(after.indexOf(ids[0]!))
  })

  it('writes only the moved scene when a key does fit', () => {
    const { data, ids } = withKeys(['a', 'b', 'c'])
    expect(planMove(data, ids[2]!, { id: ids[1]!, where: 'before' })!.also).toBeUndefined()
  })
})
