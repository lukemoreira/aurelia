// SPDX-License-Identifier: AGPL-3.0-or-later
import { Editor } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { editorExtensions } from './extensions'
import { bodyToDoc, docToBody } from './markdown/body'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

const start = (body = '') => {
  editor = new Editor({ extensions: editorExtensions, content: bodyToDoc(body) })
  return editor
}
const written = (ed: Editor) => docToBody(ed.state.doc)
const key = (ed: Editor, name: string, mods: KeyboardEventInit = {}) =>
  ed.view.someProp('handleKeyDown', (f) =>
    f(ed.view, new KeyboardEvent('keydown', { key: name, ...mods })),
  )
/** Put the caret in the first place that holds `needle`, `at` characters into it. */
function caretIn(ed: Editor, needle: string, at = needle.length) {
  let found = -1
  ed.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText || !node.text!.includes(needle)) return
    found = pos + node.text!.indexOf(needle) + at
  })
  if (found < 0) throw new Error(`no ${needle}`)
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, found)))
}
const type = (ed: Editor, text: string) => {
  const { from, to } = ed.state.selection
  ed.view.dispatch(ed.state.tr.insertText(text, from, to))
}
const numbers = (ed: Editor, selector: string) =>
  [...ed.view.dom.querySelectorAll(selector)].map((e) => e.getAttribute('data-number'))

describe('inserting a footnote', () => {
  it('puts a reference at the caret and an empty note after the text, with the caret in it', () => {
    const ed = start('Hello world.\n')
    caretIn(ed, 'Hello world')
    expect(ed.commands.insertFootnote()).toBe(true)
    type(ed, 'The note.')
    expect(written(ed)).toBe('Hello world[^1].\n\n[^1]: The note.\n')
    expect(ed.state.selection.$from.parent.textContent).toBe('The note.')
  })

  it('takes a label nothing uses, and never renames the labels there are', () => {
    const ed = start('A[^5] and B[^2].\n\n[^5]: Five.\n\n[^2]: Two.\n')
    caretIn(ed, 'A')
    ed.commands.insertFootnote()
    // Before the others, so it is the first by place and the last by label.
    expect(written(ed)).toMatch(/^A\[\^6\]\[\^5\] and B\[\^2\]\./)
    expect(written(ed)).toContain('[^5]: Five.\n\n[^2]: Two.\n\n[^6]:')
    expect(numbers(ed, '[data-footnote-ref]')).toEqual(['1', '2', '3'])
    expect(numbers(ed, '[data-footnote-def]')).toEqual(['2', '3', '1'])
  })

  it('adds the note after the last note, not at the end of what comes after', () => {
    const ed = start('A.\n\n[^1]: One.\n\nAfter the notes.\n')
    caretIn(ed, 'A.', 1)
    ed.commands.insertFootnote()
    expect(written(ed)).toBe('A[^2].\n\n[^1]: One.\n\n[^2]:\n\nAfter the notes.\n')
  })

  it('is not offered inside a note, or where a reference cannot stand', () => {
    const ed = start('A.\n\n[^1]: One.\n\n```\ncode\n```\n')
    caretIn(ed, 'One')
    expect(ed.can().insertFootnote()).toBe(false)
    caretIn(ed, 'code')
    expect(ed.can().insertFootnote()).toBe(false)
    caretIn(ed, 'A.')
    expect(ed.can().insertFootnote()).toBe(true)
  })

  it('shows the note’s words and a name for a screen reader on its reference', () => {
    const ed = start('Text[^a].\n\n[^a]: The note\ncontinues.\n')
    const ref = ed.view.dom.querySelector('[data-footnote-ref]')!
    expect(ref.getAttribute('data-number')).toBe('1')
    expect(ref.getAttribute('data-note')).toBe('The note continues.')
    expect(ref.getAttribute('aria-label')).toBe('Footnote 1: The note continues.')
  })

  it('says so when a reference has no note, and numbers a note nothing refers to by its label', () => {
    const ed = start('Text[^a].\n\n[^b]: Orphan.\n')
    expect(ed.view.dom.querySelector('[data-footnote-ref]')!.getAttribute('data-note')).toBe(
      'No note yet',
    )
    expect(numbers(ed, '[data-footnote-def]')).toEqual(['b'])
  })

  it('draws the same number for references to one label, and changes nothing in the file', () => {
    const body = 'A[^x] B[^y] C[^x].\n\n[^x]: X.\n\n[^y]: Y.\n'
    const ed = start(body)
    expect(numbers(ed, '[data-footnote-ref]')).toEqual(['1', '2', '1'])
    expect(written(ed)).toBe(body)
  })
})

