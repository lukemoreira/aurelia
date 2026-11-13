// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import {
  chapterPath,
  classify,
  conflictedCopyOf,
  conflictsPathFor,
  copyPathFor,
  scenePath,
} from './paths'

describe('classify', () => {
  it('tells every kind of workspace file by where it sits', () => {
    expect(classify('universes/unv_a1/universe.md')).toEqual({
      kind: 'universe',
      universe: 'unv_a1',
    })
    expect(classify('universes/unv_a1/books/bok_b2/book.json')).toEqual({
      kind: 'book',
      universe: 'unv_a1',
      book: 'bok_b2',
    })
    expect(classify(scenePath('unv_a1', 'bok_b2', 'scn_c3'))).toEqual({
      kind: 'scene',
      universe: 'unv_a1',
      book: 'bok_b2',
    })
    expect(classify(chapterPath('unv_a1', 'bok_b2', 'chp_d4'))).toEqual({
      kind: 'chapter',
      universe: 'unv_a1',
      book: 'bok_b2',
    })
    expect(classify('universes/unv_a1/books/bok_b2/parts/prt_e5.md').kind).toBe('part')
    expect(classify('universes/unv_a1/records/characters/chr_f6.md')).toEqual({
      kind: 'record',
      universe: 'unv_a1',
    })
    expect(classify('universes/unv_a1/books/bok_b2/records/places/plc_g7.md').kind).toBe('record')
  })

  it('knows the derived outline of a book: read for its hash, never as content', () => {
    expect(classify('universes/unv_a1/books/bok_b2/OUTLINE.md')).toEqual({
      kind: 'outline',
      universe: 'unv_a1',
      book: 'bok_b2',
    })
  })

  it('leaves everything else alone', () => {
    for (const p of ['README.md', 'universes/unv_a1/media/med_x.png', 'notes/todo.md'])
      expect(classify(p).kind).toBe('other')
  })
})

describe('conflicted copies', () => {
  it('finds the file each sync tool’s copy came from', () => {
    const cases: [string, string][] = [
      ['scenes/scn_a (conflicted copy).md', 'scenes/scn_a.md'],
      ['scenes/scn_a (Ann’s conflicted copy 2026-11-12).md', 'scenes/scn_a.md'],
      ['book.json (conflicted copy)', 'book.json'],
      [
        'universes/u/books/b/book.json (conflicted copy 2026-01-01 120000)',
        'universes/u/books/b/book.json',
      ],
      ['scenes/scn_a.sync-conflict-20261112-153045-ABCDEF7.md', 'scenes/scn_a.md'],
      ['scenes/scn_a (Aurelia copy).md', 'scenes/scn_a.md'],
      ['scenes/scn_a (Aurelia copy 3).md', 'scenes/scn_a.md'],
    ]
    for (const [copy, original] of cases) expect(conflictedCopyOf(copy), copy).toBe(original)
  })

  it('does not take an ordinary file for a copy', () => {
    for (const p of [
      'scenes/scn_a.md',
      'aurelia.json',
      'scenes/copy of the plan.md',
      'scenes/scn_a (1).md',
    ])
      expect(conflictedCopyOf(p), p).toBeNull()
  })

  it('names Aurelia’s own copies so that they are found like any other', () => {
    expect(copyPathFor('scenes/scn_a.md')).toBe('scenes/scn_a (Aurelia copy).md')
    expect(copyPathFor('scenes/scn_a.md', 2)).toBe('scenes/scn_a (Aurelia copy 2).md')
    expect(copyPathFor('book.json', 1)).toBe('book (Aurelia copy).json')
    expect(conflictedCopyOf(copyPathFor('scenes/scn_a.md', 4))).toBe('scenes/scn_a.md')
    expect(conflictedCopyOf(copyPathFor('book.json'))).toBe('book.json')
  })

  it('sets a file aside under .aurelia/conflicts, keeping its path', () => {
    expect(conflictsPathFor('scenes/scn_a.md', new Date('2026-11-12T10:20:30.456Z'))).toBe(
      '.aurelia/conflicts/2026-11-12T10-20-30-456Z/scenes/scn_a.md',
    )
  })
})
