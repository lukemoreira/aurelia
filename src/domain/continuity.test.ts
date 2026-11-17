// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { id, story, type Sc } from '../../tests/helpers/continuity-fixture'
import { join, personState, runFlow, statusFacts, transfer, type State } from './continuity-state'
import { stateAt } from './continuity'

const ana = id.chr('ana')
const names = { characters: ['ana', 'bob'], items: ['key'], places: ['gate', 'quay'] }
const die = (who: string) => ({ who, kind: 'status', value: 'dead' })
const statusOf = (s: State | undefined, who = ana) =>
  statusFacts(s!, who).map((f) => f.value || 'alive')

describe('the state of a straight book', () => {
  const { m } = story(
    [
      {
        key: 'a',
        ch: 'c1',
        pov: 'ana',
        changes: [{ who: 'ana', kind: 'condition', value: 'Injured — left hand' }],
      },
      {
        key: 'b',
        ch: 'c2',
        pov: 'ana',
        changes: [{ who: 'ana', kind: 'knows', value: 'Her mother is alive' }],
      },
      { key: 'c', ch: 'c3', pov: 'ana', changes: [die('ana')] },
    ],
    { names },
  )
  const at = (k: string) => stateAt(m, id.scn(k))!

  it('folds the changes in reading order, each scene’s own included in the state it leaves', () => {
    expect(personState(at('a'), ana).condition.map((l) => l.text)).toEqual(['Injured — left hand'])
    expect(personState(at('a'), ana).knows).toEqual([])
    expect(personState(at('b'), ana).knows.map((l) => l.text)).toEqual(['Her mother is alive'])
    expect(personState(at('b'), ana).condition).toHaveLength(1) // carried on from the scene before
    expect(statusOf(at('c'))).toEqual(['dead'])
    expect(statusOf(at('b'))).toEqual(['alive'])
  })

  it('remembers which scene made it so', () => {
    expect(personState(at('c'), ana).knows[0]!.since).toBe(id.scn('b'))
    expect(personState(at('c'), ana).status[0]!.since).toBe(id.scn('c'))
  })

  it('starts a scene from what the scene before left, before its own changes', () => {
    expect(statusOf(m.flow.before.get(id.scn('c')))).toEqual(['alive'])
  })

  it('takes a condition away when it is cleared, and an item from one hand to another', () => {
    const t = story(
      [
        {
          key: 'a',
          changes: [
            { who: 'ana', kind: 'condition', value: 'Injured' },
            { who: 'ana', kind: 'holds', item: 'key' },
          ],
        },
        {
          key: 'b',
          changes: [
            { who: 'ana', kind: 'condition', value: '' },
            { who: 'ana', kind: 'loses', item: 'key' },
            { who: 'bob', kind: 'holds', item: 'key' },
          ],
        },
      ],
      { names },
    ).m
    const last = stateAt(t, id.scn('b'))!
    expect(personState(last, ana).condition).toEqual([])
    expect(personState(last, ana).holds).toEqual([])
    expect(personState(last, id.chr('bob')).holds.map((l) => l.text)).toEqual([id.itm('key')])
  })

  it('reads a relationship as what it is now, and keeps changes it does not know', () => {
    const t = story(
      [
        {
          key: 'a',
          changes: [
            { who: 'ana', kind: 'relation', with: 'bob', value: 'stranger → creditor' },
            { who: 'ana', kind: 'mystery', value: 'x' },
          ],
        },
        {
          key: 'b',
          changes: [{ who: 'ana', kind: 'relation', with: 'bob', value: 'creditor → uneasy ally' }],
        },
      ],
      { names },
    ).m
    expect(personState(stateAt(t, id.scn('a'))!, ana).relations[0]!.lines[0]!.text).toBe('creditor')
    expect(personState(stateAt(t, id.scn('b'))!, ana).relations[0]!.lines[0]!.text).toBe(
      'uneasy ally',
    )
  })
})