describe('a reference', () => {
  const texts = (ed: Editor) =>
    [...ed.view.dom.querySelectorAll('[data-footnote-ref]')].map((e) => e.textContent)

  it('has its number as real text, and it follows the references when one is added before', () => {
    const ed = start('A[^x] B[^y].\n\n[^x]: X.\n\n[^y]: Y.\n')
    expect(texts(ed)).toEqual(['1', '2'])
    caretIn(ed, 'A', 0)
    ed.commands.insertFootnote()
    expect(texts(ed)).toEqual(['1', '2', '3'])
    expect(numbers(ed, '[data-footnote-ref]')).toEqual(['1', '2', '3'])
  })

  it('goes to its note with Alt+Down and back with Alt+Up, by the keyboard alone', () => {
    const ed = start('A[^x] B.\n\n[^x]: The note.\n')
    const alt = (name: string) => key(ed, name, { altKey: true })
    ed.commands.setNodeSelection(2)
    expect(ed.state.selection.constructor.name).toBe('NodeSelection')
    expect(alt('ArrowDown')).toBe(true)
    expect(ed.state.selection.$from.parent.textContent).toBe('The note.')
    expect(alt('ArrowUp')).toBe(true)
    expect(ed.state.selection.constructor.name).toBe('NodeSelection')
    expect(
      (ed.state.selection as unknown as { node: { type: { name: string } } }).node.type.name,
    ).toBe('footnoteRef')
    // Neither does anything where there is nowhere to go.
    caretIn(ed, 'B.', 1)
    expect(alt('ArrowDown')).toBeFalsy()
    expect(alt('ArrowUp')).toBeFalsy()
  })
})

describe('renumbering the footnotes', () => {
  it('is offered only when the labels do not already follow the text', () => {
    expect(start('A[^1] B[^2].\n\n[^1]: a\n\n[^2]: b\n').can().renumberFootnotes()).toBe(false)
    editor!.destroy()
    expect(start('A[^b] B[^a].\n\n[^a]: a\n\n[^b]: b\n').can().renumberFootnotes()).toBe(true)
  })

  it('writes 1, 2, 3 in the order of the references, for notes and references alike, and then the unused notes', () => {
    const ed = start('A[^b] B[^a] C[^b].\n\n[^a]: Aaa.\n\n[^z]: Zzz.\n\n[^b]: Bbb.\n')
    expect(ed.commands.renumberFootnotes()).toBe(true)
    expect(written(ed)).toBe('A[^1] B[^2] C[^1].\n\n[^2]: Aaa.\n\n[^3]: Zzz.\n\n[^1]: Bbb.\n')
  })

  it('does nothing to the file unless it is asked', () => {
    const body = 'A[^b] B[^a].\n\n[^a]: Aaa.\n\n[^b]: Bbb.\n'
    const ed = start(body)
    ed.commands.insertContentAt(0, ' ')
    ed.commands.undo()
    expect(written(ed)).toBe(body)
  })
})

describe('renumbering with text kept as written', () => {
  it.each([
    ['a note in a quote', '> Inside[^b]\n>\n> [^b]: kept.\n'],
    ['a fence', '```\n[^b] in code\n```\n'],
    ['inline code', 'Say `[^b]` aloud.\n'],
  ])('is not offered beside %s, which it could not follow', (_name, extra) => {
    const body = 'A[^b] B[^a].\n\n[^a]: a\n\n[^b]: b\n\n' + extra
    const ed = start(body)
    expect(ed.can().renumberFootnotes()).toBe(false)
    expect(ed.commands.renumberFootnotes()).toBe(false)
    expect(written(ed)).toBe(body)
    editor!.destroy()
    expect(start('A[^b] B[^a].\n\n[^a]: a\n\n[^b]: b\n').can().renumberFootnotes()).toBe(true)
  })
})

