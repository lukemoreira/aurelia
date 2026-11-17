// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { id, story, type Sc } from '../../tests/helpers/continuity-fixture'
import type { ContinuityModel } from './continuity'
import { stateRows } from './continuity-views'
import { progression, showsOn } from './progression'

const ana = id.chr('ana')
const bob = id.chr('bob')
const names = { characters: ['ana', 'bob'], arcs: ['debt'], places: ['gate'] }

/** What a person's state at a scene says, as label → the words under it. */
const at = (m: ContinuityModel, scene: string, who = ana) =>
  Object.fromEntries(
    stateRows(m, id.scn(scene), who).map((r) => [r.label, r.items.map((i) => i.text)]),
  )

const straight: Sc[] = [
  {
    key: 'a',
    ch: 'c1',
    pov: 'ana',
    changes: [{ who: 'ana', kind: 'goal', value: 'Find the key' }],
  },
  {
    key: 'b',
    ch: 'c2',
    pov: 'ana',
    add: ['bob'],
    changes: [
      { who: 'ana', kind: 'condition', value: 'Injured — left hand' },
      { who: 'bob', kind: 'relation', with: 'ana', value: 'stranger → creditor' },
      { who: 'debt', kind: 'beat', value: 'The debt is called in' },
      { kind: 'setup', id: 's1', value: 'The key' },
    ],
  },
  { key: 'c', ch: 'c3', pov: 'bob', named: ['bob'] },
  {
    key: 'd',
    ch: 'c3',
    add: ['ana'],
    changes: [
      { who: 'ana', kind: 'knows', value: 'Her mother is alive' },
      { who: 'ana', kind: 'condition', value: '' },
    ],
  },
  {
    key: 'e',
    ch: 'c4',
    pov: 'bob',
    named: ['bob'],
    changes: [{ who: 'ana', kind: 'status', value: 'gone' }],
  },
]

describe('a character’s state at every scene of a straight book', () => {
  const { m } = story(straight, { names })

  it('builds up scene by scene, in reading order', () => {
    expect(at(m, 'a')).toEqual({ Status: ['Alive'], Goal: ['Find the key'] })
    expect(at(m, 'b')).toEqual({
      Status: ['Alive'],
      Condition: ['Injured — left hand'],
      Goal: ['Find the key'],
    })
    expect(at(m, 'c')).toEqual(at(m, 'b')) // a scene without her changes nothing for her
    // a condition cleared by an empty value, something learned, a goal kept
    expect(at(m, 'd')).toEqual({
      Status: ['Alive'],
      Goal: ['Find the key'],
      'Has learned': ['Her mother is alive'],
    })
    expect(at(m, 'e').Status).toEqual(['Has left'])
  })

  it('says since which scene a fact holds', () => {
    const goal = stateRows(m, id.scn('e'), ana).find((r) => r.label === 'Goal')!
    expect(goal.items).toEqual([{ text: 'Find the key', since: '1.1', some: false }])
  })

  it('lists every change about them in reading order, and none that are about the story', () => {
    const { log } = progression(m, ana)
    expect(log.map((e) => [e.ref, e.kind, e.text])).toEqual([
      ['1.1', 'Goal', 'ana now wants: Find the key'],
      ['2.1', 'Condition', 'ana: Injured — left hand'],
      // another person's relationship that points at her is about her too
      ['2.1', 'Relationship', 'bob sees ana as creditor (was: stranger)'],
      ['3.2', 'Learns', 'ana learns: Her mother is alive'],
      ['3.2', 'Condition', 'ana: '],
      ['4.1', 'Status', 'ana leaves the story'],
    ])
    expect(log.map((e) => e.at)).toEqual([...log.map((e) => e.at)].sort((x, y) => x - y))
    // the arc's beat and the set-up are about the story, not about her or Bob
    expect(progression(m, bob).log.map((e) => e.kind)).toEqual(['Relationship'])
  })

  it('says per chapter how much of it they are on the page for, and whose eyes it is told through', () => {
    const p = progression(m, ana)
    expect(p.chapters.map((c) => [c.label, c.scenes, c.words, c.pov, c.changes])).toEqual([
      ['Chapter 1', 1, 100, true, 1],
      ['Chapter 2', 1, 100, true, 2],
      ['Chapter 3', 1, 100, false, 2], // on the page in the second scene only
      ['Chapter 4', 0, 0, false, 1], // a change while she is off the page still counts
    ])
    expect(p.chapters[2]!.text).toBe('1 scene, 100 words, 2 changes')
    expect(p.chapters[3]!.text).toBe('Not on the page, 1 change')
    expect(p.chapters[0]!.text).toBe('1 scene, 100 words, point of view, 1 change')
  })

  it('puts the scrubber on the last scene they are on the page in', () => {
    const p = progression(m, ana)
    expect(p.start).toBe(3)
    expect(p.scenes.map((s) => s.present)).toEqual([true, true, false, true, false])
    // nobody to follow: it rests at the end
    expect(progression(m, id.chr('nobody')).start).toBe(4)
  })
})

