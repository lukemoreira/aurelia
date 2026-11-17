// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import ContinuityView from '@/views/ContinuityView.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { story, type Sc } from '../../tests/helpers/continuity-fixture'
import { continuityFindings } from './continuity-checks'
import {
  arcLanes,
  continuityStats,
  pacing,
  povBalance,
  presenceMap,
  timeChart,
} from './continuity-views'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

// The Continuity view must stay usable on a book of 120 chapters and 200 characters (design README).
// These are budgets, not benchmarks: each is several times what a laptop needs, so a slow CI machine
// passes and a change that makes the work grow with the square of the book does not. `PERF_REPORT=1`
// prints the measured times.
const report = (label: string, ms: number) => {
  if (process.env.PERF_REPORT) process.stderr.write(`perf ${label}: ${ms.toFixed(1)} ms\n`)
}
const SLACK = process.env.CI ? 8 : 3
vi.setConfig({ testTimeout: 60_000 })

const time = <T>(fn: () => T): [T, number] => {
  const start = performance.now()
  const out = fn()
  return [out, performance.now() - start]
}

const CHARACTERS = Array.from({ length: 200 }, (_, i) => `c${i}`)
const ARCS = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5']
const names = {
  characters: CHARACTERS,
  places: ['p0', 'p1', 'p2', 'p3'],
  items: ['i0', 'i1', 'i2'],
  arcs: ARCS,
}

/** 120 chapters of 3 scenes: point of view and about six people on the page, three changes a scene, a time that rises. */
function bigBook(): Sc[] {
  const out: Sc[] = []
  for (let c = 0; c < 120; c++)
    for (let s = 0; s < 3; s++) {
      const n = c * 3 + s
      const who = (k: number) => CHARACTERS[(n * 7 + k * 13) % 200]!
      out.push({
        key: `s${n}`,
        ch: `ch${String(c).padStart(3, '0')}`,
        pov: who(0),
        add: [who(1), who(2), who(3), who(4), who(5)],
        place: `p${n % 4}`,
        at: `412-${String(1 + Math.floor(n / 120)).padStart(2, '0')}-${String(1 + ((n * 3) % 27)).padStart(2, '0')}T${String(n % 24).padStart(2, '0')}:00`,
        arcs: [ARCS[n % 6]!],
        words: 900,
        changes: [
          { who: who(1), kind: 'knows', value: `fact ${n}` },
          { who: who(2), kind: 'relation', with: who(3), value: `friend ${n % 5} → ally ${n % 7}` },
          n % 5 === 0
            ? { who: who(0), kind: 'holds', item: `i${n % 3}` }
            : { who: who(0), kind: 'condition', value: `tired ${n % 4}` },
        ],
      })
    }
  return out
}

describe('a book of 120 chapters and 200 characters', () => {
  const scenes = bigBook()

  it('is read, checked and drawn as data in a fraction of a second', () => {
    const [s, build] = time(() => story(scenes, { names }))
    report('build the fixture (360 scenes)', build)
    const m = s.m
    const [findings, check] = time(() => continuityFindings(m))
    report('every check', check)
    expect(check).toBeLessThan(400 * SLACK)
    const [, views] = time(() => {
      const rows = presenceMap(m, findings)
      continuityStats(m, rows)
      arcLanes(m)
      povBalance(m)
      timeChart(m, findings)
      pacing(m)
    })
    report('every figure', views)
    expect(views).toBeLessThan(400 * SLACK)
    expect(m.scenes).toHaveLength(360)
    expect(presenceMap(m, findings).length).toBeGreaterThan(150)
  })

  it('reads a branching book of the same size, with a hub and loops, to a fixed point quickly', () => {
    const branching = scenes.map((sc, i): Sc => {
      const next = scenes[i + 1]?.key
      const back = scenes[Math.max(0, i - 4)]!.key
      const choices: [string, string][] = []
      if (next) choices.push(['on', next])
      if (i % 9 === 8) choices.push(['back', back]) // a loop every nine scenes
      return { ...sc, choices, ...(next ? {} : { ending: true }) }
    })
    const [s] = time(() => story(branching, { mode: 'branching', names }))
    const [flow, ms] = time(() => continuityFindings(s.m))
    report('branching 360 scenes with loops: model + checks', ms)
    expect(ms).toBeLessThan(600 * SLACK)
    expect(flow.length).toBeGreaterThanOrEqual(0)
    expect(s.m.flow.after.size).toBe(360)
  })

  it('draws only the rows in view of the presence map, however many people there are', async () => {
    setActivePinia(createPinia())
    const s = story(scenes, { names })
    const ws = useWorkspaceStore()
    ws.load(s.data)
    ws.select(s.input.bookId)
    const start = performance.now()
    const w = mount(ContinuityView)
    const ms = performance.now() - start
    report('mount the Continuity view (360 scenes, 200 people)', ms)
    const table = w.find('table[aria-rowcount]')
    expect(Number(table.attributes('aria-rowcount'))).toBeGreaterThan(150)
    const drawn = table.findAll('tbody tr[aria-rowindex]').length
    expect(drawn).toBeLessThan(40)
    expect(table.findAll('thead th[scope="col"]')).toHaveLength(25) // a stretch of 24 chapters
    expect(ms).toBeLessThan(2000 * SLACK)
  })
})
