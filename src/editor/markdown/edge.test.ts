// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { schema } from '../extensions'
import { bodyToDoc, docToBody } from './body'
import { parseMarkdown } from './parse'

// Cases a review found: edits that damaged text next to the one edited, or the edited block itself.

const toBody = (doc: JSONContent) => docToBody(schema.nodeFromJSON(doc))
const forget = (b: JSONContent) => {
  const attrs = { ...b.attrs }
  delete attrs.src
  delete attrs.sig
  return { ...b, attrs }
}
/** Block `i` written again from its words, as an edit of it would: the rest of the file untouched. */
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

describe('blocks that touch in the file', () => {
  it('stay touching when neither was edited: an edit elsewhere does not pad them', () => {
    const md = 'intro\n\n# Scene\nThe bells rang.\n\n* * *\n\nEnd.\n'
    expect(touch(md, 0)).toBe(md)
    expect(touch(md, 3)).toBe(md)
    const doc = bodyToDoc(md)
    doc.content![0] = { type: 'paragraph', content: [t('Intro changed.')] }
    expect(toBody(doc)).toBe(md.replace('intro', 'Intro changed.'))
  })

  it('are parted when one of them is written again: a heading made a paragraph above a rule', () => {
    const doc = bodyToDoc('# Head\n---\ntext\n')
    expect(doc.content!.map((b) => b.type)).toEqual(['heading', 'sceneBreak', 'paragraph'])
    doc.content![0] = para(t('Head'))
    const out = toBody(doc)
    expect(out).toBe('Head\n\n---\ntext\n')
    expect(types(out)).toEqual(['paragraph', 'sceneBreak', 'paragraph'])
  })

  it('are parted when what lay between them is gone, or they would run into one paragraph', () => {
    const doc = bodyToDoc('intro\n# Scene\n\nMore text.\n')
    doc.content!.splice(1, 1) // the heading is deleted
    expect(toBody(doc)).toBe('intro\n\nMore text.\n')
  })
})

describe('a list', () => {
  it.each(['- [ ] a\n\n- [x] b\n', '1. [ ] a\n\n2. b\n', '- a\n\n- b\n', '3. a\n\n4. b\n'])(
    'written again keeps its blank lines and its checkboxes once: %j',
    (md) => {
      expect(touch(md, 0)).toBe(md)
    },
  )

  it('with a kept list above it takes a marker that differs from that list’s own', () => {
    for (const [above, fresh] of [
      ['* a\n', 'bulletList'],
      ['+ a\n', 'bulletList'],
      ['- a\n', 'taskList'],
      ['1) a\n', 'orderedList'],
    ] as const) {
      const doc = bodyToDoc(above)
      const item = { type: fresh === 'taskList' ? 'taskItem' : 'listItem', content: [para(t('b'))] }
      doc.content!.push({ type: fresh, content: [item] })
      const out = toBody(doc)
      expect(types(out), JSON.stringify(out)).toEqual([types(above)[0], fresh])
    }
  })

  it('with a kept list below it takes a marker that differs from that list’s own', () => {
    const doc = bodyToDoc('- b\n')
    doc.content!.unshift({
      type: 'bulletList',
      content: [{ type: 'listItem', content: [para(t('a'))] }],
    })
    expect(types(toBody(doc))).toEqual(['bulletList', 'bulletList'])
  })

  it.each([
    '- # Heading\n',
    '1. > quote\n',
    '- - nested\n',
    '- ```\n  code\n  ```\n',
    '* [x] box\n',
  ])('whose first block is not a paragraph stays inside its item: %j', (md) => {
    const out = touch(md, 0)
    expect(out).toBe(md.replace(/^\* /, '- '))
    expect(types(out)).toHaveLength(1)
  })
})

describe('a checklist item whose text begins with a bracket', () => {
  // `marked` reads the item's text once more with the checkbox still in it (found by the fuzz).
  it.each([
    ['- [ ] [\n|||\n-|-\n[x] t', '[|||\n-|-\n[x] t'],
    ['- [ ] [\n[x] t\n', '[\n[x] t'],
    // A box typed as text after the real one is a word, and is kept once.
    ['- [x] [ ] [\n|||\n-|-\n', '[ ] [|||\n-|-'],
  ])('does not take the checkbox into its words: %j', (md, words) => {
    expect(text(md)).toEqual([words])
    expect(text(touch(md, 0))).toEqual([words])
  })
})

describe('an item with lazy lines that `marked` reads with a blank line in them', () => {
  // Found by the fuzz: `- a`, a line of `=`, then a line that starts like a footnote.
  it.each(['- a\n=\n[^1]: b', '2. E\n=\n[^1]:*', '- `\n=\n[^1]:*'])(
    'stays one paragraph, and no footnote block is made of its last line: %j',
    (md) => {
      const out = touch(md, 0)
      expect(types(out)).toEqual(types(md))
      expect(text(out)).toEqual(text(md))
      expect(bodyToDoc(out).content![0]!.content![0]!.content!.map((b) => b.type)).toEqual([
        'paragraph',
      ])
    },
  )
})

