// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Editor } from '@tiptap/core'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLayoutStore } from '@/stores/layout'
import SceneEditor from './SceneEditor.vue'

let wrapper: VueWrapper | undefined
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

async function show(body = 'Some words here.\n') {
  document.body.innerHTML = '<h1 id="scene-title">A scene</h1>'
  const target = document.createElement('div')
  document.body.append(target)
  wrapper = mount(SceneEditor, {
    props: { body, readonly: false, titleId: 'scene-title', toolbarTarget: target },
    attachTo: document.body,
  })
  await flushPromises()
  const editor = wrapper.find<HTMLElement & { editor: Editor }>('[role="textbox"]').element.editor
  const bar = target.querySelector<HTMLElement>('[role="toolbar"]')!
  const button = (name: string | RegExp) =>
    [...bar.querySelectorAll<HTMLElement>('button')].find((b) =>
      typeof name === 'string'
        ? b.getAttribute('aria-label') === name
        : name.test(b.getAttribute('aria-label') ?? ''),
    )!
  const edits = () => (wrapper!.emitted('edit') ?? []).map((e) => e[0] as string)
  return { editor, bar, button, edits, target }
}
const click = async (el: HTMLElement) => {
  el.click()
  await flushPromises()
}

describe('the formatting bar', () => {
  it('is a toolbar named Formatting, with a name on every button', async () => {
    const { bar } = await show()
    expect(bar.getAttribute('role')).toBe('toolbar')
    expect(bar.getAttribute('aria-label')).toBe('Formatting')
    const buttons = [...bar.querySelectorAll('button')]
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Text style: Paragraph',
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Link',
      'Bulleted list',
      'Checklist',
      'Quote',
      'Callout',
      'Scene break',
      'Undo',
      'Redo',
    ])
    expect(buttons.every((b) => b.getAttribute('type') === 'button')).toBe(true)
  })

  it('shows what is under the caret as pressed, and keeps it true as the caret moves', async () => {
    const { editor, button } = await show('Plain **bold** plain.\n')
    const pressed = (name: string) => button(name).getAttribute('aria-pressed')
    expect(pressed('Bold')).toBe('false')
    expect(pressed('Italic')).toBe('false')
    editor.commands.setTextSelection(9) // inside "bold"
    await flushPromises()
    expect(pressed('Bold')).toBe('true')
    editor.commands.setTextSelection(2)
    await flushPromises()
    expect(pressed('Bold')).toBe('false')
  })

  it('has pressed states on the toggles and none on the one-off buttons', async () => {
    const { button } = await show()
    for (const name of [
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Link',
      'Bulleted list',
      'Checklist',
      'Quote',
      'Callout',
    ])
      expect(button(name).hasAttribute('aria-pressed'), name).toBe(true)
    for (const name of ['Scene break', 'Undo', 'Redo'])
      expect(button(name).hasAttribute('aria-pressed'), name).toBe(false)
  })

  it('makes the selected words bold, and writes them so', async () => {
    const { editor, button, edits } = await show('Some words here.\n')
    editor.commands.setTextSelection({ from: 6, to: 11 })
    await click(button('Bold'))
    expect(edits()).toEqual(['Some **words** here.\n'])
    expect(button('Bold').getAttribute('aria-pressed')).toBe('true')
    await click(button('Bold'))
    expect(edits().at(-1)).toBe('Some words here.\n')
  })

  it.each([
    ['Italic', 'Some *words* here.\n'],
    ['Underline', 'Some <u>words</u> here.\n'],
    ['Strikethrough', 'Some ~~words~~ here.\n'],
  ])('%s writes %j', async (name, body) => {
    const { editor, button, edits } = await show()
    editor.commands.setTextSelection({ from: 6, to: 11 })
    await click(button(name))
    expect(edits()).toEqual([body])
  })

  it('makes lists, a checklist, a quote, a callout and a scene break', async () => {
    const { editor, button, edits } = await show('One.\n')
    editor.commands.focus('end')
    await click(button('Bulleted list'))
    expect(edits().at(-1)).toBe('- One.\n')
    await click(button('Bulleted list'))
    await click(button('Checklist'))
    expect(edits().at(-1)).toBe('- [ ] One.\n')
    await click(button('Checklist'))
    await click(button('Quote'))
    expect(edits().at(-1)).toBe('> One.\n')
    await click(button('Quote'))
    await click(button('Callout'))
    expect(edits().at(-1)).toBe('> [!note]\n> One.\n')
    expect(button('Callout').getAttribute('aria-pressed')).toBe('true')
    await click(button('Callout'))
    await click(button('Scene break'))
    expect(edits().at(-1)).toBe('One.\n\n* * *\n')
  })

  it('keeps Undo and Redo off until there is something to undo or redo', async () => {
    const { editor, button } = await show('Words.\n')
    expect(button('Undo').hasAttribute('disabled')).toBe(true)
    expect(button('Redo').hasAttribute('disabled')).toBe(true)
    editor.commands.setTextSelection({ from: 1, to: 6 })
    await click(button('Bold'))
    expect(button('Undo').hasAttribute('disabled')).toBe(false)
    await click(button('Undo'))
    expect(button('Redo').hasAttribute('disabled')).toBe(false)
  })

  it('names the text style under the caret and changes it from the menu', async () => {
    const { editor, button } = await show('Heading words.\n')
    expect(button(/^Text style/).getAttribute('aria-label')).toBe('Text style: Paragraph')
    editor.chain().focus().setHeading({ level: 2 }).run()
    await flushPromises()
    expect(button(/^Text style/).getAttribute('aria-label')).toBe('Text style: Heading 2')
  })

  it('moves between buttons with the arrow keys: one tab stop for the whole bar', async () => {
    const { bar, button } = await show()
    const buttons = [...bar.querySelectorAll<HTMLElement>('button')]
    expect([bar, ...buttons].filter((el) => el.tabIndex === 0)).toHaveLength(1)
    button('Bold').focus()
    button('Bold').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(document.activeElement).toBe(button('Italic'))
    button('Italic').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    )
    await flushPromises()
    expect(document.activeElement).toBe(button('Bold'))
  })

  it('does not take the caret from the text when a button is pressed', async () => {
    const { bar } = await show()
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    bar.querySelector('button')!.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
  })

  it('is the short bar on a phone: the essentials at 44 px, and Done', async () => {
    const layout = useLayoutStore()
    layout.wide = false
    const { bar } = await show()
    expect(
      [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent),
    ).toEqual(['Bold', 'Italic', 'Link', 'Scene break', 'Undo', 'Redo', 'Done'])
    expect(bar.querySelector('button')!.className).toContain('pointer-coarse:size-11')
  })
})