describe('the state of a branching book: a fixed point over the scene graph', () => {
  const branching = (scenes: Sc[], start = scenes[0]!.key) =>
    story(scenes, { mode: 'branching', start, names })

  it('joins what reaches a scene from every way in: "on every path" and "on some paths"', () => {
    // start → left | right → end. Only the left way kills ana.
    const { m } = branching([
      {
        key: 'start',
        choices: [
          ['left', 'left'],
          ['right', 'right'],
        ],
      },
      { key: 'left', choices: [['on', 'end']], changes: [die('ana')] },
      { key: 'right', choices: [['on', 'end']] },
      { key: 'end', ending: true },
    ])
    const facts = statusFacts(stateAt(m, id.scn('end'))!, ana)
    expect(facts.map((f) => f.value).sort()).toEqual(['', 'dead'])
    expect(personState(stateAt(m, id.scn('end'))!, ana).status.every((l) => !l.every)).toBe(true)
    expect(personState(stateAt(m, id.scn('left'))!, ana).status[0]!.every).toBe(true)
    // and when both ways kill her, it holds on every path
    const both = branching([
      {
        key: 'start',
        choices: [
          ['left', 'left'],
          ['right', 'right'],
        ],
      },
      { key: 'left', choices: [['on', 'end']], changes: [die('ana')] },
      { key: 'right', choices: [['on', 'end']], changes: [die('ana')] },
      { key: 'end', ending: true },
    ]).m
    expect(personState(stateAt(both, id.scn('end'))!, ana).status).toMatchObject([
      { text: 'dead', every: true },
    ])
  })

  it('settles on a loop and a hub: what can have happened by the hub is what happened on the way in or on any lap', () => {
    // start → hub; hub → lap | exit; lap → hub. The lap teaches ana a secret.
    const { m } = branching([
      { key: 'start', choices: [['go', 'hub']] },
      {
        key: 'hub',
        choices: [
          ['again', 'lap'],
          ['leave', 'exit'],
        ],
      },
      {
        key: 'lap',
        choices: [['back', 'hub']],
        changes: [{ who: 'ana', kind: 'knows', value: 'the secret' }],
      },
      { key: 'exit', ending: true },
    ])
    const knows = (k: string) => personState(stateAt(m, id.scn(k))!, ana).knows
    expect(knows('start')).toEqual([])
    expect(knows('lap')).toMatchObject([{ text: 'the secret', every: true }]) // every path to the end of the lap
    expect(knows('hub')).toMatchObject([{ text: 'the secret', every: false }]) // first visit: not yet; later visits: yes
    expect(knows('exit')).toMatchObject([{ text: 'the secret', every: false }])
    expect(m.flow.before.get(id.scn('hub'))).toBeDefined()
  })

  it('answers "every path" through a hub that every way passes, even on a loop', () => {
    // The death is before the hub, so no lap can undo it.
    const { m } = branching([
      { key: 'start', changes: [die('ana')], choices: [['go', 'hub']] },
      {
        key: 'hub',
        choices: [
          ['again', 'lap'],
          ['leave', 'exit'],
        ],
      },
      { key: 'lap', choices: [['back', 'hub']] },
      { key: 'exit', ending: true },
    ])
    for (const k of ['hub', 'lap', 'exit'])
      expect(personState(stateAt(m, id.scn(k))!, ana).status).toMatchObject([
        { text: 'dead', every: true },
      ])
  })

  it('lets two people hold an item on a loop only on the laps where they took it', () => {
    const { m } = branching([
      {
        key: 'start',
        choices: [['go', 'hub']],
        changes: [{ who: 'ana', kind: 'holds', item: 'key' }],
      },
      {
        key: 'hub',
        choices: [
          ['steal', 'lap'],
          ['leave', 'exit'],
        ],
      },
      {
        key: 'lap',
        choices: [['back', 'hub']],
        changes: [{ who: 'bob', kind: 'holds', item: 'key' }],
      },
      { key: 'exit', ending: true },
    ])
    const holders = (k: string) => {
      const s = stateAt(m, id.scn(k))!
      return [personState(s, ana).holds.length, personState(s, id.chr('bob')).holds.length]
    }
    expect(holders('hub')).toEqual([1, 1]) // bob holds it on some paths
    expect(personState(stateAt(m, id.scn('hub'))!, id.chr('bob')).holds[0]!.every).toBe(false)
    expect(personState(stateAt(m, id.scn('lap'))!, id.chr('bob')).holds[0]!.every).toBe(true)
  })

  it('starts a scene nothing leads to from the empty state, so it is still checked', () => {
    const { m } = branching(
      [
        { key: 'start', ending: true },
        { key: 'island', changes: [die('ana')] },
      ],
      'start',
    )
    expect(statusOf(stateAt(m, id.scn('island')))).toEqual(['dead'])
    expect(statusOf(m.flow.before.get(id.scn('island')))).toEqual(['alive'])
  })

  it('ignores a choice that leads nowhere', () => {
    const { m } = branching([
      { key: 'start', choices: [['gone', 'nowhere']], changes: [die('ana')] },
    ])
    expect(statusOf(stateAt(m, id.scn('start')))).toEqual(['dead'])
  })
})

describe('the fold itself', () => {
  it('leaves a state untouched by changes it does not understand, and joins to the same object when nothing differs', () => {
    const empty: State = new Map()
    expect(transfer(empty, 's', [{ kind: 'beat', who: 'arc_x' }, { kind: 'status' }])).toBe(empty)
    expect(join([empty])).toBe(empty)
    const dead = transfer(empty, 's', [{ kind: 'status', who: 'chr_x', value: 'Dead' }])
    expect(join([dead, dead])).toEqual(dead)
  })

  it('stops, on a graph with a cycle that no entry leads into', () => {
    const flow = runFlow({
      order: ['a', 'b'],
      preds: new Map([
        ['a', ['b']],
        ['b', ['a']],
      ]),
      entries: new Set(['a']),
      changes: (s) => [{ kind: 'knows', who: 'chr_x', value: `from ${s}` }],
    })
    expect(flow.after.get('b')).toBeDefined()
    expect([...flow.after.get('a')!.keys()].sort()).toEqual([
      'knows:chr_x:from a',
      'knows:chr_x:from b',
    ])
  })
})
