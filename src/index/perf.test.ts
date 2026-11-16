// SPDX-License-Identifier: AGPL-3.0-or-later
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editorExtensions } from '@/editor/extensions'
import type { LinkEnv } from '@/editor/link-env'
import { createLinks } from '@/editor/links'
import { bodyToDoc, docToBody } from '@/editor/markdown/body'
import { fixture, id } from '../../tests/helpers/index-fixture'
import { WorkspaceIndex } from './workspace-index'

// A 150,000-word workspace must index within a budget, and typing must stay one frame (PLANS M3b).
// Budgets, not benchmarks: several times what a laptop needs, so a slow CI machine passes and a
// change that makes the work scale with the book instead of the file typed in does not. Set
// `PERF_REPORT=1` to print the measured times.
const report = (label: string, ms: number) => {
  if (process.env.PERF_REPORT) process.stderr.write(`perf ${label}: ${ms.toFixed(1)} ms\n`)
}
const SLACK = process.env.CI ? 8 : 3
vi.setConfig({ testTimeout: 120_000 })

const time = <T>(fn: () => T): [T, number] => {
  const start = performance.now()
  const out = fn()
  return [out, performance.now() - start]
}

const NAMES = [
  'Elena Vasquez',
  'Tomas Brandt',
  'Will Ashby',
  'Corin',
  'Lantern Quarter',
  'Greywater',
  'Ashcombe',
  'Marta Quill',
]
const FILLER =
  'The bells had already started when the sea changed its mind and the warden counted the steps to the old harbour, one for the curfew, one for the tide, and nobody asked where the salt came from. '
/** About `words` words of prose with a name or a link in every few sentences. */
function scene(words: number, seed: number): string {
  const out: string[] = []
  let n = 0
  for (let i = seed; n < words; i++) {
    const name = NAMES[i % NAMES.length]!
    const para = [
      `${name} said ${FILLER}`,
      `Then [[${NAMES[(i + 3) % NAMES.length]!}]] came, and ${NAMES[(i + 5) % NAMES.length]!}’s hand shook. ${FILLER}`,
      `${FILLER}${name.split(' ')[0]} left.`,
    ].join(' ')
    out.push(para)
    n += para.split(' ').length
  }
  return `${out.join('\n\n')}\n`
}
const records = NAMES.map((title, i) => ({
  n: i + 1,
  title,
  type: i === 4 || i === 5 ? ('place' as const) : ('character' as const),
  aliases: title.includes(' ') ? [{ text: title.split(' ')[0]! }] : [],
}))

let editor: Editor | undefined
afterEach(() => editor?.destroy())

describe('a 150,000-word workspace', () => {
  const data = fixture(
    Array.from({ length: 100 }, (_, i) => ({ n: i + 1, body: scene(1500, i), book: 1 as const })),
    records,
  )

  it('is indexed, searched and has every backlink worked out within a budget', () => {
    const index = new WorkspaceIndex()
    const [, sync] = time(() => index.sync(data))
    report('sync 100 scenes (150k words)', sync)
    expect(sync).toBeLessThan(1000 * SLACK)

    const [links, first] = time(() => index.backlinks(id('chr', 1)))
    report('names and links found in every scene, then backlinks', first)
    expect(first).toBeLessThan(3000 * SLACK)
    expect(links.length).toBeGreaterThan(50)

    const [again, second] = time(() => index.backlinks(id('chr', 1)))
    report('backlinks again (everything kept)', second)
    expect(again).toEqual(links)
    expect(second).toBeLessThan(300 * SLACK)

    const [hits, search] = time(() => index.search('curfew'))
    report('first search (builds the search index)', search)
    expect(hits.length).toBeGreaterThan(0)
    expect(search).toBeLessThan(5000 * SLACK)
    const [, next] = time(() => index.search('harbour'))
    report('next search', next)
    expect(next).toBeLessThan(200 * SLACK)
  })

  it('an edit costs the scene typed in, not the book', () => {
    const index = new WorkspaceIndex()
    index.sync(data)
    index.backlinks(id('chr', 1)) // everything worked out once
    const costs: number[] = []
    let scenes = data.scenes
    for (let k = 0; k < 40; k++) {
      scenes = scenes.map((s, i) => (i === 7 ? { ...s, body: `${s.body}x` } : s))
      const [, ms] = time(() => {
        index.sync({ ...data, scenes })
        index.backlinks(id('chr', 1))
      })
      costs.push(ms)
    }
    costs.sort((a, b) => a - b)
    report('sync + backlinks after a keystroke, p95', costs[37]!)
    expect(costs[37]!).toBeLessThan(150 * SLACK)
  })

  it('a keystroke in a 20,000-word scene with links and names on screen stays within a frame', () => {
    const body = scene(20_000, 3)
    const small = fixture([{ n: 1, body }], records)
    const index = new WorkspaceIndex()
    index.sync(small)
    const scope = { universe: id('unv', 1), book: id('bok', 1) }
    const env: LinkEnv = {
      analyse: (text) => index.analyseText(text, scope),
      pick: (q) => index.pick(q, scope),
      writable: () => true,
      target: (i) => index.targetOf(i),
      open: () => undefined,
      notAName: () => undefined,
      card: {
        show: () => undefined,
        leave: () => undefined,
        close: () => false,
        focus: () => false,
      },
      picker: { show: () => undefined, hide: () => undefined },
    }
    const [, open] = time(
      () =>
        (editor = new Editor({
          extensions: [...editorExtensions, createLinks(env)],
          content: bodyToDoc(body),
        })),
    )
    report('open a 20,000-word scene with links and names drawn', open)
    expect(open).toBeLessThan(1500 * SLACK)
    const view = editor!.view
    const ms: number[] = []
    for (let k = 0; k < 200; k++) {
      const pos = 4 + ((k * 7919) % 2000)
      const [, t] = time(() => {
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
        view.dispatch(view.state.tr.insertText('x'))
        docToBody(view.state.doc)
      })
      ms.push(t)
    }
    ms.sort((a, b) => a - b)
    report('keystroke with links and names, median', ms[100]!)
    report('keystroke with links and names, p95', ms[190]!)
    expect(ms[190]!).toBeLessThan(60 * SLACK)
  })
})
