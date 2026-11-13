// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { schema } from '../extensions'
import { bodyToDoc, docToBody } from './body'

const toBody = (doc: JSONContent) => docToBody(schema.nodeFromJSON(doc))
const blocks = (md: string) => bodyToDoc(md).content ?? []
const para = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})
/** The block at `i` with its text replaced: an edit that keeps the block's memory of the file. */
const edited = (md: string, i: number, text: string): JSONContent => {
  const doc = bodyToDoc(md)
  const block = doc.content![i]!
  doc.content![i] = { ...block, content: [{ type: 'text', text }] }
  return doc
}
const typesOf = (node: JSONContent): string[] => [
  node.type ?? '',
  ...(node.content ?? []).flatMap(typesOf),
]

describe('an unedited document', () => {
  it('is empty for an empty text, and has a place to type', () => {
    expect(bodyToDoc('').content).toEqual([{ type: 'paragraph' }])
    expect(toBody(bodyToDoc(''))).toBe('')
  })
  it('keeps odd spacing, tabs, a missing final newline and trailing spaces', () => {
    for (const md of [
      'one\n\n\n\n\ntwo',
      'one  \ntwo\t\n\n',
      'text\n',
      'text',
      '\n\n\ntext\n',
      '\t- tab list\n',
      '   indented para\n\n\n',
    ])
      expect(toBody(bodyToDoc(md))).toBe(md)
  })
})

describe('an edit', () => {
  const md = 'First para.\n\n\n\nSecond  para.  \nsoft wrap\n\n* * *\n\n_third_ stays\n'
  it('rewrites only the edited block, and keeps the spacing around it', () => {
    expect(toBody(edited(md, 1, 'Changed.'))).toBe(
      'First para.\n\n\n\nChanged.\n\n* * *\n\n_third_ stays\n',
    )
  })
  it('leaves the other blocks byte for byte, even in a form this editor does not write', () => {
    const out = toBody(edited(md, 0, 'New first.'))
    expect(out.endsWith('Second  para.  \nsoft wrap\n\n* * *\n\n_third_ stays\n')).toBe(true)
  })
  it('writes a new block in the dialect after a last block that had no final newline', () => {
    const doc = bodyToDoc('one')
    doc.content!.push(para('two'))
    expect(toBody(doc)).toBe('one\n\ntwo\n')
  })
  it('does not write empty paragraphs', () => {
    const doc = bodyToDoc('one\n\ntwo\n')
    doc.content!.splice(1, 0, { type: 'paragraph' })
    doc.content!.push({ type: 'paragraph' })
    expect(toBody(doc)).toBe('one\n\ntwo\n')
  })
  it('writes the dialect form for a block the author made', () => {
    const doc = bodyToDoc('')
    doc.content = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      { type: 'sceneBreak' },
      para('end'),
    ]
    expect(toBody(doc)).toBe('## Title\n\n* * *\n\nend\n')
  })
  it('drops nothing when the only block is deleted', () => {
    const doc = bodyToDoc('only\n')
    doc.content = [{ type: 'paragraph' }]
    expect(toBody(doc)).toBe('')
  })
})

