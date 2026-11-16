// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { arc, bok } from '@/sample/saltmarch-ids'
import { saltmarchSample } from '@/sample/saltmarch'
import { sampleId } from '@/sample/ids'
import { arcBeats, arcsFor, arcsInUse, planParts, planRows } from './plan'
import { bookIdOf, storyBook } from '../../tests/helpers/story-fixture'

const data = saltmarchSample()

describe('the plan of a book', () => {
  const parts = planParts(data, bok.lantern)

  it('lists parts, chapters and scenes with what a row or card shows', () => {
    expect(parts.map((p) => p.title)).toEqual(['Part One · Low Tide', 'Part Two · Slack Water'])
    const chapters = parts[0]!.chapters
    expect(chapters.map((c) => c.number)).toEqual([5, 6, 7, 8])
    const ledger = chapters[0]!.scenes[0]!
    expect(ledger).toMatchObject({
      title: 'Salt in the Ledger',
      ref: '5.1',
      status: 'revised',
      words: 1420,
      pov: { name: 'Elena Vasquez', colour: 'var(--ember)' },
      arcs: [{ name: 'The Debt', colour: 'var(--ember)' }],
      findings: 0,
    })
  })

  it('flattens to rows in reading order, a part before its chapters and a chapter before its scenes', () => {
    const rows = planRows(parts)
    expect(rows.slice(0, 3).map((r) => r.kind)).toEqual(['part', 'chapter', 'scene'])
    expect(rows.filter((r) => r.kind === 'scene')).toHaveLength(11)
  })

  it('names the arcs in use, once each', () => {
    expect(arcsInUse(parts).map((a) => a.name)).toEqual(['Rising Tide', 'The Debt', 'The Letters'])
  })
})

describe('arcs as threads', () => {
  it('a book offers the arcs of its universe', () => {
    expect(arcsFor(data, bok.saltash).map((a) => a.name)).toEqual([
      'Rising Tide',
      'The Debt',
      'The Letters',
    ])
    // a standalone book of another universe offers none of them
    expect(arcsFor(data, bok.winter)).toEqual([])
  })

  it('lists the scenes that advance an arc, book by book in the universe’s order', () => {
    const beats = arcBeats(data, arc.tide)
    expect(beats.map((b) => b.book.title)).toEqual(['The Lantern Gate', 'Tidebound', 'Salt & Ash'])
    expect(beats[0]!.beats.map((b) => [b.ref, b.title])).toEqual([
      ['5.3', 'Low Water'],
      ['6.3', 'The Customs House'],
      ['7.1', 'Tide Bell'],
      ['7.2', 'Curfew Bells'],
    ])
    expect(beats[2]!.beats.map((b) => b.title)).toEqual([
      'Washed Ashore',
      'Low Tide Road',
      'Taken by the Tide',
    ])
  })

  it('leaves out a book that has none, and answers nothing for an arc that is not there', () => {
    expect(arcBeats(data, arc.debt).map((b) => b.book.title)).toEqual(['The Lantern Gate'])
    expect(arcBeats(data, sampleId('arc', 'nothing'))).toEqual([])
  })
})

describe('findings on cards', () => {
  it('count the open findings of a branching book, and not the dismissed ones', () => {
    const scenes = [
      { key: 'Start', choices: [['x', 'End']] as [string, string][] },
      { key: 'End', ending: true },
      { key: 'Lost' },
    ]
    const open = storyBook(scenes)
    const lost = planParts(open, bookIdOf(open))[0]!.chapters[0]!.scenes.find(
      (s) => s.title === 'Lost',
    )!
    expect(lost.findings).toBe(2)
    const some = storyBook(scenes, { dismissed: [`dead-end:${lost.id}`] })
    expect(planParts(some, bookIdOf(some))[0]!.chapters[0]!.scenes[2]!.findings).toBe(1)
  })

  it('a linear book has none to show', () => {
    const linear = storyBook([{ key: 'A' }, { key: 'B' }], { mode: 'linear' })
    expect(
      planParts(linear, bookIdOf(linear))[0]!.chapters[0]!.scenes.map((s) => s.findings),
    ).toEqual([0, 0])
  })
})
