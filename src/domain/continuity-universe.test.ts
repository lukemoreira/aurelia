// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { id, story, type Sc } from '../../tests/helpers/continuity-fixture'
import { continuityFindings } from './continuity-checks'
import { stateRows } from './continuity-views'
import { sampleId } from '@/sample/ids'
import { progression } from './progression'
import { universeBookIds, universeModels, mergeModels } from './continuity-universe'

const ana = id.chr('ana')
const names = { characters: ['ana', 'bob'] }
const die = { who: 'ana', kind: 'status', value: 'dead' }

// Book one ends with Ana's death; book two has her walking in.
const books: Sc[] = [
  { key: 'a1', book: 'one', ch: 'c1', pov: 'ana' },
  { key: 'a2', book: 'one', ch: 'c2', pov: 'ana', changes: [die] },
  { key: 'b1', book: 'two', ch: 'c1', pov: 'bob', add: ['ana'] },
  { key: 'u1', book: 'two', ch: 'c2', pov: 'bob' },
]

describe('the whole universe, read in the order of its books', () => {
  const f = story(books, { names })

  it('lays the books end to end, each chapter under its book’s title', () => {
    const merged = f.merged()
    expect(merged.scenes.map((s) => s.title)).toEqual(['a1', 'a2', 'b1', 'u1'])
    expect(merged.scenes.map((s) => s.index)).toEqual([0, 1, 2, 3])
    // chapters keep their own numbers; the book heads them, as a part does
    expect(merged.chapters.map((c) => [c.part, c.number])).toEqual([
      ['one', 1],
      ['one', 2],
      ['two', 1],
      ['two', 2],
    ])
    expect(merged.chapterCount).toBe(4)
    // each scene points at its own chapter in the merged list, and keeps its book
    expect(
      merged.scenes.map((s) => [
        s.book === f.models[0]!.bookId,
        merged.chapters[s.chapter]!.scenes.includes(s),
      ]),
    ).toEqual([
      [true, true],
      [true, true],
      [false, true],
      [false, true],
    ])
  })

  it('keeps the scenes of no chapter after the real chapters of every book', () => {
    const loose = id.scn('a2')
    const data = {
      ...f.data,
      scenes: f.data.scenes.map((s) =>
        s.meta.id === loose ? { ...s, meta: { ...s.meta, chapter: sampleId('chp', 'gone') } } : s,
      ),
    }
    const merged = mergeModels(
      universeModels(data, f.models[0]!.bookId, (bookId) => ({ ...f.input, data, bookId })),
    )
    expect(merged.chapters.map((c) => c.id !== '')).toEqual([true, true, true, true, false])
    expect(merged.chapterCount).toBe(4)
    expect(merged.chapters.at(-1)!.scenes.map((s) => s.title)).toEqual(['a2'])
    // every scene still names the chapter it is in
    for (const s of merged.scenes) expect(merged.chapters[s.chapter]!.scenes).toContain(s)
    // and reading order does not move
    expect(merged.scenes.map((s) => s.title)).toEqual(['a1', 'a2', 'b1', 'u1'])
  })

  it('follows the order the universe lists its books in, not the order the files are read', () => {
    const [u] = f.data.universes
    const swapped = { ...f.data, universes: [{ ...u!, books: [...u!.books].reverse() }] }
    const first = f.models[0]!.bookId
    expect(universeBookIds(swapped, first)).toEqual([...u!.books].reverse())
    const models = universeModels(swapped, first, (bookId) => ({ ...f.input, bookId }))
    expect(mergeModels(models).scenes.map((s) => s.title)).toEqual(['b1', 'u1', 'a1', 'a2'])
  })

  it('carries what is true at the end of a book into the next: she is dead in book two', () => {
    const merged = f.merged()
    const status = (scene: string) =>
      stateRows(merged, id.scn(scene), ana).find((r) => r.label === 'Status')?.items
    expect(status('a1')).toEqual([{ text: 'Alive', some: false }])
    expect(status('b1')).toEqual([{ text: 'Dead', since: '2.1', some: false }])
    // read together, the scene that made it so names its book: book two has a 2.1 of its own
    const named = stateRows(merged, id.scn('b1'), ana, true).find((r) => r.label === 'Status')
    expect(named?.items).toEqual([{ text: 'Dead', since: 'one · 2.1', some: false }])
    // read alone, the second book knows nothing of her death
    const alone = story(
      books.filter((s) => s.book === 'two'),
      { names },
    )
    expect(stateRows(alone.m, id.scn('b1'), ana).find((r) => r.label === 'Status')?.items).toEqual([
      { text: 'Alive', some: false },
    ])
  })

  it('finds a death in one book and an appearance in the next, naming the book it happened in', () => {
    const found = f.models.flatMap((m) => continuityFindings(m))
    const f1 = found.filter((x) => x.check === 'appears-after-exit')
    expect(f1.map((x) => x.scene)).toEqual([id.scn('b1')])
    expect(f1[0]!.body).toBe('ana is dead since one, 2.1 · a2, but appears in 1.1 · b1.')
    // read on its own, the first book raises nothing
    expect(continuityFindings(f.m).filter((x) => x.check === 'appears-after-exit')).toEqual([])
  })

  it('shows a character across the books in one progression, and the scrubber starts on their last scene', () => {
    const p = progression(f.merged(), ana)
    expect(p.scenes.map((s) => s.present)).toEqual([true, true, true, false])
    expect(p.start).toBe(2)
    expect(p.chapters.map((c) => c.part)).toEqual(['one', 'one', 'two', 'two'])
    expect(p.chapters.map((c) => c.scenes)).toEqual([1, 1, 1, 0])
    expect(p.log.map((e) => e.ref)).toEqual(['2.1'])
  })

  it('starts the next book from where a branching book can end, on every path or some', () => {
    const f2 = story(
      [
        {
          key: 's',
          book: 'one',
          ch: 'c1',
          pov: 'ana',
          choices: [
            ['x', 'l'],
            ['y', 'r'],
          ],
        },
        { key: 'l', book: 'one', ch: 'c2', pov: 'ana', changes: [die], ending: true },
        { key: 'r', book: 'one', ch: 'c3', pov: 'ana', ending: true },
        { key: 'n', book: 'two', ch: 'c1', pov: 'bob', add: ['ana'] },
      ],
      { mode: 'branching', start: 's', names },
    )
    const found = f2.models
      .flatMap((m) => continuityFindings(m))
      .filter((x) => x.check === 'appears-after-exit')
    expect(found.map((x) => [x.scene, x.paths])).toEqual([[id.scn('n'), 'some']])
  })

  it('carries the end of a book past one with no scenes in it', () => {
    const [u] = f.data.universes
    const empty = {
      title: 'Empty',
      schemaVersion: 1,
      id: sampleId('bok', 'empty'),
      mode: 'linear' as const,
    }
    const data = {
      ...f.data,
      books: [...f.data.books, empty],
      universes: [{ ...u!, books: [u!.books[0]!, empty.id, u!.books[1]!] }],
    }
    const models = universeModels(data, u!.books[0]!, (bookId) => ({ ...f.input, data, bookId }))
    expect(models.map((m) => m.scenes.length)).toEqual([2, 0, 2])
    const found = continuityFindings(models[2]!).filter((x) => x.check === 'appears-after-exit')
    expect(found.map((x) => x.scene)).toEqual([id.scn('b1')])
  })

  it('reads a book once, even when the universe lists it twice', () => {
    const [u] = f.data.universes
    const [a, b] = u!.books
    const data = { ...f.data, universes: [{ ...u!, books: [a!, a!, b!, a!] }] }
    expect(universeBookIds(data, a!)).toEqual([a, b])
    const models = universeModels(data, a!, (bookId) => ({ ...f.input, bookId }))
    expect(models).toHaveLength(2)
    expect(mergeModels(models).scenes.map((s) => s.title)).toEqual(['a1', 'a2', 'b1', 'u1'])
  })

  it('carries on from a branching book that only loops, where no scene is an end', () => {
    // a → b → a, and Ana dies in b: nothing ends the book, but a reader who reached the second book got through it
    const f4 = story(
      [
        { key: 'a', book: 'one', ch: 'c1', pov: 'ana', choices: [['go', 'b']] },
        { key: 'b', book: 'one', ch: 'c2', pov: 'ana', changes: [die], choices: [['back', 'a']] },
        { key: 'n', book: 'two', ch: 'c1', pov: 'bob', add: ['ana'] },
      ],
      { mode: 'branching', start: 'a', names },
    )
    expect(f4.models[0]!.graph!.edges.filter((e) => !e.broken)).toHaveLength(2)
    const found = continuityFindings(f4.models[1]!).filter((x) => x.check === 'appears-after-exit')
    expect(found.map((x) => [x.scene, x.paths])).toEqual([[id.scn('n'), 'some']])
  })
})
