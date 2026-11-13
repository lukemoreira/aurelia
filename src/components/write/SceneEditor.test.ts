// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Editor } from '@tiptap/core'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { useLayoutStore } from '@/stores/layout'
import SceneEditor from './SceneEditor.vue'

const goldens = import.meta.glob('../../../tests/golden/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const golden = (name: string) =>
  Object.entries(goldens).find(([path]) => path.endsWith(`/golden/${name}`))![1]

let wrapper: VueWrapper | undefined
let target: HTMLElement | undefined
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  target?.remove()
  document.body.innerHTML = ''
})

async function show(body: string, props: { readonly?: boolean; toolbar?: boolean } = {}) {
  document.body.innerHTML = '<h1 id="scene-title">A scene</h1>'
  target = document.createElement('div')
  document.body.append(target)
  wrapper = mount(SceneEditor, {
    props: {
      body,
      readonly: props.readonly ?? false,
      titleId: 'scene-title',
      toolbarTarget: props.toolbar === false ? null : target,
    },
    attachTo: document.body,
  })
  await flushPromises()
  const dom = wrapper.find<HTMLElement & { editor: Editor }>('[role="textbox"]').element
  return { editor: dom.editor, dom }
}
const edits = () => (wrapper!.emitted('edit') ?? []).map((e) => e[0] as string)
/** Replace the text of top-level block `i` the way typing would: a change made in the editor. */
function typeInto(editor: Editor, i: number, text: string) {
  let from = 0
  for (let k = 0; k < i; k++) from += editor.state.doc.child(k).nodeSize
  const block = editor.state.doc.child(i)
  editor.view.dispatch(editor.state.tr.insertText(text, from + 1, from + block.nodeSize - 1))
}

describe('opening a scene', () => {
  it.each(Object.keys(goldens).map((p) => p.split('/golden/')[1]!))(
    'writes nothing for %s',
    async (name) => {
      await show(golden(name))
      await nextTick()
      expect(edits()).toEqual([])
    },
  )

  it('shows the text, named by its scene', async () => {
    const { dom } = await show('The bells rang.\n')
    expect(dom.textContent).toBe('The bells rang.')
    expect(dom.getAttribute('aria-label')).toBe('Scene text')
    expect(dom.getAttribute('aria-labelledby')).toBe('scene-text scene-title')
    expect(dom.getAttribute('aria-multiline')).toBe('true')
  })
})

describe('what is shown for what is in the file', () => {
  it('never renders HTML: it is letters on the page', async () => {
    const { dom } = await show(golden('html.md'))
    for (const tag of ['script', 'img', 'span.x', 'div', 'br', 'b', 'u > b', 'u > u'])
      expect(dom.querySelector(tag), tag).toBeNull()
    expect(dom.textContent).toContain('<script>alert(1)</script>')
    expect(dom.textContent).toContain('<img src="x" onerror="alert(1)">')
    expect(dom.textContent).toContain('<!-- a comment -->')
    expect(dom.querySelectorAll('u')).toHaveLength(1) // only the real <u>…</u>
  })

  it('shows <u> as underline and the marks as marks', async () => {
    const { dom } = await show(golden('marks.md'))
    expect(dom.querySelectorAll('u').length).toBeGreaterThan(0)
    expect(dom.querySelector('strong')).not.toBeNull()
    expect(dom.querySelector('em')).not.toBeNull()
    expect(dom.querySelector('s')).not.toBeNull()
    expect(dom.querySelector('a[href="https://example.com"]')).not.toBeNull()
  })

  it('shows a table and a footnote as the text they are, nothing dropped', async () => {
    const { dom } = await show(golden('raw-kept.md'))
    expect(dom.querySelector('table')).toBeNull()
    const raws = [...dom.querySelectorAll('pre[data-raw-block]')].map((e) => e.textContent)
    expect(raws.join('\n')).toContain('| Name | Role |')
    expect(raws.join('\n')).toContain('[^1]: The first note.')
    expect(raws.join('\n')).toContain('```js')
  })

  it('shows lists, a checklist, a quote, a callout and a scene break', async () => {
    const { dom } = await show(
      `${golden('lists.md')}\n${golden('quote-callout.md')}\n${golden('scene-break.md')}`,
    )
    expect(dom.querySelectorAll('ul[data-type="taskList"] input[type="checkbox"]').length).toBe(3)
    expect(dom.querySelectorAll('ol').length).toBeGreaterThan(0)
    expect(dom.querySelector('blockquote')).not.toBeNull()
    const callout = dom.querySelector('[data-callout="note"]')!
    expect(callout.getAttribute('data-title')).toBe('Heads up')
    expect(callout.getAttribute('aria-label')).toBe('Heads up')
    expect(dom.querySelector('[data-callout="warning"]')!.getAttribute('data-title')).toBe(
      'Warning',
    )
    expect(dom.querySelectorAll('[role="separator"][aria-label="Scene break"]')).toHaveLength(3)
  })
})

