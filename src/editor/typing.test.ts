// SPDX-License-Identifier: AGPL-3.0-or-later
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { editorExtensions } from './extensions'
import { bodyToDoc, docToBody } from './markdown/body'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

const start = (body = '') => {
  editor = new Editor({ extensions: editorExtensions, content: bodyToDoc(body) })
  editor.commands.focus('end')
  return editor
}
/** Type one character at a time, so Markdown typing (input rules) sees what a keyboard sends. */
function type(ed: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = ed.state.selection
    const handled = ed.view.someProp('handleTextInput', (f) =>
      f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)),
    )
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to))
  }
}
const enter = (ed: Editor) =>
  ed.view.someProp('handleKeyDown', (f) =>
    f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' })),
  )
const written = (ed: Editor) => docToBody(ed.state.doc)

describe('Markdown typing', () => {
  it.each([
    ['# Title', '# Title\n'],
    ['## Chapter', '## Chapter\n'],
    ['- one', '- one\n'],
    ['* star', '- star\n'],
    ['1. first', '1. first\n'],
    ['> quoted', '> quoted\n'],
    ['[ ] open', '- [ ] open\n'],
    ['[x] done', '- [x] done\n'],
    ['**bold**', '**bold**\n'],
    ['*italic*', '*italic*\n'],
    ['~~struck~~', '~~struck~~\n'],
  ])('turns %j into %j', (typed, body) => {
    const ed = start()
    type(ed, typed)
    expect(written(ed)).toBe(body)
  })

  it('turns `[!tip] ` at the start of a quote into a callout', () => {
    const ed = start()
    type(ed, '> [!tip] ')
    type(ed, 'Mind the gate.')
    expect(ed.state.doc.firstChild?.type.name).toBe('callout')
    expect(written(ed)).toBe('> [!tip]\n> Mind the gate.\n')
  })

  it('starts a new quote beside a quote, so a callout under a quote keeps to itself', () => {
    const ed = start()
    type(ed, '> quoted')
    enter(ed)
    enter(ed) // the second Enter on an empty line leaves the quote
    type(ed, '> [!tip] ')
    type(ed, 'Mind the gate.')
    expect(written(ed)).toBe('> quoted\n\n> [!tip]\n> Mind the gate.\n')
  })

  it.each(['---', '***', '___'])('turns %s and a space into a scene break', (rule) => {
    const ed = start('Before.\n')
    ed.commands.focus('end')
    ed.commands.splitBlock()
    type(ed, `${rule} `)
    type(ed, 'After.')
    expect(written(ed)).toBe('Before.\n\n* * *\n\nAfter.\n')
  })

  it('leaves `* * *` typed as stars and spaces alone until the third star and a space', () => {
    const ed = start()
    type(ed, '2 * 3')
    expect(written(ed)).toBe('2 * 3\n')
  })

  it('writes what is typed so it reads back the same', () => {
    const ed = start()
    type(ed, 'A *star* and 5 * 6 and [[Elena Vasquez]] and a_b.')
    const body = written(ed)
    // `*star*` became italic; the lone star and the link are kept as typed.
    expect(body).toBe('A *star* and 5 * 6 and [[Elena Vasquez]] and a_b.\n')
    expect(docToBody(editor!.schema.nodeFromJSON(bodyToDoc(body)))).toBe(body)
  })

  it('writes a new scene break in the dialect, and a checklist as a list of boxes', () => {
    const ed = start('Text.\n')
    ed.chain().focus('end').setSceneBreak().run()
    ed.chain().focus('end').toggleTaskList().run()
    type(ed, 'Do it')
    expect(written(ed)).toBe('Text.\n\n* * *\n\n- [ ] Do it\n')
  })
})

describe('keeping what cannot be edited yet', () => {
  it('cannot be formatted: a raw block takes no marks, so its text stays as it is', () => {
    const ed = start('```\ncode here\n```\n')
    ed.commands.selectAll()
    expect(ed.can().toggleBold()).toBe(false)
    ed.chain().toggleBold().run()
    expect(JSON.stringify(ed.getJSON())).not.toContain('bold')
  })

  it('keeps a table and a footnote as text while the paragraph beside them is typed in', () => {
    const body = 'Before.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter [^1].\n\n[^1]: A note.\n'
    const ed = start(body)
    ed.commands.focus('start')
    type(ed, 'More. ')
    expect(written(ed)).toBe(body.replace('Before.', 'More. Before.'))
  })

  it('turns an empty raw block back into a paragraph on Backspace, and keeps a full one', () => {
    editor = new Editor({
      extensions: editorExtensions,
      content: { type: 'doc', content: [{ type: 'rawBlock' }] },
    })
    const backspace = () =>
      editor!.view.someProp('handleKeyDown', (f) =>
        f(editor!.view, new KeyboardEvent('keydown', { key: 'Backspace' })),
      )
    editor.commands.focus('start')
    expect(editor.state.doc.firstChild?.type.name).toBe('rawBlock')
    backspace()
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph')

    const full = start('| a |\n| - |\n')
    full.commands.focus('start')
    backspace()
    expect(full.state.doc.firstChild?.type.name).toBe('rawBlock')
  })
})

describe('a scene that ends in something that cannot be typed in', () => {
  it.each(['| a | b |\n| - | - |\n', '[^1]: A note.\n', '```\ncode\n```\n', 'Text.\n\n* * *\n'])(
    'has an empty paragraph after it to type in, which is not written: %j',
    (body) => {
      const ed = start(body)
      expect(ed.state.doc.lastChild?.type.name).toBe('paragraph')
      expect(ed.state.doc.lastChild?.content.size).toBe(0)
      expect(written(ed)).toBe(body)
      ed.commands.focus('end')
      type(ed, 'More.')
      expect(written(ed)).toBe(`${body}\nMore.\n`.replace(/\n\n\nMore/, '\n\nMore'))
    },
  )
})

describe('headings in the text', () => {
  it('are drawn one level down, so the scene title is the only first level', () => {
    const ed = start('# One\n\n## Two\n\n###### Six\n')
    const html = ed.getHTML()
    expect(html).toContain('<h2 data-level="1">One</h2>')
    expect(html).toContain('<h3 data-level="2">Two</h3>')
    expect(html).toContain('<h6 data-level="6">Six</h6>')
    expect(html).not.toContain('<h1')
  })
  it('keep their level in the file, and when copied and pasted', () => {
    const ed = start('# One\n')
    expect(written(ed)).toBe('# One\n')
    ed.commands.focus('end')
    ed.view.pasteHTML(ed.getHTML())
    expect(written(ed)).toContain('# One')
    expect(written(ed)).not.toContain('## One')
  })
})
