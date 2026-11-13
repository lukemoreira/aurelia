// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { schema } from '../extensions'
import { bodyToDoc, docToBody } from './body'
import { parseMarkdown } from './parse'

// A seeded fuzz over whole files: read one, touch ONE block (so it is written again from its
// words), write the file out. Every other block must come out byte for byte, in order, and no
// word of the touched one may be lost. `FUZZ_SEED` and `FUZZ_RUNS` try others for longer.

const toBody = (doc: JSONContent) => docToBody(schema.nodeFromJSON(doc))
const forget = (b: JSONContent) => {
  const attrs = { ...b.attrs }
  delete attrs.src
  delete attrs.sig
  return { ...b, attrs }
}
const textsOf = (md: string) =>
  (bodyToDoc(md).content ?? []).map((b) => schema.nodeFromJSON(b).textContent)

const rnd = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
// Words with Markdown's own characters in them, but none that open a mark and never close it, and none that end in `*` or `_` (beside a
// mark's own `**` they are not told apart: ADR-0007).
const WORDS = [
  'the',
  'bells',
  'Elena',
  'a_b',
  '3 * 4',
  '&amp;',
  '[x]',
  'a<b',
  '`c`',
  '#tag',
  '1.',
  '-',
  '>',
  '"q."',
  '[[E]]',
  '[^1]',
  '^blk-a',
  'é',
  '😀',
  'a|b',
  'http://x.y',
  '![i](u)',
  '[l](u)',
  '[l](u "t")',
  '<b>',
  '&nbsp;',
]

function generate(r: () => number): string {
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)]!
  const words = () => Array.from({ length: 1 + Math.floor(r() * 6) }, () => pick(WORDS)).join(' ')
  const inline = () => {
    const w = words()
    switch (Math.floor(r() * 8)) {
      case 0:
        return `**${w}**`
      case 1:
        return `*${w}*`
      case 2:
        return `<u>${w}</u>`
      case 3:
        return `~~${w}~~`
      case 4:
        return `${w}  \n${words()}`
      case 5:
        return `${w}\\\n${words()}`
      default:
        return w
    }
  }
  const para = () => Array.from({ length: 1 + Math.floor(r() * 3) }, inline).join(' ')
  const block = (): string => {
    switch (Math.floor(r() * 14)) {
      case 0:
        return `${'#'.repeat(1 + Math.floor(r() * 6))} ${para()}`
      case 1:
        return `${para()}\n${pick(['===', '---'])}`
      case 2:
        return pick(['---', '***', '* * *', '___', '- - -'])
      case 3:
        return `> ${para()}\n>\n> ${para()}`
      case 4:
        return `> [!${pick(['note', 'tip'])}] ${pick(['', 'Title'])}\n> ${para()}`
      case 5:
        return `${pick(['-', '*', '+'])} ${para()}\n${pick(['-', '*', '+'])} ${para()}`
      case 6:
        return `1. ${para()}\n2. ${para()}\n   - ${para()}`
      case 7:
        return `- [ ] ${para()}\n- [x] ${para()}`
      case 8:
        return `- ${para()}\n\n- ${para()}`
      case 9:
        return `\`\`\`js\nconst ${para()}\n\`\`\``
      case 10:
        return `| a | b |\n|---|---|\n| ${words()} | ${words()} |`
      case 11:
        return `<div>\n${para()}\n</div>`
      case 12:
        return `[^1]: ${para()}`
      default:
        return para()
    }
  }
  const seps = ['\n\n', '\n\n\n', '\n', '\n  \n']
  let md = ''
  const n = 1 + Math.floor(r() * 6)
  for (let i = 0; i < n; i++) md += block() + (i < n - 1 ? pick(seps) : pick(['', '\n', '\n\n']))
  return md
}

describe('touching one block of a whole file', () => {
  it('leaves every other block byte for byte and loses no word', () => {
    const r = rnd(Number(process.env.FUZZ_SEED ?? 42))
    const runs = Number(process.env.FUZZ_RUNS ?? 1500)
    const failures: string[] = []
    for (let n = 0; n < runs && failures.length < 5; n++) {
      const md = generate(r)
      const parsed = parseMarkdown(md)
      if (!parsed.exact) {
        failures.push(`INEXACT ${JSON.stringify(md)}`)
        continue
      }
      const doc = bodyToDoc(md)
      if (toBody(doc) !== md) {
        failures.push(`OPENED, NOT EDITED, AND CHANGED ${JSON.stringify(md)}`)
        continue
      }
      const i = Math.floor(r() * doc.content!.length)
      const before = textsOf(md)
      doc.content![i] = forget(doc.content![i]!)
      const out = toBody(doc)
      let at = 0
      const others = parsed.blocks.filter((_, j) => j !== i).map((b) => b.src.replace(/\s+$/, ''))
      const kept = others.every((src) => {
        const found = out.indexOf(src, at)
        at = found + src.length
        return found >= 0
      })
      const after = textsOf(out)
      const words = (t: string[]) => t.join('\u0001').replace(/\s+/g, '')
      if (!kept || after.length !== before.length || words(after) !== words(before))
        failures.push(`i=${i}\n in =${JSON.stringify(md)}\n out=${JSON.stringify(out)}`)
    }
    expect(failures).toEqual([])
  })
})