describe('an edit', () => {
  it('reaches the workspace as the whole text, changing only the block that was edited', async () => {
    const body = golden('foreign/obsidian-style.md')
    const { editor } = await show(body)
    typeInto(editor, 2, 'Some changed words.')
    const [written] = edits()
    expect(written).toBe(body.replace(/Some _emphasis_[^\n]*\n/, 'Some changed words.\n'))
    expect(edits()).toHaveLength(1)
  })

  it('goes back to the very same text when a change is undone by hand', async () => {
    for (const name of ['foreign/obsidian-style.md', 'raw-kept.md', 'paragraphs.md']) {
      const body = golden(name)
      const { editor } = await show(body)
      const before = edits().length
      typeInto(editor, 0, `${editor.state.doc.child(0).textContent}x`)
      typeInto(editor, 0, editor.state.doc.child(0).textContent.slice(0, -1))
      // The block was written again from its words, and still reads exactly as it was read.
      expect(edits().length).toBeGreaterThan(before)
      expect(edits().at(-1), name).toBe(body)
      wrapper!.unmount()
    }
  })

  it('is not reported again when the workspace hands the same text back', async () => {
    const { editor } = await show('One.\n\nTwo.\n')
    typeInto(editor, 0, 'Uno.')
    await wrapper!.setProps({ body: edits()[0] })
    await flushPromises()
    expect(edits()).toEqual(['Uno.\n\nTwo.\n'])
    expect(editor.getText()).toContain('Uno.')
  })

  it('does not write for a change that leaves the text as it was', async () => {
    const { editor } = await show('One.\n')
    typeInto(editor, 0, 'One.')
    expect(edits()).toEqual([])
  })

  it('does not write an empty paragraph made by pressing Enter', async () => {
    const { editor } = await show('One.\n')
    editor.commands.focus('end')
    editor.commands.splitBlock()
    expect(edits()).toEqual([])
  })
})

describe('a change made outside', () => {
  it('replaces what is shown, without being an edit, and keeps the caret in place', async () => {
    const { editor, dom } = await show('First para.\n\nSecond para here.\n')
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 1 + 7) // "Second " |
    await wrapper!.setProps({ body: 'First para.\n\nSecond para changed elsewhere.\n' })
    await flushPromises()
    expect(dom.textContent).toContain('Second para changed elsewhere.')
    expect(edits()).toEqual([])
    const { $from } = editor.state.selection
    expect($from.index(0)).toBe(1)
    expect($from.parentOffset).toBe(7)
  })

  it('cannot be undone into the old text', async () => {
    const { editor } = await show('Old text.\n')
    typeInto(editor, 0, 'Older text.')
    await wrapper!.setProps({ body: 'Older text.\n' }) // the workspace took it
    await wrapper!.setProps({ body: 'Theirs.\n' })
    await flushPromises()
    editor.commands.undo()
    await flushPromises()
    expect(editor.getText()).toBe('Theirs.')
    expect(edits()).toEqual(['Older text.\n'])
  })
})

describe('an edit the workspace did not take', () => {
  it('is sent again when the editor can write, and no outside change replaces it meanwhile', async () => {
    const { editor } = await show('One.\n')
    await wrapper!.setProps({ readonly: true })
    typeInto(editor, 0, 'Typed just as it went read-only.')
    expect(edits()).toEqual(['Typed just as it went read-only.\n']) // sent, but not taken: props.body is still old
    await wrapper!.setProps({ body: 'Changed elsewhere.\n' })
    await flushPromises()
    expect(editor.getText()).toBe('Typed just as it went read-only.')
    await wrapper!.setProps({ readonly: false })
    await flushPromises()
    expect(edits()).toEqual([
      'Typed just as it went read-only.\n',
      'Typed just as it went read-only.\n',
    ])
  })

  it('is let go once the workspace holds it, and outside changes apply again', async () => {
    const { editor } = await show('One.\n')
    typeInto(editor, 0, 'Two.')
    await wrapper!.setProps({ body: 'Two.\n' })
    await wrapper!.setProps({ body: 'Three.\n' })
    await flushPromises()
    expect(editor.getText()).toBe('Three.')
  })

  it('is not left waiting when it was typed back to what the workspace holds', async () => {
    const { editor } = await show('One.\n')
    typeInto(editor, 0, 'Two.')
    typeInto(editor, 0, 'One.')
    await wrapper!.setProps({ body: 'Elsewhere.\n' })
    await flushPromises()
    expect(editor.getText()).toBe('Elsewhere.')
  })
})

describe('pasting', () => {
  it('a table keeps its cells apart: a paragraph a row, a space between cells', async () => {
    const { editor } = await show('One.\n')
    editor.commands.focus('end')
    editor.view.pasteHTML(
      '<table><tr><th>Name</th><th>Role</th></tr><tr><td>Elena</td><td>Courier</td></tr></table>',
    )
    const body = edits().at(-1)!
    expect(body).toContain('Name Role')
    expect(body).toContain('Elena Courier')
    expect(body).not.toContain('NameRole')
    expect(body).not.toContain('ElenaCourier')
  })
})

describe('read-only', () => {
  it('cannot be typed into and has no formatting bar', async () => {
    const { editor, dom } = await show('Text.\n', { readonly: true })
    expect(editor.isEditable).toBe(false)
    expect(dom.getAttribute('contenteditable')).toBe('false')
    expect(dom.getAttribute('aria-readonly')).toBe('true')
    expect(target!.querySelector('[role="toolbar"]')).toBeNull()
  })

  it('turns editable when the workspace does', async () => {
    const { editor } = await show('Text.\n', { readonly: true })
    await wrapper!.setProps({ readonly: false })
    await flushPromises()
    expect(editor.isEditable).toBe(true)
    expect(target!.querySelector('[role="toolbar"]')).not.toBeNull()
  })
})

describe('focus mode', () => {
  it('takes the formatting bar away and gives it back', async () => {
    await show('Text.\n')
    const layout = useLayoutStore()
    expect(target!.querySelector('[role="toolbar"]')).not.toBeNull()
    layout.focus = true
    await flushPromises()
    expect(target!.querySelector('[role="toolbar"]')).toBeNull()
    layout.focus = false
    await flushPromises()
    expect(target!.querySelector('[role="toolbar"]')).not.toBeNull()
  })
})