describe('a note', () => {
  it('goes with Backspace only when it is empty', () => {
    const ed = start('A[^1].\n\n[^1]: Words.\n')
    caretIn(ed, 'Words.', 0)
    key(ed, 'Backspace')
    expect(written(ed)).toBe('A[^1].\n\n[^1]: Words.\n')
    ed.commands.deleteRange({
      from: ed.state.selection.from,
      to: ed.state.selection.from + 'Words.'.length,
    })
    key(ed, 'Backspace')
    // The note is gone and the paragraph before it is as it was read.
    expect(ed.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(written(ed)).toBe('A[^1].\n\n')
    expect(ed.state.doc.children.some((b) => b.type.name === 'footnoteDef')).toBe(false)
  })

  it('stands at the top of the scene only: a quote or a list item cannot hold one', () => {
    const ed = start('x\n')
    const note = ed.schema.nodes.footnoteDef!.createAndFill()!
    const holds = (name: string) => ed.schema.nodes[name]!.validContent(Fragment.from(note))
    expect(['doc', 'blockquote', 'callout', 'listItem', 'tableCell'].map(holds)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ])
  })
})

describe('a table', () => {
  const rows = (ed: Editor) =>
    ed.state.doc.firstChild!.children.map((r) => r.children.map((c) => c.textContent))

  it('is made with a header row and two more, three columns wide, and the caret in its first cell', () => {
    const ed = start('')
    ed.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
    expect(ed.state.doc.firstChild?.type.name).toBe('table')
    expect(ed.state.doc.firstChild!.child(0).child(0).type.name).toBe('tableHeader')
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(ed.isActive('table')).toBe(true)
  })

  it('has header cells that head their columns', () => {
    const ed = start('| a | b |\n| - | - |\n| 1 | 2 |\n')
    const heads = [...ed.view.dom.querySelectorAll('th')]
    expect(heads.map((h) => h.getAttribute('scope'))).toEqual(['col', 'col'])
    expect(ed.view.dom.querySelector('td')!.hasAttribute('scope')).toBe(false)
  })

  it('moves by Tab, and a Tab in the last cell adds a row', () => {
    const ed = start('| a | b |\n| - | - |\n| 1 | 2 |\n')
    caretIn(ed, 'a')
    key(ed, 'Tab')
    // The next cell's words are selected, as in any table.
    expect(ed.state.selection.$from.parent.textContent).toBe('b')
    caretIn(ed, '2')
    key(ed, 'Tab')
    type(ed, 'new')
    expect(rows(ed)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['new', ''],
    ])
    key(ed, 'Tab', { shiftKey: true })
    expect(ed.state.selection.$from.parent.textContent).toBe('2')
    expect(written(ed)).toBe('| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| new |     |\n')
  })

  it('goes down a row on Enter, and makes one after the last; Shift+Enter makes no line break', () => {
    const ed = start('| a | b |\n| - | - |\n| 1 | 2 |\n')
    caretIn(ed, 'b')
    key(ed, 'Enter')
    expect(ed.state.selection.$from.parent.textContent).toBe('2')
    key(ed, 'Enter')
    type(ed, 'z')
    expect(rows(ed)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['', 'z'],
    ])
    expect(key(ed, 'Enter', { shiftKey: true })).toBe(true)
    expect(JSON.stringify(ed.getJSON())).not.toContain('hardBreak')
  })

  it('aligns the column under the caret, and writes it in the rule', () => {
    const ed = start('| a | b |\n| - | - |\n| 1 | 2 |\n')
    caretIn(ed, '2')
    expect(ed.commands.setColumnAlign('right')).toBe(true)
    expect(written(ed)).toBe('| a   |   b |\n| --- | --: |\n| 1   |   2 |\n')
    ed.commands.setColumnAlign('center')
    expect(written(ed)).toContain('| --- | :-: |')
    // Back to what was read: the table is written as it was in the file.
    ed.commands.setColumnAlign(null)
    expect(written(ed)).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n')
  })

  it('adds and removes rows and columns, and the first row is always the header', () => {
    const ed = start('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n')
    caretIn(ed, 'a')
    ed.commands.deleteRow()
    // The old second row is the header now: a table has no other kind of first row.
    expect(ed.state.doc.firstChild!.child(0).child(0).type.name).toBe('tableHeader')
    expect(ed.state.doc.firstChild!.child(1).child(0).type.name).toBe('tableCell')
    expect(written(ed)).toBe('| 1   | 2   |\n| --- | --- |\n| 3   | 4   |\n')
    caretIn(ed, '1')
    ed.commands.addColumnAfter()
    ed.commands.addRowAfter()
    expect(rows(ed)).toEqual([
      ['1', '', '2'],
      ['', '', ''],
      ['3', '', '4'],
    ])
    expect(types(ed)).toEqual(['table'])
  })
})

const types = (ed: Editor) =>
  ed.state.doc.children.map((b) => b.type.name).filter((t) => t !== 'paragraph')
