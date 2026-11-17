// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { schema } from '../extensions'
import { bodyToDoc, docToBody } from './body'
import { parseMarkdown } from './parse'

// Tables and footnotes as nodes (ADR-0007): what is read, what is kept as written, and that an
// edit beside them, or in them, changes only what it should.

const toBody = (doc: JSONContent) => docToBody(schema.nodeFromJSON(doc))
const forget = (b: JSONContent): JSONContent => ({ ...b, attrs: { ...b.attrs, sig: null } })
/** Block `i` written again from its words, as an edit of it would: the rest of the file untouched. */
const touch = (md: string, i: number) => {
  const doc = bodyToDoc(md)
  doc.content![i] = forget(doc.content![i]!)
  return toBody(doc)
}
const types = (md: string) => bodyToDoc(md).content!.map((b) => b.type)
const first = (md: string) => schema.nodeFromJSON(bodyToDoc(md).content![0]!)
const text = (md: string) => bodyToDoc(md).content!.map((b) => schema.nodeFromJSON(b).textContent)

describe('a table', () => {
  it('written again keeps its cells, escaped pipes, marks, alignment and empty cells', () => {
    const md = '| a \\| b | `x\\|y` | **c** |\n| :-- | :-: | --: |\n| | [l](u) | 3 |\n'
    expect(touch(md, 0)).toBe(
      [
        '| a \\| b | `x\\|y` | **c** |',
        '| :----- | :----: | ----: |',
        '|        | [l](u) |     3 |',
        '',
      ].join('\n'),
    )
  })
  it('reads back as the table it was written from', () => {
    const md = '| a \\| b | `x\\|y` | **c** |\n| :-- | :-: | --: |\n| | [l](u) | 3 |\n'
    const out = touch(md, 0)
    expect(types(out)).toEqual(['table'])
    expect(touch(out, 0)).toBe(out)
    const cell = (m: string, r: number, c: number) => first(m).child(r).child(c)
    expect(cell(out, 0, 0).textContent).toBe('a | b')
    expect(cell(out, 0, 1).textContent).toBe('`x|y`')
    expect([0, 1, 2].map((c) => cell(out, 0, c).attrs.align)).toEqual(['left', 'center', 'right'])
    expect(cell(out, 1, 0).textContent).toBe('')
  })
  it('puts the header cells in the first row and plain cells under it', () => {
    const t = first('| a | b |\n| - | - |\n| 1 | 2 |\n')
    expect(t.child(0).child(0).type.name).toBe('tableHeader')
    expect(t.child(1).child(0).type.name).toBe('tableCell')
  })
  it('pads a short row, so the rows are as wide as the header', () => {
    const t = first('| a | b |\n| - | - |\n| 1 |\n')
    expect(t.child(1).childCount).toBe(2)
  })
  it('is kept as written when a row has cells the header has not: `marked` would drop them', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 | 3 |\n'
    expect(types(md)).toEqual(['rawBlock'])
    expect(text(md)).toEqual(['| a | b |\n| - | - |\n| 1 | 2 | 3 |'])
    // An unescaped pipe in a code span splits a cell too, whatever it looks like.
    expect(types('| a | b |\n| - | - |\n| `x|y` | 2 |\n')).toEqual(['rawBlock'])
  })
  it('keeps its cells when code in one holds a backslash and a pipe, which a cell cannot write', () => {
    const doc = bodyToDoc('| h | i |\n| - | - |\n| x | z |\n')
    doc.content![0]!.content![1]!.content![0]!.content = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '`a\\|b`', marks: [{ type: 'verbatim' }] }],
      },
    ]
    const out = toBody(doc)
    expect(out).toContain('| `a\\&#124;b` | z')
    expect(types(out)).toEqual(['table'])
    expect(first(out).child(1).childCount).toBe(2)
    expect(touch(out, 0)).toBe(out)
  })
  it('does not escape a cell as if it began a line', () => {
    // `-`, `|-` and `#` at the start of a line mean something; in a cell they are words.
    const doc = bodyToDoc('| a | b | c |\n| - | - | - |\n| - | \\|- | # |\n')
    doc.content![0] = forget(doc.content![0]!)
    const out = toBody(doc)
    expect(out).toContain('| a   | b   | c   |\n| --- | --- | --- |\n| -   | \\|- | #   |')
    expect(touch(out, 0)).toBe(out)
  })
  it('is written on one line a row even when a cell holds a line break', () => {
    const doc = bodyToDoc('| a | b |\n| - | - |\n| 1 | 2 |\n')
    const cell = doc.content![0]!.content![1]!.content![0]!
    cell.content = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'one' },
          { type: 'hardBreak' },
          { type: 'text', text: 'two\nthree' },
        ],
      },
    ]
    const out = toBody(doc)
    expect(out).toContain('| one two three | 2   |')
    expect(types(out)).toEqual(['table'])
  })
  it('does not stretch its columns for one long cell', () => {
    const long = 'x'.repeat(80)
    const out = touch(`| a | b |\n| - | - |\n| ${long} | 2 |\n| s | t |\n`, 0)
    expect(out.split('\n')[3]).toBe(`| s${' '.repeat(39)} | t   |`)
  })
  it('keeps the blocks around it as read when it is edited', () => {
    const md = 'Before.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n\n\nAfter.\n'
    expect(touch(md, 1)).toBe(
      'Before.\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n\n\nAfter.\n',
    )
  })
})

