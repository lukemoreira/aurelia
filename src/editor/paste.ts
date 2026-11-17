// SPDX-License-Identifier: AGPL-3.0-or-later
import { Fragment, Slice, type Node } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import type { EditorView } from '@tiptap/pm/view'

/** What a table cell cannot hold, and what is in the way inside one. */
const IN_A_CELL =
  'p, div, ul, ol, li, h1, h2, h3, h4, h5, h6, blockquote, pre, table, thead, tbody, tfoot, tr, td, th, caption, br'

/**
 * Pasted HTML with each table cell made one line of inline text. A cell in a Markdown table holds
 * words and marks only, so its paragraphs, lists and line breaks become spaces (the words stay,
 * apart from each other). A cell that spans several columns or rows is one cell followed by empty
 * ones, so the cells after it stay in their columns.
 */
export function flattenPastedCells(html: string): string {
  if (!/<t[dh]\b/i.test(html)) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const cell of doc.querySelectorAll('td, th')) {
    // Innermost first, so each element is unwrapped from what is left of its parent.
    for (const el of [...cell.querySelectorAll(IN_A_CELL)].reverse()) {
      if (el.tagName === 'BR') el.replaceWith(' ')
      else el.replaceWith(' ', ...el.childNodes, ' ')
    }
  }
  for (const table of doc.querySelectorAll('table')) {
    // Columns a cell of an earlier row still holds: how many more rows it spans.
    const held = new Map<number, number>()
    for (const row of table.querySelectorAll('tr')) {
      const out: Element[] = []
      let col = 0
      const fill = (tag: string) => {
        while ((held.get(col) ?? 0) > 0) {
          held.set(col, held.get(col)! - 1)
          out.push(doc.createElement(tag))
          col++
        }
      }
      for (const cell of [...row.children]) {
        fill('td')
        const across = Math.max(1, Number(cell.getAttribute('colspan')) || 1)
        const down = Math.max(1, Number(cell.getAttribute('rowspan')) || 1)
        cell.removeAttribute('colspan')
        cell.removeAttribute('rowspan')
        out.push(cell)
        for (let k = 1; k < across; k++) out.push(doc.createElement(cell.tagName))
        if (down > 1) for (let k = 0; k < across; k++) held.set(col + k, down - 1)
        col += across
      }
      fill('td')
      row.replaceChildren(...out)
    }
  }
  return doc.body.innerHTML
}

/** The cell the caret is in, or the first of the cells chosen: where its words are. */
function cellRange(view: EditorView): { from: number; to: number } | null {
  const { selection } = view.state
  if (selection instanceof CellSelection) {
    const pos = selection.$anchorCell.pos
    const cell = selection.$anchorCell.nodeAfter!
    return { from: pos + 2, to: pos + cell.nodeSize - 2 }
  }
  for (let d = selection.$from.depth; d > 0; d--) {
    const role = selection.$from.node(d).type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') return { from: selection.from, to: selection.to }
  }
  return null
}

/**
 * Whether a slice is a table that was copied. Lines of text pasted into a cell are read in the
 * cell's context and so come wrapped in rows and cells too, but never in a table.
 */
function holdsCells(slice: Slice): boolean {
  let found = false
  slice.content.descendants((node) => {
    if (node.type.spec.tableRole === 'table') found = true
    return !found
  })
  return found
}

/**
 * Words pasted into a table cell go into that cell and no other: the lines, paragraphs, items and
 * headings of what was copied are parted by spaces (a cell is one line), keeping the marks. Left
 * to the table editing, extra paragraphs would be read as cells and written over the cells beside.
 * A table copied from a table (cells) is the table editing's to paste.
 */
export function pasteIntoCell(view: EditorView, _event: ClipboardEvent, slice: Slice): boolean {
  const range = cellRange(view)
  if (!range || holdsCells(slice)) return false
  const { schema } = view.state
  const kids: Node[] = []
  slice.content.descendants((node) => {
    if (!node.isTextblock) return true
    if (kids.length) kids.push(schema.text(' '))
    node.forEach((child) => kids.push(child.type.name === 'hardBreak' ? schema.text(' ') : child))
    return false
  })
  if (!kids.length) return true
  const tr = view.state.tr
  tr.setSelection(TextSelection.create(tr.doc, range.from, range.to))
  tr.replaceSelection(new Slice(Fragment.from(kids), 0, 0))
  view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
  return true
}

/** The paste behaviour the editor is given. */
export const pasteProps = {
  transformPastedHTML: flattenPastedCells,
  handlePaste: pasteIntoCell,
}
