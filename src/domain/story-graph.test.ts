// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { sampleId } from '@/sample/ids'
import { bookIdOf, scn, storyBook, type SceneSpec } from '../../tests/helpers/story-fixture'
import {
  fingerprintOf,
  playBack,
  playChoose,
  playJump,
  playStart,
  splitFindings,
  storyFindings,
  storyGraph,
  storySummary,
} from './story-graph'

type Choices = [string, string][]
const gone = sampleId('scn', 'gone')

const graphOf = (scenes: SceneSpec[], opts?: Parameters<typeof storyBook>[1]) => {
  const data = storyBook(scenes, opts)
  return storyGraph(data, bookIdOf(data))
}
/** "check:scenes named in the finding", e.g. "dead-end:Lose". */
const checks = (scenes: SceneSpec[], opts?: Parameters<typeof storyBook>[1]) =>
  storyFindings(graphOf(scenes, opts)).map(
    (f) =>
      `${f.check}:${f.title === 'No ending' ? '*' : [...f.body.matchAll(/“([^”]+)”/g)].map((m) => m[1]).join('/')}`,
  )

/** A clean story: a start, a fork, two ways to two endings. */
const CLEAN: SceneSpec[] = [
  {
    key: 'Start',
    choices: [
      ['Left', 'Left'],
      ['Right', 'Right'],
    ],
  },
  { key: 'Left', choices: [['On', 'Win']] },
  { key: 'Right', choices: [['On', 'Lose']] },
  { key: 'Win', ending: true },
  { key: 'Lose', ending: true },
]

describe('the story graph', () => {
  it('starts at book.start, else at the first scene', () => {
    expect(graphOf(CLEAN).start).toBe(scn('Start'))
    expect(graphOf(CLEAN, { start: 'Left' }).start).toBe(scn('Left'))
    // a start that is not a scene of the book is not believed
    const odd = storyBook(CLEAN)
    odd.books[0]!.start = gone
    expect(storyGraph(odd, bookIdOf(odd)).start).toBe(scn('Start'))
  })

  it('knows what is reachable, what can end, and how many ways lead in', () => {
    const g = graphOf([...CLEAN, { key: 'Island', choices: [['Swim', 'Win']] }])
    expect([...g.reachable].sort()).toEqual(
      ['Left', 'Lose', 'Right', 'Start', 'Win'].map(scn).sort(),
    )
    expect(g.waysIn.get(scn('Win'))).toBe(2)
    expect(g.canEnd.has(scn('Island'))).toBe(true)
    expect(storySummary(g)).toEqual({ scenes: 6, choices: 5, endings: 2, endingsReachable: 2 })
  })

  it('a choice into a scene of another book is no way in and reaches nothing', () => {
    const data = storyBook([
      { key: 'Start', choices: [['Away', 'Elsewhere']] },
      { key: 'End', ending: true },
    ])
    const elsewhere = sampleId('scn', 'Elsewhere')
    data.scenes.push({
      meta: {
        ...data.scenes[1]!.meta,
        id: elsewhere,
        chapter: sampleId('chp', 'other'),
        ending: undefined,
      },
      body: '',
      words: 0,
      book: 'bok_other00000',
    })
    const g = storyGraph(data, bookIdOf(data))
    expect(g.waysIn.get(elsewhere)).toBeUndefined()
    expect(g.reachable.has(elsewhere)).toBe(false)
    expect(g.reachable.has(scn('End'))).toBe(false) // the only choice leaves the book
    expect(g.edges[0]!.broken).toBe('other-book')
  })

  it('a linear book (no choices, no endings) has a graph, and the story map hides itself', () => {
    const g = graphOf([{ key: 'A' }, { key: 'B' }], { mode: 'linear' })
    expect(g.edges).toEqual([])
    expect(g.start).toBe(scn('A'))
  })
})

