// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { saltmarchSample } from '@/sample/saltmarch'
import { buildEntries } from './palette-entries'
import { rankByTitle } from './palette-search'

describe('palette entries from the sample', () => {
  const entries = buildEntries(saltmarchSample())
  const find = (kind: string, title: string) =>
    entries.find((e) => e.kind === kind && e.title === title)

  it('has records, scenes, chapters and books with unique keys', () => {
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length)
    expect(find('book', 'Salt & Ash')?.icon).toBe('branch')
    expect(find('chapter', 'The Lantern Gate')?.sub).toBe('Chapter 7 · The Lantern Gate')
    expect(find('scene', 'Curfew Bells')).toMatchObject({
      sub: 'Chapter Seven · Scene 2 · The Lantern Gate',
      hint: 'Draft',
    })
  })

  it('describes a character by scope and counts the scenes they are in', () => {
    const tomas = find('record', 'Tomas Brandt')!
    expect(tomas.sub).toMatch(/^Character · Shared in Saltmarch · Warden/)
    expect(tomas.color).toBe('tide')
    expect(tomas.hint).toBe('3 scenes')
    expect(find('record', 'Lamp boy')?.sub).toMatch(/The Lantern Gate only/)
  })

  it('finds Tomas first by name', () => {
    const hits = rankByTitle(entries, 'tomas')
    expect(hits[0]?.title).toBe('Tomas Brandt')
    expect(hits.map((h) => h.title)).toContain('Tomas’s ledger')
  })
})