describe('a character’s state in a branching book says on which paths', () => {
  // start → left | right → end. Only the left path hurts her.
  const { m } = story(
    [
      {
        key: 's',
        ch: 'c1',
        pov: 'ana',
        choices: [
          ['left', 'l'],
          ['right', 'r'],
        ],
      },
      {
        key: 'l',
        ch: 'c2',
        pov: 'ana',
        changes: [{ who: 'ana', kind: 'condition', value: 'Hurt' }],
        choices: [['on', 'z']],
      },
      { key: 'r', ch: 'c3', pov: 'ana', choices: [['on', 'z']] },
      { key: 'z', ch: 'c4', pov: 'ana', ending: true },
    ],
    { mode: 'branching', start: 's', names },
  )
  const cond = (scene: string) =>
    stateRows(m, id.scn(scene), ana).find((r) => r.label === 'Condition')?.items

  it('every path where it holds on all of them, some paths where only one way leads to it', () => {
    expect(cond('s')).toBeUndefined()
    expect(cond('l')).toEqual([{ text: 'Hurt', since: '2.1', some: false }])
    expect(cond('r')).toBeUndefined()
    expect(cond('z')).toEqual([{ text: 'Hurt', since: '2.1', some: true }])
  })

  it('does not change what the chapter table or the log say', () => {
    const p = progression(m, ana)
    expect(p.log.map((e) => e.ref)).toEqual(['2.1'])
    expect(p.chapters.map((c) => c.scenes)).toEqual([1, 1, 1, 1])
  })
})

describe('whose progression a change shows on', () => {
  const person = (x: string) => x === ana || x === bob
  const name = (x: string) => (x === ana ? 'Elena Vasquez' : x === bob ? 'Tomas Brandt' : '?')
  it('says it in first names, for a relationship on both sheets', () => {
    expect(showsOn({ kind: 'relation', who: bob, with: ana, value: 'x' }, name, person)).toBe(
      'Shows on Tomas Brandt’s and Elena Vasquez’s progression.',
    )
    expect(showsOn({ kind: 'knows', who: ana, value: 'x' }, name, person)).toBe(
      'Shows on Elena Vasquez’s progression.',
    )
  })
  it('uses the whole name, so "The Warden" is not "The"', () => {
    const warden = id.chr('warden')
    expect(
      showsOn(
        { kind: 'knows', who: warden, value: 'x' },
        () => 'The Warden',
        (x) => x === warden,
      ),
    ).toBe('Shows on The Warden’s progression.')
  })
  it('says nothing for an arc, a set-up, a pay-off, or before anyone is picked', () => {
    expect(showsOn({ kind: 'beat', who: id.arc('debt'), value: 'x' }, name, person)).toBe('')
    expect(showsOn({ kind: 'setup', value: 'x' }, name, person)).toBe('')
    expect(showsOn({ kind: 'payoff', of: id.stp('s1') }, name, person)).toBe('')
    expect(showsOn({ kind: 'knows', who: '', value: 'x' }, name, person)).toBe('')
    expect(showsOn({ kind: 'relation', who: ana, with: '', value: 'x' }, name, person)).toBe(
      'Shows on Elena Vasquez’s progression.',
    )
  })
})