describe('the checks', () => {
  it('raise nothing on a clean story', () => {
    expect(checks(CLEAN)).toEqual([])
  })

  it('a dead end: no choices and not an ending', () => {
    const scenes = CLEAN.map((s) => (s.key === 'Lose' ? { key: 'Lose' } : s))
    expect(checks(scenes)).toEqual(['dead-end:Lose'])
    expect(storyFindings(graphOf(scenes))[0]).toMatchObject({
      severity: 'warning',
      fix: 'mark-ending',
    })
  })

  it('unreachable: no path from the start (a scene that points into the story is still unreachable)', () => {
    expect(checks([...CLEAN, { key: 'Cove', choices: [['Out', 'Win']] }])).toEqual([
      'unreachable:Cove',
    ])
  })

  it('a broken choice, to a deleted scene or to a scene of another book, is an Error and comes first', () => {
    const scenes: SceneSpec[] = [
      {
        key: 'Start',
        choices: [
          ['Ring bell', gone],
          ['On', 'End'],
        ],
      },
      { key: 'End', ending: true },
    ]
    const [f] = storyFindings(graphOf(scenes))
    expect(f).toMatchObject({ check: 'broken-choice', severity: 'error', scene: scn('Start') })
    expect(f!.body).toBe('“Ring bell” in “Start” points to a scene that is not there any more.')

    const data = storyBook(scenes)
    const elsewhere = sampleId('scn', 'elsewhere')
    data.scenes.push({
      meta: { ...data.scenes[1]!.meta, id: elsewhere, chapter: sampleId('chp', 'other') },
      body: '',
      words: 0,
      book: 'bok_other00000',
    })
    data.scenes[0]!.meta.choices![0]!.target = elsewhere
    expect(storyFindings(storyGraph(data, bookIdOf(data)))[0]!.body).toContain(
      'a scene in another book',
    )

    // errors sort before warnings whatever the order of the scenes
    const mixed: SceneSpec[] = [
      { key: 'A', choices: [['x', 'B']] as Choices },
      { key: 'B' },
      { key: 'C', choices: [['y', gone]] as Choices },
    ]
    expect(storyFindings(graphOf(mixed)).map((x) => x.severity)).toEqual([
      'error',
      'warning',
      'warning',
      'warning',
    ])
  })

  it('no ending reachable from here: a loop with no way out, named for each scene that has choices', () => {
    const scenes: SceneSpec[] = [
      {
        key: 'Start',
        choices: [
          ['In', 'Loop A'],
          ['Out', 'End'],
        ],
      },
      { key: 'Loop A', choices: [['Again', 'Loop B']] },
      { key: 'Loop B', choices: [['Again', 'Loop A']] },
      { key: 'End', ending: true },
    ]
    expect(checks(scenes)).toEqual(['no-ending:Loop A', 'no-ending:Loop B'])
  })

  it('a loop that can still be left raises nothing, and neither does a hub', () => {
    const scenes: SceneSpec[] = [
      {
        key: 'Hub',
        choices: [
          ['Room 1', 'Room 1'],
          ['Room 2', 'Room 2'],
          ['Leave', 'End'],
        ],
      },
      { key: 'Room 1', choices: [['Back', 'Hub']] },
      {
        key: 'Room 2',
        choices: [
          ['Back', 'Hub'],
          ['Stay', 'Room 2'],
        ],
      },
      { key: 'End', ending: true },
    ]
    expect(checks(scenes)).toEqual([])
    expect(graphOf(scenes).waysIn.get(scn('Hub'))).toBe(2)
  })

  it('with no ending anywhere, one finding says so instead of one per scene', () => {
    const scenes: SceneSpec[] = [
      { key: 'A', choices: [['x', 'B']] },
      { key: 'B', choices: [['y', 'A']] },
    ]
    expect(checks(scenes)).toEqual(['no-ending:*'])
  })

  it('a dead end is not also told it has no ending', () => {
    const scenes: SceneSpec[] = [
      { key: 'Start', choices: [['x', 'End']] },
      { key: 'End', ending: true },
      { key: 'Lost' },
    ]
    expect(checks(scenes)).toEqual(['dead-end:Lost', 'unreachable:Lost'])
  })
})

