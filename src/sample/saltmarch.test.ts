// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { bookOutline, sceneContext } from '@/domain/outline'
import { validateWorkspaceData } from '@/domain/workspace-data'
import { saltmarchSample, SAMPLE_START } from './saltmarch'

describe('the Saltmarch sample', () => {
  const data = saltmarchSample()

  it('parses with every schema', () => {
    expect(() => validateWorkspaceData(data)).not.toThrow()
  })

  it('gives the same IDs on every load, with no duplicates', () => {
    const again = saltmarchSample()
    expect(again.scenes.map((s) => s.meta.id)).toEqual(data.scenes.map((s) => s.meta.id))
    const ids = [
      ...data.books.map((b) => b.id),
      ...data.chapters.map((c) => c.id),
      ...data.scenes.map((s) => s.meta.id),
      ...data.records.map((r) => r.meta.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('links every object to one that exists', () => {
    const ids = new Set([
      ...data.books.map((b) => b.id),
      ...data.chapters.map((c) => c.id),
      ...data.records.map((r) => r.meta.id),
      ...data.scenes.map((s) => s.meta.id),
    ])
    for (const s of data.scenes) expect(ids.has(s.meta.chapter)).toBe(true)
    for (const c of data.chapters) expect(ids.has(c.book)).toBe(true)
    for (const s of data.scenes)
      for (const c of s.meta.choices ?? []) expect(ids.has(c.target)).toBe(true)
    expect(ids.has(SAMPLE_START.scene)).toBe(true)
  })

  it('has Saltmarch’s three books, one of them branching, and a standalone one', () => {
    expect(data.universes.map((u) => u.kind)).toEqual(['shared', 'standalone'])
    expect(data.books.filter((b) => b.mode === 'branching').map((b) => b.title)).toEqual([
      'Salt & Ash',
    ])
  })

  it('numbers chapters 5 to 8 under Part One and puts Curfew Bells at 7.2', () => {
    const lantern = data.books[0]!
    const outline = bookOutline(data, lantern.id)
    expect(outline[0]!.part?.title).toBe('Part One · Low Tide')
    expect(outline[0]!.chapters.map((c) => c.number)).toEqual([5, 6, 7, 8])
    const ctx = sceneContext(data, SAMPLE_START.scene)!
    expect([ctx.chapter.number, ctx.index, ctx.chapter.scenes.length]).toEqual([7, 2, 3])
  })
})
