// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { sampleId } from '@/sample/ids'
import { saltmarchSample } from '@/sample/saltmarch'
import { bok } from '@/sample/saltmarch-ids'
import { bookIdOf, scn, storyBook, type SceneSpec } from '../../tests/helpers/story-fixture'
import { storyGraph } from './story-graph'
import { layoutStory, nodeInDirection, NODE_H, NODE_W } from './story-layout'

/** The space between two rows of scenes. */
const GAP_ROW = 76

const layoutOf = (scenes: SceneSpec[], opts?: Parameters<typeof storyBook>[1]) => {
  const data = storyBook(scenes, opts)
  return layoutStory(storyGraph(data, bookIdOf(data)))
}
const at = (l: ReturnType<typeof layoutOf>, key: string) => l.byId.get(scn(key))!

const FORK: SceneSpec[] = [
  {
    key: 'Start',
    choices: [
      ['Left', 'Left'],
      ['Right', 'Right'],
    ],
  },
  { key: 'Left', choices: [['On', 'End']] },
  { key: 'Right', choices: [['On', 'End']] },
  { key: 'End', ending: true },
]

/** Every pair of boxes apart from each other. */
function overlaps(l: ReturnType<typeof layoutOf>) {
  const hit: string[] = []
  for (const [i, a] of l.nodes.entries())
    for (const b of l.nodes.slice(i + 1))
      if (a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H)
        hit.push(`${a.id}/${b.id}`)
  return hit
}