describe('dismissed findings', () => {
  const scenes: SceneSpec[] = [
    { key: 'Start', choices: [['x', 'End']] },
    { key: 'End', ending: true },
    { key: 'Lost' },
  ]

  it('an Error is never set aside, and a broken choice’s fingerprint names where it points, so a new broken choice is a new finding', () => {
    const broken = (to: string): SceneSpec[] => [
      { key: 'Start', choices: [['Ring', sampleId('scn', to)]] },
      { key: 'End', ending: true },
    ]
    const [one] = storyFindings(graphOf(broken('gone-1')))
    const [two] = storyFindings(graphOf(broken('gone-2')))
    expect(one!.fingerprint).not.toBe(two!.fingerprint)
    const split = splitFindings([one!], [one!.fingerprint])
    expect(split.active).toEqual([one])
    expect(split.dismissed).toEqual([])
  })

  it('the book-level "No ending" is mended by adding a choice or marking an ending, never by marking the start', () => {
    const [f] = storyFindings(
      graphOf([
        { key: 'A', choices: [['x', 'B']] },
        { key: 'B', choices: [['y', 'A']] },
      ]),
    )
    expect(f!.fix).toBe('add-choice')
  })

  it('are hidden by fingerprint, and the others stay', () => {
    const found = storyFindings(graphOf(scenes))
    expect(found.map((f) => f.fingerprint)).toEqual([
      `dead-end:${scn('Lost')}`,
      `unreachable:${scn('Lost')}`,
    ])
    const { active, dismissed } = splitFindings(found, [found[0]!.fingerprint, 'something-old'])
    expect(active.map((f) => f.check)).toEqual(['unreachable'])
    expect(dismissed.map((f) => f.check)).toEqual(['dead-end'])
  })

  it('a fingerprint names the check and its subjects in sorted order', () => {
    expect(fingerprintOf('broken-choice', 'scn_b', 'chc_a')).toBe('broken-choice:chc_a,scn_b')
    expect(fingerprintOf('dead-end', 'scn_a')).toBe('dead-end:scn_a')
  })

  it('a fingerprint does not move when the scene does', () => {
    const [a] = storyFindings(graphOf(scenes))
    const moved = storyBook([...scenes].reverse())
    expect(storyFindings(storyGraph(moved, bookIdOf(moved))).map((f) => f.fingerprint)).toContain(
      a!.fingerprint,
    )
  })
})

describe('play', () => {
  const g = graphOf([...CLEAN, { key: 'Ghost', choices: [['bad', gone]] }])

  it('starts at the start, follows a choice, goes back and jumps', () => {
    let path = playStart(g)
    expect(path).toEqual([scn('Start')])
    path = playChoose(g, path, g.nodes.get(scn('Start'))!.choices[0]!.id)
    path = playChoose(g, path, g.nodes.get(scn('Left'))!.choices[0]!.id)
    expect(path).toEqual([scn('Start'), scn('Left'), scn('Win')])
    expect(playBack(path)).toEqual([scn('Start'), scn('Left')])
    expect(playJump(path, 0)).toEqual([scn('Start')])
    expect(playBack([scn('Start')])).toEqual([scn('Start')]) // the start is where it ends
  })

  it('does not follow a choice that is not there, or one that is broken', () => {
    const path = [scn('Ghost')]
    expect(playChoose(g, path, g.nodes.get(scn('Ghost'))!.choices[0]!.id)).toBe(path)
    expect(playChoose(g, [scn('Start')], 'chc_zzzzzzzzzz')).toEqual([scn('Start')])
  })

  it('a loop can be walked again and again', () => {
    const loop = graphOf([{ key: 'A', choices: [['again', 'A']] }])
    let path = playStart(loop)
    for (let i = 0; i < 3; i++)
      path = playChoose(loop, path, loop.nodes.get(scn('A'))!.choices[0]!.id)
    expect(path).toHaveLength(4)
  })
})
