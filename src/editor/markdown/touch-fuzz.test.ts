// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { schema } from '../extensions'
import { bodyToDoc, docToBody } from './body'
import { parseMarkdown } from './parse'

// A property test over whole files, with fixed seeds so it is the same every run:
// read a file, change ONE block (a word typed into it, or only written again), write the file.
// Every other block must come out byte for byte and in order; the changed block keeps every
// character, its type and the number of blocks; and the result must itself be a file that is
// read exactly and written back unchanged. `FUZZ_SEEDS=1,2,3` and `FUZZ_RUNS=2000` try more.
// The generator is deliberately dense in Markdown's own characters. On 100,000 files it still
// finds about one case in 10,000, all of them odd corners of `marked` or of CommonMark itself:
// an indented code block, a tab-indented line or a footnote definition straight after a list in
// a quote or a callout (written back it continues the list), and a tag or an address that
// `marked` reads differently once a neighbouring mark moves. The default seeds are clean.

const toBody = (doc: JSONContent) => docToBody(schema.nodeFromJSON(doc))
const forget = (b: JSONContent) => {
  const attrs = { ...b.attrs }
  // As an edit leaves it: the block still remembers its file, but no longer matches it.
  attrs.sig = null
  return { ...b, attrs }
}
const textsOf = (doc: JSONContent) =>
  (doc.content ?? []).map((b) => schema.nodeFromJSON(b).textContent)
const dropSpace = (s: string) => s.replace(/\s+/g, '')

const rnd = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
// Words with Markdown's own characters in them, and words that open a mark and never close it.
const WORDS = [
  'the',
  'bells',
  'Elena',
  'gate*',
  'a_b',
  'x_',
  '3 * 4',
  '&amp;',
  '[x]',
  '~t~',
  'a<b',
  '\\n',
  '`c`',
  '#tag',
  '1.',
  '-',
  '>',
  '"q."',
  '**',
  '__',
  '~~',
  '<u>',
  '</u>',
  '[[E]]',
  '[^1]',
  '^blk-a',
  'é',
  '😀',
  'a|b',
  'http://x.y',
  '[l](u)',
  '[l](u "t")',
  '<b>',
  '&nbsp;',
  '\\',
  '`',
  ']',
  '[',
  '[^1]:',
  '|',
  ':',
  '=',
  '---',
  '+',
  '2)',
  '#',
  '<div>',
  '    ind',
  '\tt',
]

function generate(r: () => number): string {
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)]!
  const words = () => Array.from({ length: 1 + Math.floor(r() * 6) }, () => pick(WORDS)).join(' ')
  const inline = () => {
    const w = words()
    switch (Math.floor(r() * 10)) {
      case 0:
        return `**${w}**`
      case 1:
        return `*${w}*`
      case 2:
        return `_${w}_`
      case 3:
        return `<u>${w}</u>`
      case 4:
        return `~~${w}~~`
      case 5:
        return `${w}  \n${words()}`
      case 6:
        return `${w}\\\n${words()}`
      case 7:
        return `${w}\n${words()}`
      case 8:
        return `[${w}](https://e.com/${pick(['a', 'b(c)', 'd e'])})`
      default:
        return w
    }
  }
  const para = () => Array.from({ length: 1 + Math.floor(r() * 3) }, inline).join(' ')
  const block = (): string => {
    switch (Math.floor(r() * 22)) {
      case 0:
        return `${'#'.repeat(1 + Math.floor(r() * 6))} ${para()}`
      case 1:
        return `${para()}\n${pick(['===', '---'])}`
      case 2:
        return pick(['---', '***', '* * *', '___', '- - -', '#', '## ', '###### #'])
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
        return `    ${para()}\n    ${para()}`
      case 11:
        return `| a | b |\n|---|---|\n| ${words()} | ${words()} |`
      case 12:
        return `<div>\n${para()}\n</div>`
      case 13:
        return `[^1]: ${para()}`
      case 14:
        return `[ref${Math.floor(r() * 3)}]: https://e.com`
      case 15:
        return `- ${para()}\n  [^1]: ${words()}`
      case 16:
        return `> [!warn]\n> - ${para()}\n> - ${para()}\n>\n> ${para()}`
      case 17:
        return `3) ${para()}\n4) ${para()}`
      case 18:
        return `- ${para()}\n\n  ${para()}\n- ${para()}`
      case 19:
        return `${words()}\n[^1]: ${words()}`
      case 20:
        return `- [ ] ${para()}\n- ${para()}`
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

/** Put a word into the first text node of a block that is not kept as written. */
function type(node: JSONContent, r: () => number, word: string): boolean {
  if (node.type === 'rawBlock') return false
  if (node.type === 'text') {
    if (node.marks?.some((m) => m.type === 'verbatim')) return false
    const at = Math.floor(r() * (node.text!.length + 1))
    node.text = node.text!.slice(0, at) + word + node.text!.slice(at)
    return true
  }
  return (node.content ?? []).some((c) => type(c, r, word))
}

const seeds = (process.env.FUZZ_SEEDS ?? '1,2,3,4').split(',').map(Number)
const runs = Number(process.env.FUZZ_RUNS ?? 150)

describe.each(seeds)('changing one block of a whole file (seed %i)', (seed) => {
  it('leaves every other block byte for byte, and loses nothing of the block changed', () => {
    const r = rnd(seed)
    const failures: string[] = []
    for (let n = 0; n < runs && failures.length < 3; n++) {
      const md = generate(r)
      const parsed = parseMarkdown(md)
      const doc = bodyToDoc(md)
      const say = (what: string, extra = '') => {
        failures.push(`${what}\n in =${JSON.stringify(md)}${extra}`)
      }
      if (!parsed.exact) {
        say('NOT READ EXACTLY')
        continue
      }
      if (toBody(doc) !== md) {
        say('OPENED, NOT EDITED, AND CHANGED', `\n out=${JSON.stringify(toBody(doc))}`)
        continue
      }
      const i = Math.floor(r() * doc.content!.length)
      // A heading with nothing in it is kept as read; writing it again is deleting it.
      if (doc.content![i]!.type === 'heading' && !textsOf(doc)[i]) continue
      if (!(r() < 0.7 && type(doc.content![i]!, r, ' zq'))) {
        /* only written again */
      }
      const types = doc.content!.map((b) => b.type).join()
      doc.content![i] = forget(doc.content![i]!)
      const wanted = textsOf(doc)
      const out = toBody(doc)
      let at = 0
      const others = parsed.blocks.filter((_, j) => j !== i).map((b) => b.src.replace(/\s+$/, ''))
      const kept = others.every((src) => {
        const found = out.indexOf(src, at)
        at = found + src.length
        return found >= 0
      })
      const again = bodyToDoc(out)
      const got = textsOf(again)
      const same =
        kept &&
        got.length === wanted.length &&
        dropSpace(got.join('')) === dropSpace(wanted.join('')) &&
        again.content!.map((b) => b.type).join() === types
      if (!same) {
        say(`i=${i}`, `\n out=${JSON.stringify(out)}`)
        continue
      }
      // The result is a file like any other: read exactly, and written back as it is.
      if (!parseMarkdown(out).exact || toBody(again) !== out)
        say(`THE RESULT IS NOT STABLE i=${i}`, `\n out=${JSON.stringify(out)}`)
    }
    expect(failures).toEqual([])
  })
})
