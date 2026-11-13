// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSONContent } from '@tiptap/core'
import { Lexer } from 'marked'
import { describe, expect, it } from 'vitest'
import { schema } from '../extensions'
import { bodyToDoc, docToBody } from './body'

// Found by the second review, with an 8,000-file property test (see touch-fuzz.test.ts).

const toBody = (doc: JSONContent) => docToBody(schema.nodeFromJSON(doc))
const forget = (b: JSONContent) => {
  const attrs = { ...b.attrs }
  delete attrs.src
  delete attrs.sig
  return { ...b, attrs }
}
/** Block `i` written again from its words, the rest of the file untouched. */
const touch = (md: string, i: number) => {
  const doc = bodyToDoc(md)
  doc.content![i] = forget(doc.content![i]!)
  return toBody(doc)
}
const types = (md: string) => bodyToDoc(md).content!.map((b) => b.type)
const text = (md: string) => bodyToDoc(md).content!.map((b) => schema.nodeFromJSON(b).textContent)
const para = (...parts: JSONContent[]): JSONContent => ({ type: 'paragraph', content: parts })
const t = (value: string, ...marks: string[]): JSONContent => ({
  type: 'text',
  text: value,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
})

describe('a block with nothing in it', () => {
  it('is written as it was read: `#` is a heading', () => {
    for (const md of ['#\n\ntext\n', '## \n\ntext\n', '###### #\n\ntext\n', 'a\n\n#\n\nb\n']) {
      const doc = bodyToDoc(md)
      const i = doc.content!.findIndex((b) => b.type === 'paragraph')
      expect(toBody(doc), md).toBe(md)
      expect(touch(md, i), md).toBe(md)
    }
  })
  it('is dropped when the author emptied it', () => {
    const doc = bodyToDoc('# Title\n\ntext\n')
    doc.content![0] = { type: 'heading', attrs: { level: 1 } }
    expect(toBody(doc)).toBe('text\n')
  })
})

describe('spaces at the start of a block', () => {
  it('are not written: they would make an indented code block, or move an item out of its list', () => {
    expect(toBody({ type: 'doc', content: [para(t('    four spaces'))] })).toBe('four spaces\n')
    expect(toBody({ type: 'doc', content: [para(t('  '), t('bold', 'bold'))] })).toBe('**bold**\n')
    expect(
      toBody({
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 2 }, content: [t('  x')] }],
      }),
    ).toBe('## x\n')
    const out = toBody({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [para(t('   # not a heading'))] }],
        },
      ],
    })
    expect(out).toBe('- \\# not a heading\n')
    expect(types(out)).toEqual(['bulletList'])
  })
})

describe('a nested list', () => {
  it('keeps a blank line before it when it could not interrupt a paragraph (a number but 1, an empty item)', () => {
    for (const [md, list] of [
      ['- x\n\n  2. y\n', 'orderedList'],
      ['- x\n\n  1.\n- z\n', 'orderedList'],
      ['- x\n\n  -\n', 'bulletList'],
    ] as const) {
      const out = touch(md, 0)
      const item = bodyToDoc(out).content![0]!.content![0]!
      expect(
        item.content!.map((b) => b.type),
        md,
      ).toContain(list)
      expect(text(out), md).toEqual(text(md))
    }
  })
  it('does not leave the newline that came before it in its item’s text', () => {
    const first = bodyToDoc('- x\n  - y\n').content![0]!.content![0]!.content![0]!
    expect(first.content).toEqual([{ type: 'text', text: 'x' }])
    // Also after a break, where the last line is a bare text of its own.
    const broken = bodyToDoc('1. a  \n=\n   - c\n').content![0]!.content![0]!.content![0]!
    expect(broken.content!.at(-1)).toEqual({ type: 'text', text: '=' })
  })
})

describe('text after a bare address', () => {
  it('is written as it is: a backslash there would join the address', () => {
    const out = toBody({
      type: 'doc',
      content: [para(t('http://x.y', 'verbatim'), t('**'))],
    })
    expect(out).toBe('http://x.y**\n')
    expect(text(touch('http://x.y**\n', 0))).toEqual(text('http://x.y**\n'))
  })
})

describe('marks', () => {
  it('**x* y** is read with one italic, not two', () => {
    for (const node of bodyToDoc('**gate* x**\n').content![0]!.content!)
      expect((node.marks ?? []).filter((m) => m.type === 'italic').length).toBeLessThanOrEqual(1)
  })
})

describe('blocks kept as read that touched in the file', () => {
  it('are written touching, and those that did not are parted', () => {
    const md =
      '<u>1. [^1]: &amp; ` ~~ `</u> <u> [x] \tt ` </u> >\\\n2) 😀 \\ &nbsp; +\n---\n```js\nconst *| </u> \\n __ [ <b>* _é the_\n```\n- [ ] *- \\ bells é x_ 3 * 4* > | ~~\n1. <u> [ _1. + [^1] __ 2)_\n- [x] \tt </u> # Elena 😀\\\n3 * 4\n'
    expect(toBody(bodyToDoc(md))).toBe(md)
    const joined = bodyToDoc('intro\n# Scene\n\nMore text.\n')
    joined.content!.splice(1, 1) // what lay between is gone: the two would run into one paragraph
    expect(toBody(joined)).toBe('intro\n\nMore text.\n')
  })
})