describe('Done on a phone', () => {
  it('puts the keyboard away: the text lets go of the caret', async () => {
    const layout = useLayoutStore()
    layout.wide = false
    const { editor, bar } = await show()
    const dom = editor.view.dom as HTMLElement
    dom.focus()
    expect(document.activeElement).toBe(dom)
    const done = [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Done')!
    await click(done)
    expect(document.activeElement).not.toBe(dom)
  })
  it('is not on the wide bar', async () => {
    const { bar } = await show()
    expect([...bar.querySelectorAll('button')].some((b) => b.textContent === 'Done')).toBe(false)
  })
})

describe('a link', () => {
  const open = async () => {
    const view = await show('Some words here.\n')
    view.editor.commands.setTextSelection({ from: 6, to: 11 })
    await click(view.button('Link'))
    await flushPromises()
    return view
  }
  const field = () =>
    document.querySelector<HTMLInputElement>('input[placeholder="https://example.com"]')!
  const submit = async (address: string) => {
    field().value = address
    field().dispatchEvent(new Event('input'))
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
  }

  it('is added to the selected words, with https:// when none was typed', async () => {
    const { edits } = await open()
    expect(field().labels?.[0]?.textContent).toBe('Link address')
    await submit('example.com/a')
    expect(edits()).toEqual(['Some [words](https://example.com/a) here.\n'])
  })

  it('is for the words that were selected when the box opened, even if the selection has gone by then', async () => {
    const { edits, editor } = await open()
    editor.commands.setTextSelection(11) // moving into the box collapsed it
    await submit('example.com')
    expect(edits()).toEqual(['Some [words](https://example.com) here.\n'])
  })

  it('keeps a mail address as it is', async () => {
    const { edits } = await open()
    await submit('mailto:me@example.com')
    expect(document.querySelector('form'), 'the box closes').toBeNull()
    expect(edits().at(-1)).toBe('Some [words](mailto:me@example.com) here.\n')
  })

  it('refuses an address that runs a script', async () => {
    await open()
    await submit('javascript:alert(1)')
    expect(document.querySelector('a[href^="javascript"]')).toBeNull()
  })

  it('is removed again from its own box', async () => {
    const { edits, editor, button } = await show('Some [words](https://example.com) here.\n')
    editor.commands.setTextSelection(8)
    await click(button('Link'))
    await flushPromises()
    expect(field().value).toBe('https://example.com')
    const remove = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Remove link',
    )!
    await click(remove)
    expect(edits().at(-1)).toBe('Some words here.\n')
  })
})
