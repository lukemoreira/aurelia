// SPDX-License-Identifier: AGPL-3.0-or-later
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { editorExtensions } from './extensions'
import { bodyToDoc, docToBody } from './markdown/body'
import { markReading, readingUnits, spokenText, unitAt } from './reading'

let editor: Editor | undefined
afterEach(() => editor?.destroy())
const start = (body: string) =>
  (editor = new Editor({ extensions: editorExtensions, content: bodyToDoc(body) }))

describe('spokenText', () => {
  it('says what a reader sees: link words, not IDs, targets or block IDs', () => {
    expect(
      spokenText('Met [[id:chr_01HX|Elena]] and [[Marcus Vane]] and [[Gate|the gate]] ^blk-ab12'),
    ).toBe('Met Elena and Marcus Vane and the gate')
  })
  it('says nothing for a link by ID with no words, or an embedded card', () => {
    expect(spokenText('A [[id:chr_01HX]] b ![[Elena]] c')).toBe('A b c')
  })
  it('keeps an escaped link as the words it is', () => {
    expect(spokenText('\\[[not a link]]')).toBe('\\[[not a link]]')
  })
})

describe('readingUnits', () => {
  const body = `# A heading

First paragraph with a **bold** word and a [link](https://example.com) and a note[^1].

> A quoted line.

- A list item

* * *

| A | B |
| - | - |
| 1 | 2 |

\`\`\`
code is not read
\`\`\`

Last one.

[^1]: The note is not read.
`
  it('is one unit per paragraph a reader sees, without marks, notes, tables or code', () => {
    const units = readingUnits(start(body).state.doc)
    expect(units.map((u) => u.text)).toEqual([
      'A heading',
      'First paragraph with a bold word and a link and a note.',
      'A quoted line.',
      'A list item',
      'Last one.',
    ])
  })
  it('puts a hard break between words, and skips an empty paragraph', () => {
    const ed = start('one\\\ntwo\n\n \n')
    expect(readingUnits(ed.state.doc).map((u) => u.text)).toEqual(['one two'])
  })
  it('starts at the paragraph holding the caret, or the next one with words', () => {
    const ed = start('One.\n\nTwo.\n\n* * *\n\nThree.\n')
    const units = readingUnits(ed.state.doc)
    expect(unitAt(units, 2)).toBe(0)
    expect(unitAt(units, units[1]!.from + 1)).toBe(1)
    // On the scene break: the next paragraph.
    const brk = units[1]!.to + 1
    expect(unitAt(units, brk)).toBe(2)
    expect(unitAt(units, units[2]!.to)).toBe(-1)
  })
})

describe('markReading', () => {
  it('marks a paragraph without changing the text or counting as an edit', () => {
    const ed = start('One.\n\nTwo.\n')
    const before = JSON.stringify(ed.getJSON())
    const changed: boolean[] = []
    ed.on('transaction', ({ transaction }) => changed.push(transaction.docChanged))
    const [, two] = readingUnits(ed.state.doc)
    markReading(ed.view, two!)
    expect(ed.view.dom.querySelectorAll('.reading-now')).toHaveLength(1)
    expect(ed.view.dom.querySelector('.reading-now')?.textContent).toBe('Two.')
    expect(JSON.stringify(ed.getJSON())).toBe(before)
    expect(docToBody(ed.state.doc)).toBe('One.\n\nTwo.\n')
    expect(changed).toEqual([false])
    markReading(ed.view, null)
    expect(ed.view.dom.querySelector('.reading-now')).toBeNull()
  })
})
