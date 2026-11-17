// SPDX-License-Identifier: AGPL-3.0-or-later
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { afterEach, describe, expect, it } from 'vitest'
import { flattenPastedCells, pasteProps } from './paste'
import { editorExtensions } from './extensions'
import { bodyToDoc, docToBody } from './markdown/body'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

const start = (body: string) => {
  editor = new Editor({
    extensions: editorExtensions,
    content: bodyToDoc(body),
    editorProps: pasteProps,
  })
  return editor
}
const written = (ed: Editor) => docToBody(ed.state.doc)
function caretIn(ed: Editor, needle: string, at = needle.length) {
  let found = -1
  ed.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText || !node.text!.includes(needle)) return
    found = pos + node.text!.indexOf(needle) + at
  })
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, found)))
}
const cells = (ed: Editor) =>
  ed.state.doc.firstChild!.children.map((r) => r.children.map((c) => c.textContent))

const GRID = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n'
const UNTOUCHED = [
  ['a', 'b', 'c'],
  ['1', '2', '3'],
  ['4', '5', '6'],
]

describe('pasting into a table cell', () => {
  it('puts lines of text into the one cell, as words, and never into the cells beside it', () => {
    const ed = start(GRID)
    caretIn(ed, '1', 0)
    ed.view.pasteText('x\ny\nz')
    expect(cells(ed)).toEqual([UNTOUCHED[0], ['x y z1', '2', '3'], UNTOUCHED[2]])
  })

  it('takes the words of a pasted list or heading, and the table stays whole', () => {
    const ed = start(GRID)
    caretIn(ed, '5', 1)
    ed.view.pasteHTML('<h2>Head</h2><ul><li>one</li><li>two</li></ul><p>three</p>')
    expect(ed.state.doc.firstChild!.type.name).toBe('table')
    expect(cells(ed)).toEqual([UNTOUCHED[0], UNTOUCHED[1], ['4', '5Head one two three', '6']])
  })

  it('keeps the marks of what is pasted, and a hard break is a space', () => {
    const ed = start(GRID)
    caretIn(ed, 'a', 1)
    ed.view.pasteHTML('<p>one<br>two <b>bold</b></p>')
    expect(written(ed)).toContain('| aone two **bold** |')
  })

  it('goes into the first cell only when several are selected', () => {
    const ed = start(GRID)
    const table = ed.state.doc.firstChild!
    const start1 = 1 + table.child(0).nodeSize // the second row's first cell is at row start + 1
    const first = start1 + 1
    const last = start1 + 1 + table.child(1).child(0).nodeSize + table.child(1).child(1).nodeSize
    ed.view.dispatch(ed.state.tr.setSelection(CellSelection.create(ed.state.doc, first, last)))
    ed.view.pasteText('p\nq')
    expect(cells(ed)).toEqual([UNTOUCHED[0], ['p q', '2', '3'], UNTOUCHED[2]])
  })

  it('leaves a pasted table of cells to the table editing', () => {
    const ed = start(GRID)
    caretIn(ed, '1', 0)
    ed.view.pasteHTML('<table><tr><td>x</td><td>y</td></tr></table>')
    expect(cells(ed)[1]).toEqual(['x', 'y', '3'])
  })

  it('is not asked about text pasted outside a table', () => {
    const ed = start('Words.\n\n' + GRID)
    caretIn(ed, 'Words', 5)
    ed.view.pasteText('a\nb')
    expect(ed.state.doc.childCount).toBeGreaterThan(2)
    expect(written(ed)).toContain('Wordsa\n\nb.')
  })
})

describe('a pasted cell that spans', () => {
  it('leaves empty cells, so the cells after it stay in their columns', () => {
    const html =
      '<table><tr><th colspan="2">Name</th><th>Role</th></tr>' +
      '<tr><td>a</td><td>b</td><td>c</td></tr>' +
      '<tr><td rowspan="2">x</td><td>y</td><td>z</td></tr><tr><td>w</td><td>v</td></tr></table>'
    const doc = new DOMParser().parseFromString(flattenPastedCells(html), 'text/html')
    const rows = [...doc.querySelectorAll('tr')].map((r) =>
      [...r.children].map((c) => c.textContent),
    )
    expect(rows).toEqual([
      ['Name', '', 'Role'],
      ['a', 'b', 'c'],
      ['x', 'y', 'z'],
      ['', 'w', 'v'],
    ])
  })
})
