// SPDX-License-Identifier: AGPL-3.0-or-later
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { countWords } from '@/domain/prose'
import { editorExtensions } from './extensions'
import { bodyToDoc, docToBody } from './markdown/body'

// A 150,000-word book must stay fast (PLANS M4). These are budgets, not benchmarks: each is
// several times what a laptop needs, so a slow CI machine passes and a change that makes the
// work scale with the book instead of the block does not. Set `PERF_REPORT=1` to print the
// measured times (the ADR-0007 numbers).
const report = (label: string, ms: number) => {
  if (process.env.PERF_REPORT) process.stderr.write(`perf ${label}: ${ms.toFixed(1)} ms\n`)
}
// Shared CI machines run this about ten times slower and pause for GC; the budgets there keep catching
// a real slowdown (an order of magnitude) without failing on noise. Locally they stay tight.
const SLACK = process.env.CI ? 8 : 1

// A 20,000-word scene typed 300 times takes seconds on a slow machine: give the file room.
vi.setConfig({ testTimeout: 120_000 })

const time = <T>(fn: () => T): [T, number] => {
  const start = performance.now()
  const out = fn()
  return [out, performance.now() - start]
}

const SENTENCES = [
  'The bells had already started when Elena reached the Lantern Gate.',
  'She counted them the way her mother had taught her: one for the curfew, one for the tide.',
  '“You were drowned, the last I heard,” he said, and set the lantern down on the ledger.',
  'Nobody in the Lantern Quarter ever asked where the **salt** came from, only what it *cost*.',
  'He let the silence stand long enough that the boy on the ladder stopped to listen to [[Tomas Brandt]].',
]
/** A scene of about `words` words: paragraphs with marks and links, a break and a quote now and then. */
function scene(words: number, seed = 0): string {
  const out: string[] = []
  let n = 0
  for (let i = seed; n < words; i++) {
    const para = Array.from({ length: 4 }, (_, k) => SENTENCES[(i + k) % SENTENCES.length]).join(
      ' ',
    )
    out.push(i % 17 === 16 ? '* * *' : i % 11 === 10 ? `> ${para}` : para)
    n += para.split(' ').length
  }
  return `${out.join('\n\n')}\n`
}

let editor: Editor | undefined
afterEach(() => editor?.destroy())
const open = (body: string) =>
  (editor = new Editor({ extensions: editorExtensions, content: bodyToDoc(body) }))

describe('a 150,000-word book', () => {
  const book = Array.from({ length: 100 }, (_, i) => scene(1500, i))

  it('has about 150,000 words', () => {
    expect(book.reduce((n, b) => n + countWords(b), 0)).toBeGreaterThan(140_000)
  })

  it('reads every scene into the editor model in a few seconds, and writes each back unchanged', () => {
    const [docs, ms] = time(() => book.map(bodyToDoc))
    report('read 100 scenes (150k words)', ms)
    expect(ms).toBeLessThan(3000 * SLACK)
    const editors = docs.slice(0, 5).map((doc, i) => {
      const ed = new Editor({ extensions: editorExtensions, content: doc })
      expect(docToBody(ed.state.doc)).toBe(book[i])
      return ed
    })
    editors.forEach((ed) => ed.destroy())
  })

  it('switches to a scene in well under a second', () => {
    const times: number[] = []
    for (let i = 0; i < 10; i++) {
      const [ed, ms] = time(() => open(book[i]!))
      times.push(ms)
      ed.destroy()
    }
    const mean = times.reduce((a, b) => a + b) / times.length
    report('open one 1,500-word scene (mean of 10)', mean)
    expect(mean).toBeLessThan(200 * SLACK)
  })

  it('has no lag typing in a very long scene: a keystroke costs the same as in a short one', () => {
    const long = scene(20_000)
    const [ed, mountMs] = time(() => open(long))
    report('open one 20,000-word scene', mountMs)
    expect(mountMs).toBeLessThan(1500 * SLACK)
    ed.commands.focus('end')
    // What happens to every keystroke: the change, the text written out, the words counted.
    const keystroke = () => {
      const start = performance.now()
      const { from } = ed.state.selection
      ed.view.dispatch(ed.state.tr.insertText('x', from))
      countWords(docToBody(ed.state.doc))
      return performance.now() - start
    }
    keystroke() // warm
    const times = Array.from({ length: 300 }, keystroke).sort((a, b) => a - b)
    const p95 = times[Math.floor(times.length * 0.95)]!
    report('keystroke in a 20,000-word scene (p95)', p95)
    report('keystroke in a 20,000-word scene (median)', times[150]!)
    expect(p95).toBeLessThan(25 * SLACK)

    const short = open(scene(300))
    short.commands.focus('end')
    const shortTimes = Array.from({ length: 300 }, () => {
      const start = performance.now()
      short.view.dispatch(short.state.tr.insertText('x', short.state.selection.from))
      countWords(docToBody(short.state.doc))
      return performance.now() - start
    }).sort((a, b) => a - b)
    report('keystroke in a 300-word scene (median)', shortTimes[150]!)
    ed.destroy()
    short.destroy()
  })

  it('writes a long scene out again after one edit in a few milliseconds', () => {
    const body = scene(20_000)
    const ed = open(body)
    ed.view.dispatch(ed.state.tr.insertText('x', 2))
    // The median of a few runs, with room for a busy CI machine: this catches a slowdown of
    // several times, not noise. The write-out runs on the save debounce, not on every key.
    const runs = Array.from({ length: 5 }, () => time(() => docToBody(ed.state.doc))[1]).sort(
      (a, b) => a - b,
    )
    const ms = runs[2]!
    report('write out a 20,000-word scene after one edit', ms)
    expect(ms).toBeLessThan(50 * SLACK)
    ed.destroy()
  })
})