describe('the story map layout', () => {
  it('puts the start on top and each scene below the ones that lead to it', () => {
    const l = layoutOf(FORK)
    expect(at(l, 'Start').layer).toBe(0)
    expect([at(l, 'Left').layer, at(l, 'Right').layer]).toEqual([1, 1])
    expect(at(l, 'End').layer).toBe(2)
    expect(at(l, 'End').y).toBeGreaterThan(at(l, 'Left').y)
    expect(overlaps(l)).toEqual([])
  })

  it('is the same every time', () => {
    expect(layoutOf(FORK)).toEqual(layoutOf(FORK))
  })

  it('a choice that goes back is a loop: drawn round the side, and nothing hangs', () => {
    const l = layoutOf([
      { key: 'A', choices: [['on', 'B']] },
      {
        key: 'B',
        choices: [
          ['again', 'A'],
          ['stay', 'B'],
          ['out', 'C'],
        ],
      },
      { key: 'C', ending: true },
    ])
    expect(l.edges.filter((e) => e.back).map((e) => e.label)).toEqual(['again', 'stay'])
    expect([at(l, 'A').layer, at(l, 'B').layer, at(l, 'C').layer]).toEqual([0, 1, 2])
    expect(l.edges.every((e) => e.d.startsWith('M '))).toBe(true)
  })

  it('a hub with several ways in sits below all of them', () => {
    const l = layoutOf([
      {
        key: 'Start',
        choices: [
          ['a', 'A'],
          ['b', 'B'],
        ],
      },
      { key: 'A', choices: [['hub', 'Hub']] },
      { key: 'B', choices: [['on', 'B2']] },
      { key: 'B2', choices: [['hub', 'Hub']] },
      { key: 'Hub', ending: true },
    ])
    expect(at(l, 'Hub').layer).toBe(3)
    expect(overlaps(l)).toEqual([])
  })

  it('scenes no path reaches sit in a band under the story, and do not move it', () => {
    const base = layoutOf(FORK)
    const l = layoutOf([...FORK, { key: 'Cove', choices: [['out', 'End']] }])
    expect(at(l, 'Cove').layer).toBeGreaterThan(at(l, 'End').layer)
    expect(at(l, 'End').layer).toBe(at(base, 'End').layer)
    expect(overlaps(l)).toEqual([])
  })

  it('a broken choice ends in a ghost node under its scene', () => {
    const l = layoutOf([{ key: 'Start', choices: [['Ring bell', sampleId('scn', 'gone')]] }])
    const ghost = l.nodes.find((n) => n.ghost)!
    expect(ghost.layer).toBe(1)
    expect(l.edges[0]).toMatchObject({ broken: true, to: ghost.id })
  })

  it('a choice that skips rows passes through a gap in each, never behind a scene', () => {
    const l = layoutOf([
      {
        key: 'A',
        choices: [
          ['near', 'B'],
          ['far', 'D'],
        ],
      },
      { key: 'B', choices: [['on', 'C']] },
      { key: 'C', choices: [['on', 'D']] },
      { key: 'D', ending: true },
    ])
    const far = l.edges.find((e) => e.label === 'far')!
    expect(far.via).toHaveLength(2) // rows 1 and 2
    for (const p of far.via)
      for (const n of l.nodes)
        expect(p.x < n.x || p.x > n.x + NODE_W || p.y < n.y || p.y > n.y + NODE_H).toBe(true)
  })

  it('labels of choices from one scene do not sit on each other', () => {
    const l = layoutOf([
      {
        key: 'Start',
        choices: [
          ['Take the old road', 'A'],
          ['Take the new road', 'B'],
          ['Take no road at all', 'C'],
        ],
      },
      { key: 'A', ending: true },
      { key: 'B', ending: true },
      { key: 'C', ending: true },
    ])
    const box = (e: (typeof l.edges)[number]) => ({
      x: e.lx - e.label.length * 3.2,
      w: e.label.length * 6.4,
      y: e.ly - 9,
      h: 18,
    })
    for (const [i, a] of l.edges.entries())
      for (const b of l.edges.slice(i + 1)) {
        const [p, q] = [box(a), box(b)]
        expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h).toBe(false)
      }
  })

  it('the sample’s game book: no scene overlaps another and no label is cut off by the left edge', () => {
    const data = saltmarchSample()
    const l = layoutStory(storyGraph(data, bok.saltash))
    expect(l.nodes.filter((n) => !n.ghost)).toHaveLength(11)
    expect(overlaps(l)).toEqual([])
    for (const e of l.edges)
      expect(e.lx - Math.min(e.label.length, 26) * 3.2).toBeGreaterThanOrEqual(0)
    expect(l.edges.map((e) => e.label)).toContain('Climb the cliff path') // the long way round, through the rows between
    // every label is clear of every scene and of every other label
    const box = (e: (typeof l.edges)[number]) => ({
      x: e.lx - (Math.min(e.label.length, 26) * 6.4 + 12) / 2,
      w: Math.min(e.label.length, 26) * 6.4 + 12,
      y: e.ly - 9,
      h: 18,
    })
    const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    for (const [i, e] of l.edges.entries()) {
      for (const n of l.nodes)
        expect(hit(box(e), { x: n.x, y: n.y, w: NODE_W, h: NODE_H })).toBe(false)
      for (const f of l.edges.slice(i + 1)) expect(hit(box(e), box(f))).toBe(false)
    }
    // and near the scene each choice is made in: the first label is in the top half of its way down
    const first = l.edges.find((e) => e.label === 'Follow the lights')!
    const from = l.byId.get(first.from)!
    expect(first.ly - (from.y + NODE_H)).toBeLessThan(GAP_ROW / 2 + 9)
  })

  it('handles an empty book and one scene', () => {
    expect(layoutOf([]).nodes).toEqual([])
    expect(layoutOf([{ key: 'Only' }]).nodes).toHaveLength(1)
  })

  it('lays out a big book with no overlaps, in good time', () => {
    const book = (n: number): SceneSpec[] =>
      Array.from({ length: n }, (_, i) => ({
        key: `S${i}`,
        choices: [
          [`a${i}`, `S${Math.min(n - 1, i * 2 + 1)}`],
          [`b${i}`, `S${Math.min(n - 1, i * 2 + 2)}`],
          [`back${i}`, `S${Math.floor(i / 3)}`],
        ] as [string, string][],
      }))
    const data = storyBook(book(1000))
    const graph = storyGraph(data, bookIdOf(data))
    // The best of three, so a busy machine does not fail a layout that is fast.
    const times = [0, 1, 2].map(() => {
      const t = performance.now()
      layoutStory(graph)
      return performance.now() - t
    })
    expect(Math.min(...times)).toBeLessThan(400) // a thousand scenes, laid out again on a change (about 50 ms on a quiet machine)
    const l = layoutOf(book(400))
    expect(l.nodes).toHaveLength(400)
    expect(overlaps(l)).toEqual([])
    // no label is cut off by the left edge of the map
    for (const e of l.edges)
      expect(e.lx - Math.min(e.label.length, 26) * 3.2).toBeGreaterThanOrEqual(0)
  })
})

describe('moving between scenes with the arrow keys', () => {
  const l = layoutOf(FORK)
  it('goes to the nearest scene that way, and nowhere when there is none', () => {
    expect(nodeInDirection(l, scn('Start'), 'down')).toBeDefined()
    expect(nodeInDirection(l, scn('Start'), 'up')).toBeUndefined()
    const right = nodeInDirection(l, scn('Left'), 'right')
    expect(right === scn('Right') || right === undefined).toBe(true)
    expect(nodeInDirection(l, scn('End'), 'down')).toBeUndefined()
  })
})