describe('what is understood', () => {
  it('reads <u> as one underline mark, and any other tag as text', () => {
    const [p] = blocks('a <u>b</u> <U>c</U> <b>d</b> <span class="x">e</span>')
    const marks = (p!.content ?? []).map((n) => [n.text, n.marks?.map((m) => m.type)])
    expect(marks).toContainEqual(['b', ['underline']])
    expect(marks).toContainEqual(['<U>', ['verbatim']])
    expect(marks).toContainEqual(['<b>', ['verbatim']])
    expect(marks).toContainEqual(['<span class="x">', ['verbatim']])
    expect(marks.filter((m) => m[1]?.includes('underline'))).toHaveLength(1)
  })
  it('keeps an unmatched <u> as text', () => {
    const [p] = blocks('a <u>b')
    expect(p!.content!.map((n) => n.text).join('')).toBe('a <u>b')
    expect(JSON.stringify(p)).not.toContain('underline')
  })
  it('never makes a node for HTML: a block of it is a raw block of letters', () => {
    const types = typesOf(
      bodyToDoc('<div>\n<script>alert(1)</script>\n</div>\n\n<img src=x onerror=y>\n'),
    )
    expect(new Set(types)).toEqual(new Set(['doc', 'rawBlock', 'text']))
  })
  it('keeps tables and footnotes as raw Markdown text', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n\n[^1]: A note.\n'
    const raws = blocks(md).filter((b) => b.type === 'rawBlock')
    expect(raws.map((b) => b.content![0]!.text)).toEqual([
      '| a | b |\n| - | - |\n| 1 | 2 |',
      '[^1]: A note.',
    ])
  })
  it('keeps a table through an edit of the paragraph beside it', () => {
    const md = 'Before.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter [^1].\n\n[^1]: A note.\n'
    expect(toBody(edited(md, 0, 'Edited.'))).toBe(md.replace('Before.', 'Edited.'))
  })
  it('keeps a table even if the raw block itself is rewritten', () => {
    const doc = bodyToDoc('| a | b |\n| - | - |\n')
    const raw = doc.content![0]!
    delete raw.attrs!.sig // forgotten: written from its text
    expect(toBody(doc)).toBe('| a | b |\n| - | - |\n')
  })
  it('keeps a footnote reference and a wiki link unescaped when its paragraph is rewritten', () => {
    const text =
      'A note[^1], [[Elena Vasquez|Elena]], ![[Elena Vasquez]] and [[id:chr_8f3k2m9q1x]] ^blk-a1b2c3'
    expect(toBody(edited('x\n', 0, text))).toBe(`${text}\n`)
    const [p] = blocks(text)
    expect(p!.content!.map((n) => n.text).join('')).toBe(text)
  })
  it('keeps a block ID at the end of the block it names', () => {
    const md =
      'Para ^blk-aaaaaa\n\n## Head ^blk-bbbbbb\n\n- Item ^blk-cccccc\n\n> Quote ^blk-dddddd\n'
    expect(toBody(bodyToDoc(md))).toBe(md)
    expect(toBody(edited(md, 0, 'Para two ^blk-aaaaaa'))).toBe(md.replace('Para', 'Para two'))
  })
  it('reads a thematic break in any form as a scene break, and writes * * *', () => {
    const doc = bodyToDoc('a\n\n---\n\n***\n\n___\n\nb\n')
    expect(doc.content!.map((b) => b.type)).toEqual([
      'paragraph',
      'sceneBreak',
      'sceneBreak',
      'sceneBreak',
      'paragraph',
    ])
  })
  it('reads a callout, its kind, its title and its body', () => {
    const [c] = blocks('> [!tip] A *title*\n> Body one.\n>\n> Body two.\n')
    expect(c!.type).toBe('callout')
    expect(c!.attrs).toMatchObject({ kind: 'tip', title: 'A *title*' })
    expect(c!.content).toHaveLength(2)
  })
  it('reads a checklist and keeps a checkbox in a mixed list as text', () => {
    const [tasks, mixed] = blocks('- [ ] a\n- [x] b\n\n* plain\n* [x] box\n')
    expect(tasks!.type).toBe('taskList')
    expect(tasks!.content!.map((i) => i.attrs!.checked)).toEqual([false, true])
    expect(mixed!.type).toBe('bulletList')
  })
  it('writes every sort of list the way it was read once edited', () => {
    const md = '3. three\n4. four\n   - nested\n'
    const doc = bodyToDoc(md)
    delete doc.content![0]!.attrs!.sig
    expect(toBody(doc)).toBe(md)
  })
})

describe('lists that follow each other', () => {
  const list = (type: string, text: string): JSONContent => ({
    type,
    content: [{ type: 'listItem', content: [para(text)] }],
  })
  it('take the other marker, or they would read back as one list', () => {
    const body = toBody({
      type: 'doc',
      content: [
        list('bulletList', 'a'),
        list('bulletList', 'b'),
        list('bulletList', 'c'),
        list('orderedList', 'one'),
        list('orderedList', 'two'),
      ],
    })
    expect(body).toBe('- a\n\n* b\n\n- c\n\n1. one\n\n1) two\n')
    expect(blocks(body).map((b) => b.type)).toEqual([
      'bulletList',
      'bulletList',
      'bulletList',
      'orderedList',
      'orderedList',
    ])
  })
  it('does not change a list that has nothing above it', () => {
    expect(toBody({ type: 'doc', content: [para('x'), list('bulletList', 'a')] })).toBe(
      'x\n\n- a\n',
    )
  })
})