describe('a paragraph that starts like a footnote’s definition', () => {
  it('is written with its colon escaped, so it reads back as the paragraph it is', () => {
    const out = toBody({ type: 'doc', content: [para(t('[^1]: not a note'))] })
    expect(out).toBe('[^1]\\: not a note\n')
    expect(types(out)).toEqual(['paragraph'])
    expect(text(out)).toEqual(['[^1]: not a note'])
  })
  it('stays a paragraph in an item next to a heading that ran over two lines (found by the fuzz)', () => {
    const md = '- `\na\n=\n[^1]:* *'
    // (the heading that ran over two lines is written on one)
    expect(text(touch(md, 0)).map((w) => w.replace(/\s+/g, ''))).toEqual(
      text(md).map((w) => w.replace(/\s+/g, '')),
    )
    expect(types(touch(md, 0))).toEqual(['bulletList'])
    expect(bodyToDoc(touch(md, 0)).content![0]!.content![0]!.content!.map((b) => b.type)).toEqual([
      'paragraph',
      'heading',
      'paragraph',
    ])
  })
})

describe('a hard break', () => {
  const br: JSONContent = { type: 'hardBreak' }
  const one = (...parts: JSONContent[]) => toBody({ type: 'doc', content: [para(...parts)] })

  it('at the end of a paragraph is not written, or it reads as a backslash', () => {
    expect(one(t('a'), br)).toBe('a\n')
    expect(text(one(t('a'), br))).toEqual(['a'])
  })

  it('after a bare address is two spaces, or the address swallows the backslash', () => {
    const out = one(t('see https://x.y'), br, t('next'))
    expect(out).toBe('see https://x.y  \nnext\n')
    expect(bodyToDoc(out).content![0]!.content!.map((n) => n.type)).toContain('hardBreak')
  })

  it('elsewhere is a backslash, and in a heading a space', () => {
    expect(one(t('a'), br, t('b'))).toBe('a\\\nb\n')
    const out = toBody({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [t('a'), br, t('b')] }],
    })
    expect(out).toBe('## a b\n')
    expect(types(out)).toEqual(['heading'])
  })

  it('in a heading that ran over two lines is written on one', () => {
    const md = 'Title\nruns on\n===\n\nBody.\n'
    expect(types(md)).toEqual(['heading', 'paragraph'])
    expect(types(touch(md, 0))).toEqual(['heading', 'paragraph'])
  })
})

describe('a mark beside punctuation and a letter', () => {
  const marks = (md: string) =>
    bodyToDoc(md).content![0]!.content!.map((n) => [n.text, n.marks?.map((m) => m.type)])

  it('does not take the punctuation in when a letter follows: **hello.**She would read back as asterisks', () => {
    const out = toBody({ type: 'doc', content: [para(t('hello.', 'bold'), t('She'))] })
    expect(out).toBe('**hello**.She\n')
    expect(marks(out)).toEqual([
      ['hello', ['bold']],
      ['.She', undefined],
    ])
  })

  it('does not begin on punctuation that follows a letter either', () => {
    const out = toBody({ type: 'doc', content: [para(t('She'), t('"Hi,"', 'italic'))] })
    expect(out).toBe('She"*Hi,"*\n')
    expect(marks(out)).toEqual([
      ['She"', undefined],
      ['Hi,"', ['italic']],
    ])
  })

  it('keeps an escaped character whole when it moves out, and a link whole', () => {
    expect(toBody({ type: 'doc', content: [para(t('a*', 'bold'), t('b'))] })).toBe('**a**\\*b\n')
    const link: JSONContent = {
      type: 'text',
      text: 'see.',
      marks: [{ type: 'link', attrs: { href: 'https://x.y' } }],
    }
    expect(toBody({ type: 'doc', content: [para(link, t('Then'))] })).toBe(
      '[see](https://x.y).Then\n',
    )
  })

  it('is left plain when it holds nothing but punctuation', () => {
    expect(toBody({ type: 'doc', content: [para(t('a'), t('!?', 'bold'), t('b'))] })).toBe('a!?b\n')
  })

  it('is untouched when a space or the end follows', () => {
    expect(toBody({ type: 'doc', content: [para(t('hello.', 'bold'), t(' She'))] })).toBe(
      '**hello.** She\n',
    )
    expect(toBody({ type: 'doc', content: [para(t('hello.', 'bold'))] })).toBe('**hello.**\n')
  })
})

describe('the text read, as to line endings', () => {
  it('is exact for a text whose lines all end in CRLF, which is written back as read', () => {
    const md = 'First.\r\n\r\nSecond.\r\n\r\n* * *\r\n\r\n- a\r\n- b\r\n'
    expect(parseMarkdown(md).exact).toBe(true)
    const doc = bodyToDoc(md)
    expect(doc.content![0]!.attrs!.src).toBe('First.\r\n\r\n')
    expect(toBody(doc)).toBe(md)
  })

  it('keeps the CRLF of every block but the edited one', () => {
    const md = 'First.\r\n\r\nSecond.\r\n'
    const doc = bodyToDoc(md)
    doc.content![0] = { ...doc.content![0]!, content: [t('Changed.')] } // keeps its memory of the file
    expect(toBody(doc)).toBe('Changed.\r\n\r\nSecond.\r\n')
  })

  it('is not exact for a mix of endings: nothing is kept as read, and nothing is lost', () => {
    const md = 'a\r\n\r\nb\n\nc'
    expect(parseMarkdown(md).exact).toBe(false)
    expect(text(md)).toEqual(['a', 'b', 'c'])
  })

  it('is exact for plain text and for an empty one', () => {
    expect(parseMarkdown('a\n\nb').exact).toBe(true)
    expect(parseMarkdown('').exact).toBe(true)
    expect(parseMarkdown('\n\n').exact).toBe(true)
  })
})