// Found by running the same property test on many more seeds.

const words = (md: string) => text(md).join('').replace(/\s+/g, '')
/** Every block of `md`, written again on its own: its words, and the shape of the file, are as before. */
const survives = (md: string) => {
  const n = bodyToDoc(md).content!.length
  for (let i = 0; i < n; i++) {
    const out = touch(md, i)
    const said = `${JSON.stringify(md)} block ${i} -> ${JSON.stringify(out)}`
    expect(words(out), said).toBe(words(md))
    expect(types(out), said).toEqual(types(md))
  }
}

describe('more shapes that read back as something else', () => {
  it('a heading’s last `#` is escaped: it would be its closing sequence', () => {
    survives('_ #\n-')
    const heading = { type: 'heading', attrs: { level: 2 }, content: [t('a #')] }
    expect(toBody({ type: 'doc', content: [heading] })).toBe('## a \\#\n')
  })
  it('a mark is not opened right after a letter before text that must stay as written', () => {
    survives(':*<d>*')
    const doc = { type: 'doc', content: [para(t('zq'), t('<d>', 'italic', 'verbatim'))] }
    expect(toBody(doc)).toBe('zq<d>\n')
  })
  it('a mark that opens on a symbol after a letter lets the symbol out (an emoji is one)', () => {
    survives(']~~😀~~')
    expect(toBody({ type: 'doc', content: [para(t('zq'), t('😀', 'strike'))] })).toBe('zq😀\n')
  })
  it('a break that opens a paragraph is not written', () => {
    expect(toBody({ type: 'doc', content: [para({ type: 'hardBreak' }, t('x'))] })).toBe('x\n')
  })
  it('a line start is found across what was written before it, spaces and all', () => {
    expect(toBody({ type: 'doc', content: [para(t('a\n'), t(' ', 'verbatim'), t('>'))] })).toBe(
      'a\n \\>\n',
    )
    expect(toBody({ type: 'doc', content: [para(t('a\n   # x'))] })).toBe('a\n   \\# x\n')
  })
  it('a rule in an item, and items inside items with nothing in them', () => {
    survives('```\n```\n-\n+ ---')
    survives('- + -\né')
  })
  it('a star between spaces does not join the closing one when the space moves out', () => {
    survives('*\\ * <u></u>*')
    survives('*3 * **:** ~*')
  })
  it('a break at the start of a paragraph, or with only spaces after it, is no break', () => {
    survives('><u>\\\n</u><div>')
    survives('a  \n<u> </u>')
  })
  it('a tag that a break or a newline leaves at the start of a line stays a line of its paragraph', () => {
    survives('><u>a\\\n</u><div>')
    survives('- <u>x\\\n</u><u>')
    survives('<u>-\n</u><div>')
    survives('_<\n<u></u>_')
  })
  it('text kept as written never pairs, opens a line as a block, or follows a blank line', () => {
    survives('**<u>g*</u>*')
    survives('<u></u><u>\n*')
    survives('<u><u></u>\n[')
    survives('+ *h\n   *<div>**  ')
    survives('é\n<u>\n</u>x')
    survives('- [\n<u>>\n\n      </u>  ')
  })
  it('text after a line break in a paragraph is escaped as if at the start of a line, spaces or not', () => {
    survives('- ^<u>\n</u> #')
    survives('3) ]\n<u> </u>>')
  })
  it('a tag alone on its line, spaces after it, is escaped at the start of a paragraph', () => {
    survives('<b> <u></u>\n*')
  })
  it('a paragraph never starts with a newline (`- [x] ` and then nothing would be a plain item)', () => {
    survives('- [x] <u>\n[</u>')
  })
  it('two lists in one item or quote take different markers, a heading never ends in a closing `#`', () => {
    survives('>-\n>+ [x] t')
    survives('```\n```\n2. *\n   - [x] b')
    survives('t # <u></u>\n=')
  })
  it('a line of text kept as written that would start a list is indented, and a tag alone on a line too', () => {
    survives('>`\n    1. `')
    survives('- <u>=\\\n</u><b>')
  })
  it('a list after a block that is not a paragraph is parted from it by a blank line', () => {
    survives('- <u>\n\n  + t')
  })
  it('a list under a line of text does not make it a table (`- |`)', () => {
    survives('3) [\n   + |')
  })
  it('blocks that touched, and no longer read as the same blocks, are parted', () => {
    survives('h\n2) \n-')
  })
  it('text that marked cannot read at all is one block, kept as written', () => {
    const md = '- <\n  >+\n[' // `marked` throws on this
    expect(() => Lexer.lex(md)).toThrow()
    expect(toBody(bodyToDoc(md))).toBe(md)
    expect(text(md)).toEqual([md])
  })
})