describe('writing again what was written', () => {
  it('is stable: written, read and written again gives the same text', () => {
    const md =
      '# T\n\nA **b** and *c* and <u>d</u> and ~~e~~ [f](https://x.y).\n\n- [ ] x\n  - [x] y\n\n> [!note] N\n> body\n\n* * *\n\n1. a\n2. b\n'
    const once = toBody(bodyToDoc(md))
    const forgotten = (d: JSONContent) => ({
      ...d,
      content: d.content!.map((b) => ({ ...b, attrs: { ...b.attrs, src: null, sig: null } })),
    })
    const fresh = toBody(forgotten(bodyToDoc(md)))
    expect(fresh).toBe(md)
    expect(toBody(forgotten(bodyToDoc(fresh)))).toBe(fresh)
    expect(once).toBe(md)
  })
})

// Whatever is typed must come back as typed. A seeded fuzz over the characters Markdown reads.
describe('typed text survives being written and read', () => {
  const ALPHABET = [
    '*',
    '_',
    '[',
    ']',
    '(',
    ')',
    '<',
    '>',
    '#',
    '-',
    '+',
    '.',
    '~',
    '`',
    '&',
    '!',
    '|',
    '^',
    '\\',
    ' ',
    ' ',
    'a',
    'b',
    '1',
    '2',
    '\n',
    '=',
    ':',
    ';',
  ]
  // FUZZ_SEED and FUZZ_RUNS try other seeds for longer: `FUZZ_SEED=3 FUZZ_RUNS=50000 npx vitest run body`.
  let seed = Number(process.env.FUZZ_SEED ?? 7)
  const runs = Number(process.env.FUZZ_RUNS ?? 400)
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!
  const text = () => {
    let s = ''
    for (let n = 1 + Math.floor(rand() * 12); n > 0; n--) s += pick(ALPHABET)
    // A soft line break has no blank line and no spaces around it in a paragraph.
    return s.replace(/\s*\n\s*/g, '\n').replace(/^\s+|\s+$/g, '') || 'x'
  }
  const MARKS = [[], [], ['bold'], ['italic'], ['underline'], ['strike'], ['bold', 'italic']]
  const flat = (p: JSONContent) =>
    (p.content ?? []).flatMap((n) =>
      n.type === 'text'
        ? [{ t: n.text!, m: (n.marks ?? []).map((x) => x.type).sort() }]
        : [{ t: '\n', m: [] as string[] }],
    )
  /** Adjacent runs with the same marks are one run. */
  const merged = (runs: { t: string; m: string[] }[]) =>
    runs.reduce<{ t: string; m: string[] }[]>((acc, r) => {
      const last = acc[acc.length - 1]
      if (last && last.m.join() === r.m.join()) last.t += r.t
      else acc.push({ ...r })
      return acc
    }, [])

  it('holds for single paragraphs of plain text', () => {
    for (let i = 0; i < runs; i++) {
      const t = text()
      const out = toBody({ type: 'doc', content: [para(t)] })
      const back = blocks(out)
      expect(back, JSON.stringify(t)).toHaveLength(1)
      expect(back[0]!.type, JSON.stringify(t)).toBe('paragraph')
      expect(merged(flat(back[0]!)), JSON.stringify([t, out])).toEqual([{ t, m: [] }])
    }
  })

  it('holds for text with marks', () => {
    for (let i = 0; i < runs; i++) {
      // A marked run begins and ends with a letter: a mark beside punctuation may not read back.
      const parts: { t: string; m: string[] }[] = []
      for (let n = 1 + Math.floor(rand() * 4); n > 0; n--) {
        const m = pick(MARKS) as string[]
        // Two marked runs side by side (`*a***b**`) are not told apart by Markdown: a space between.
        if (m.length && parts.at(-1)?.m.length) parts.push({ t: ' ', m: [] })
        parts.push({ t: m.length ? `a${text()}b` : text(), m: [...m].sort() })
      }
      const doc: JSONContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: parts.map((r) => ({
              type: 'text',
              text: r.t,
              ...(r.m.length ? { marks: r.m.map((type) => ({ type })) } : {}),
            })),
          },
        ],
      }
      const out = toBody(doc)
      const back = blocks(out)
      expect(back, JSON.stringify([parts, out])).toHaveLength(1)
      expect(merged(flat(back[0]!)), JSON.stringify([parts, out])).toEqual(merged(parts))
    }
  })
})
