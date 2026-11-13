// SPDX-License-Identifier: AGPL-3.0-or-later
import { getSchema, type AnyExtension } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { Callout } from './nodes/Callout'
import { Heading } from './nodes/Heading'
import { LeadIn } from './nodes/LeadIn'
import { Quote } from './nodes/Quote'
import { RawBlock } from './nodes/RawBlock'
import { SceneBreak } from './nodes/SceneBreak'
import { Source } from './nodes/Source'
import { Verbatim } from './nodes/Verbatim'

/**
 * What the manuscript can hold. Code and rules are left out of the kit: a code block, a table or
 * raw HTML is a `rawBlock` (kept as written), inline code is `verbatim`, and a thematic break is
 * a `sceneBreak`.
 */
export const dialectExtensions: AnyExtension[] = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    heading: false,
    link: { openOnClick: false, autolink: false, defaultProtocol: 'https' },
  }),
  Heading,
  Quote,
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
  SceneBreak,
  RawBlock,
  Verbatim,
  Source,
]

/** Extensions for the editor on screen: the dialect, plus what only a screen needs. */
export const editorExtensions: AnyExtension[] = [
  ...dialectExtensions,
  Placeholder.configure({ placeholder: 'Start writing…' }),
  LeadIn,
]

/** The shape of a scene's text. Needs no screen, so the Markdown code and its tests run without one. */
export const schema = getSchema(dialectExtensions)
