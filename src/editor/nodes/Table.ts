// SPDX-License-Identifier: AGPL-3.0-or-later
import { Extension, mergeAttributes, type AnyExtension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { CellSelection, TableMap, addRowAfter, cellAround } from '@tiptap/pm/tables'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'

export type ColumnAlign = 'left' | 'center' | 'right' | null

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableRules: {
      /** Align the column under the caret; `null` clears it. */
      setColumnAlign: (align: ColumnAlign) => ReturnType
    }
  }
}

/**
 * A GFM table: a header row, then rows, and in each cell one paragraph (a cell holds inline
 * text only). Merged cells have no Markdown, so none can be made.
 */
export const tableNodes: AnyExtension[] = [
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader.extend({
    content: 'paragraph',
    // The header row heads its columns: a screen reader says which one a cell is under.
    renderHTML({ HTMLAttributes }) {
      const attributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        scope: 'col',
      })
      for (const span of ['colspan', 'rowspan']) if (attributes[span] === 1) delete attributes[span]
      return ['th', attributes, 0]
    },
  }),
  TableCell.extend({ content: 'paragraph' }),
]

/** The cell under the caret: where its table starts, the table, and the cell's column. */
function cellAt(state: EditorState) {
  const { selection } = state
  const $cell =
    selection instanceof CellSelection ? selection.$anchorCell : cellAround(selection.$head)
  if (!$cell) return null
  const table = $cell.node(-1)
  const start = $cell.start(-1)
  const map = TableMap.get(table)
  return { table, start, map, col: map.colCount($cell.pos - start), $cell }
}

/** The alignment of the column under the caret, as its header says. */
export function columnAlign(state: EditorState): ColumnAlign {
  const at = cellAt(state)
  if (!at) return null
  const header = at.table.nodeAt(at.map.map[at.col]!)
  return (header?.attrs.align as ColumnAlign) ?? null
}

/** Only the first row of a Markdown table is its header, and every other row holds plain cells. */
function normalizeHeaders(
  tr: Transaction,
  table: Node,
  pos: number,
  types: { header: Node['type']; cell: Node['type'] },
) {
  table.forEach((row, rowOffset, r) => {
    row.forEach((cell, cellOffset) => {
      const want = r === 0 ? types.header : types.cell
      if (cell.type !== want) tr.setNodeMarkup(pos + 1 + rowOffset + 1 + cellOffset, want)
    })
  })
}

export const TableRules = Extension.create({
  name: 'tableRules',

  addCommands() {
    return {
      setColumnAlign:
        (align) =>
        ({ state, tr, dispatch }) => {
          const at = cellAt(state)
          if (!at) return false
          if (dispatch) {
            for (let row = 0; row < at.map.height; row++) {
              const pos = at.start + at.map.map[row * at.map.width + at.col]!
              const cell = tr.doc.nodeAt(pos)
              if (cell && cell.attrs.align !== align)
                tr.setNodeMarkup(pos, undefined, { ...cell.attrs, align })
            }
            dispatch(tr)
          }
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      // A cell is one line: Enter goes down a row (a new one after the last), and no line break is made.
      Enter: ({ editor }) => {
        const { state, view } = editor
        const at = cellAt(state)
        if (!at) return false
        const { map, start, col } = at
        const row = map.findCell(at.$cell.pos - start).top
        if (row + 1 >= map.height && !addRowAfter(state, view.dispatch)) return true
        const next = editor.state
        const target = cellAt(next)
        if (!target) return true
        const below = target.start + target.map.map[(row + 1) * target.map.width + col]!
        view.dispatch(
          next.tr.setSelection(TextSelection.near(next.doc.resolve(below + 1))).scrollIntoView(),
        )
        return true
      },
      'Shift-Enter': ({ editor }) => !!cellAt(editor.state),
      'Mod-Alt-t': ({ editor }) =>
        !editor.isActive('table') &&
        !editor.isActive('footnoteDef') &&
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _before, state) => {
          if (!transactions.some((t) => t.docChanged)) return null
          const header = state.schema.nodes.tableHeader!
          const cell = state.schema.nodes.tableCell!
          const tr = state.tr
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'table') normalizeHeaders(tr, node, pos, { header, cell })
            return node.type.name !== 'paragraph'
          })
          return tr.docChanged ? tr : null
        },
      }),
    ]
  },
})
