// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Editor } from '@tiptap/core'
import type { IconName } from '@/domain/ui-names'

export interface ToolbarItem {
  id: string
  /** The accessible name. */
  label: string
  /** How the shortcut is written, for the tooltip; `Mod` is ⌘ or Ctrl. */
  shortcut?: string
  /** An icon, or a letter drawn in the style it applies (B, I, U, S, ⁂). */
  icon?: IconName
  glyph?: { text: string; class: string }
  /** Whether the thing under the caret is already this: shows the button as pressed. */
  active?: (editor: Editor) => boolean
  can?: (editor: Editor) => boolean
  run: (editor: Editor) => void
  /** Kept on the phone's bar, which has room for six. */
  phone?: boolean
}

const chain = (editor: Editor) => editor.chain().focus()

/** The groups of the formatting bar, in the order of the design (`Main`). A numbered list is typed (`1. `). */
export const TOOLBAR_GROUPS: ToolbarItem[][] = [
  [
    {
      id: 'bold',
      label: 'Bold',
      shortcut: 'Mod+B',
      glyph: { text: 'B', class: 'font-ui text-sm font-bold' },
      active: (e) => e.isActive('bold'),
      run: (e) => void chain(e).toggleBold().run(),
      phone: true,
    },
    {
      id: 'italic',
      label: 'Italic',
      shortcut: 'Mod+I',
      glyph: { text: 'I', class: 'font-prose text-[15px] italic' },
      active: (e) => e.isActive('italic'),
      run: (e) => void chain(e).toggleItalic().run(),
      phone: true,
    },
    {
      id: 'underline',
      label: 'Underline',
      shortcut: 'Mod+U',
      glyph: { text: 'U', class: 'font-ui text-sm underline underline-offset-[3px]' },
      active: (e) => e.isActive('underline'),
      run: (e) => void chain(e).toggleUnderline().run(),
    },
    {
      id: 'strike',
      label: 'Strikethrough',
      shortcut: 'Mod+Shift+S',
      glyph: { text: 'S', class: 'font-ui text-sm line-through' },
      active: (e) => e.isActive('strike'),
      run: (e) => void chain(e).toggleStrike().run(),
    },
  ],
  [
    {
      id: 'bulletList',
      label: 'Bulleted list',
      shortcut: 'Mod+Shift+8',
      icon: 'list',
      active: (e) => e.isActive('bulletList'),
      run: (e) => void chain(e).toggleBulletList().run(),
    },
    {
      id: 'taskList',
      label: 'Checklist',
      shortcut: 'Mod+Shift+9',
      icon: 'checklist',
      active: (e) => e.isActive('taskList'),
      run: (e) => void chain(e).toggleTaskList().run(),
    },
    {
      id: 'blockquote',
      label: 'Quote',
      shortcut: 'Mod+Shift+B',
      icon: 'quote',
      active: (e) => e.isActive('blockquote'),
      run: (e) => void chain(e).toggleBlockquote().run(),
    },
    {
      id: 'callout',
      label: 'Callout',
      icon: 'callout',
      active: (e) => e.isActive('callout'),
      run: (e) => void chain(e).toggleCallout().run(),
    },
    {
      id: 'sceneBreak',
      label: 'Scene break',
      glyph: { text: '⁂', class: 'font-prose text-[15px]' },
      run: (e) => void chain(e).setSceneBreak().run(),
      phone: true,
    },
  ],
  [
    {
      id: 'undo',
      label: 'Undo',
      shortcut: 'Mod+Z',
      icon: 'undo',
      can: (e) => e.can().undo(),
      run: (e) => void chain(e).undo().run(),
      phone: true,
    },
    {
      id: 'redo',
      label: 'Redo',
      shortcut: 'Mod+Shift+Z',
      icon: 'redo',
      can: (e) => e.can().redo(),
      run: (e) => void chain(e).redo().run(),
      phone: true,
    },
  ],
]

/** The paragraph styles in the "Text style" menu, and their headings' levels. */
export const TEXT_STYLES = [
  { id: 'paragraph', label: 'Paragraph' },
  { id: 'h1', label: 'Heading 1', level: 1 },
  { id: 'h2', label: 'Heading 2', level: 2 },
  { id: 'h3', label: 'Heading 3', level: 3 },
] as const

/** The name of the style under the caret: a heading of any level, else a paragraph. */
export function currentTextStyle(editor: Editor): string {
  for (let level = 1; level <= 6; level++)
    if (editor.isActive('heading', { level })) return `Heading ${level}`
  return 'Paragraph'
}

export function setTextStyle(editor: Editor, id: string) {
  const style = TEXT_STYLES.find((s) => s.id === id)
  if (!style) return
  if ('level' in style) void chain(editor).setHeading({ level: style.level }).run()
  else void chain(editor).setParagraph().run()
}

/** A web address as typed, made one: `example.com` gets `https://`. Mail and phone links are kept. */
export function normalizeHref(typed: string): string {
  const href = typed.trim()
  return /^[a-z][a-z\d+.-]*:/i.test(href) ? href : `https://${href}`
}

/** Set, change or remove the link under the caret. An empty address removes it. */
export function setLink(editor: Editor, typed: string) {
  const href = typed.trim() ? normalizeHref(typed) : ''
  if (!href) {
    void chain(editor).extendMarkRange('link').unsetLink().run()
  } else if (editor.state.selection.empty && !editor.isActive('link')) {
    // No words are selected: what was typed becomes the words.
    void chain(editor)
      .insertContent({
        type: 'text',
        text: typed.trim(),
        marks: [{ type: 'link', attrs: { href } }],
      })
      .run()
  } else {
    void chain(editor).extendMarkRange('link').setLink({ href }).run()
  }
}