describe('a footnote', () => {
  it('is a reference node and a note node, tied by the file’s own label', () => {
    const md = 'Text[^a] and more[^1].\n\n[^a]: The note.\n'
    const doc = bodyToDoc(md)
    expect(doc.content!.map((b) => b.type)).toEqual(['paragraph', 'footnoteDef'])
    const refs = doc.content![0]!.content!.filter((n) => n.type === 'footnoteRef')
    expect(refs.map((r) => r.attrs!.label)).toEqual(['a', '1'])
    expect(doc.content![1]!.attrs!.label).toBe('a')
    expect(toBody(doc)).toBe(md)
  })
  it('keeps a reference’s words in the text (what reads the text sees `[^1]`)', () => {
    expect(text('Text[^1].\n')).toEqual(['Text[^1].'])
  })
  it('reads several notes to a paragraph, and each is its own block that is written as read', () => {
    const md = '[^a]: One\n[^b]: Two\n[^c]: https://e.com\n'
    expect(types(md)).toEqual(['footnoteDef', 'footnoteDef', 'footnoteDef'])
    expect(toBody(bodyToDoc(md))).toBe(md)
    // Editing one parts it from the next; the others are as read.
    expect(touch(md, 1)).toBe('[^a]: One\n\n[^b]: Two\n\n[^c]: https://e.com\n')
  })
  it('holds more paragraphs and a list, indented under it', () => {
    const md = '[^1]: First\n    lazy line\n\n    Second paragraph.\n\n    - item\n'
    const note = first(md)
    expect(note.childCount).toBe(3)
    expect(note.child(0).textContent).toBe('First\nlazy line')
    expect(touch(md, 0)).toBe(md)
  })
  it('keeps the file’s own label and only the author’s edit changes the words', () => {
    const doc = bodyToDoc('A[^note].\n\n[^note]: Old.\n')
    doc.content![1] = {
      ...doc.content![1]!,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New.' }] }],
    }
    expect(toBody(doc)).toBe('A[^note].\n\n[^note]: New.\n')
  })
  it('starts a note that begins with code on the next line, so the code stays code', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'footnoteDef',
          attrs: { label: '1' },
          content: [{ type: 'rawBlock', content: [{ type: 'text', text: '    code' }] }],
        },
      ],
    }
    const out = toBody(doc)
    expect(out).toBe('[^1]:\n        code\n')
    expect(bodyToDoc(out).content![0]!.content![0]!.type).toBe('rawBlock')
  })
  it('does not turn what follows a reference into a link or a note', () => {
    const doc = bodyToDoc('x\n')
    doc.content![0] = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'a' },
        { type: 'footnoteRef', attrs: { label: '1' } },
        { type: 'text', text: '(x) and ' },
        { type: 'footnoteRef', attrs: { label: '2' } },
        { type: 'text', text: ': y' },
      ],
    }
    const out = toBody(doc)
    expect(out).toBe('a[^1]\\(x) and [^2]: y\n')
    const again = bodyToDoc(out).content![0]!
    expect(again.content!.filter((n) => n.type === 'footnoteRef')).toHaveLength(2)
    expect(schema.nodeFromJSON(again).textContent).toBe('a[^1](x) and [^2]: y')
  })
  it('keeps a reference’s mark: `**a[^1]**` is still bold', () => {
    const md = '**a[^1] b**\n'
    const para = bodyToDoc(md).content![0]!
    expect(para.content!.every((n) => n.marks?.some((m) => m.type === 'bold'))).toBe(true)
    expect(touch(md, 0)).toBe(md)
  })
  it('a reference in text with a note that is only an address is a reference, not a link', () => {
    const md = 'See [a [^1] b](https://e.com) and[^1].\n\n[^1]: https://example.com\n'
    const para = bodyToDoc(md).content![0]!.content!
    expect(para.filter((n) => n.type === 'footnoteRef')).toHaveLength(2)
    expect(para.some((n) => n.marks?.some((m) => m.type === 'link'))).toBe(true)
  })
  it('a note that reads otherwise once a blank line stands before it is left as written', () => {
    // After a blank line `2) …` is a list and the second note would end at its first line, so
    // these notes are not split: an edit beside them cannot change how they read.
    const md = '[^1]: two words\n[^2]: https://e.com\n2) b\n'
    expect(types(md)).toEqual(['rawBlock'])
    expect(touch(md, 0)).toBe(md)
  })
  it('a lazy line after a note whose first line looks like a link definition is the note’s', () => {
    // `marked` sets `continued…` apart as a paragraph; in the file it belongs to the note.
    const md = '[^1]: word\ncontinued line here\n'
    expect(types(md)).toEqual(['footnoteDef'])
    expect(first(md).textContent).toBe('word\ncontinued line here')
    expect(touch(md, 0)).toBe('[^1]: word\n    continued line here\n')
  })
  it.each(['né', 'a.b', 'note_1', 'ångström', '1-2'])(
    'has a label like [^%s]: kept on an edit, never escaped, and read back as a reference and a note',
    (label) => {
      const md = `Text[^${label}] more.\n\n[^${label}]: The note.\n`
      expect(types(md)).toEqual(['paragraph', 'footnoteDef'])
      expect(bodyToDoc(md).content![1]!.attrs!.label).toBe(label)
      const out = touch(md, 0)
      expect(out).toBe(md)
      expect(touch(md, 1)).toBe(md)
      expect(
        bodyToDoc(out).content![0]!.content!.filter((n) => n.type === 'footnoteRef'),
      ).toHaveLength(1)
    },
  )
  it('is parted from indented code by a comment when the paragraph between them is deleted', () => {
    const md = '[^1]: Note.\n\nMiddle.\n\n    code line\n'
    expect(types(md)).toEqual(['footnoteDef', 'paragraph', 'rawBlock'])
    const doc = bodyToDoc(md)
    doc.content!.splice(1, 1)
    const out = toBody(doc)
    expect(out).toBe('[^1]: Note.\n\n<!-- -->\n\n    code line\n')
    // The code did not become a part of the note, and a note beside code that was not parted is untouched.
    expect(types(out)).toEqual(['footnoteDef', 'rawBlock', 'rawBlock'])
    expect(first(out).childCount).toBe(1)
    expect(toBody(bodyToDoc(out))).toBe(out)
    // Other spacing in the file is left as it was.
    const more = bodyToDoc(`A.\n\n\n\n${md}`)
    more.content!.splice(2, 1)
    expect(toBody(more)).toBe('A.\n\n\n\n[^1]: Note.\n\n<!-- -->\n\n    code line\n')
  })
  it('what is not at the start of a line, or has an exotic label, is kept as it was', () => {
    expect(types('Text\n  [^1]: x\n')).toEqual(['paragraph'])
    expect(types('[^a\\b]: x\n')).toEqual(['rawBlock'])
  })
})

describe('a file with Windows line endings', () => {
  it('is written in CRLF throughout when a table or a note in it is changed, and reads back exactly', () => {
    const md = 'Text[^1].\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n[^1]: Note\n\n    More.\n'.replace(
      /\n/g,
      '\r\n',
    )
    for (const i of [1, 2]) {
      const out = touch(md, i)
      expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
      expect(parseMarkdown(out).exact).toBe(true)
      expect(toBody(bodyToDoc(out))).toBe(out)
    }
    expect(touch(md, 1)).toBe(
      'Text[^1].\r\n\r\n| a   | b   |\r\n| --- | --- |\r\n| 1   | 2   |\r\n\r\n[^1]: Note\r\n\r\n    More.\r\n',
    )
  })

  it('is written back as read, tables and notes included', () => {
    const md = 'Text[^1].\n\na | b\n--|--\nc | d\n\n[^1]: Note\n    more.\n\n    Second.\n'.replace(
      /\n/g,
      '\r\n',
    )
    expect(types(md)).toEqual(['paragraph', 'table', 'footnoteDef'])
    expect(toBody(bodyToDoc(md))).toBe(md)
  })
})
