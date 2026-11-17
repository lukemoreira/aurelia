// SPDX-License-Identifier: AGPL-3.0-or-later
import { getSchema, type AnyExtension } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { Callout } from './nodes/Callout'
import { Document } from './nodes/Document'
import { FootnoteDef } from './nodes/FootnoteDef'
import { FootnoteRef } from './nodes/FootnoteRef'
import { Footnotes } from './nodes/Footnotes'
import { Heading } from './nodes/Heading'
import { LeadIn } from './nodes/LeadIn'
import { Quote } from './nodes/Quote'
import { RawBlock } from './nodes/RawBlock'
import { SceneBreak } from './nodes/SceneBreak'
import { Source } from './nodes/Source'
import { TableRules, tableNodes } from './nodes/Table'
import { Verbatim } from './nodes/Verbatim'

/**
 * What the manuscript can hold. Code and rules are left out of the kit: a code block or raw HTML
 * is a `rawBlock` (kept as written), inline code is `verbatim`, and a thematic break is a
 * `sceneBreak`. Tables and footnotes are their own nodes.
 */
export const dialectExtensions: AnyExtension[] = [
  StarterKit.configure({
    document: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    heading: false,
    link: { openOnClick: false, autolink: false, defaultProtocol: 'https' },
  }),
  Document,
  Heading,
  Quote,
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
  SceneBreak,
  RawBlock,
  Verbatim,
  FootnoteRef,
  FootnoteDef,
  ...tableNodes,
  Source,
]

/** Extensions for the editor on screen: the dialect, plus what only a screen needs. */
export const editorExtensions: AnyExtension[] = [
  ...dialectExtensions,
  Placeholder.configure({ placeholder: 'Start writing…' }),
  LeadIn,
  Footnotes,
  TableRules,
]

/** The shape of a scene's text. Needs no screen, so the Markdown code and its tests run without one. */
export const schema = getSchema(dialectExtensions)
