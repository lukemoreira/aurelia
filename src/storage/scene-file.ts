// SPDX-License-Identifier: AGPL-3.0-or-later
import { countWords } from '@/domain/prose'
import { sceneSchema } from '@/domain/schema/scene'
import type { SceneDoc } from '@/domain/workspace-data'
import { bodyForEditor, newHead, parseFrontmatter, splitDocument } from './frontmatter'
import { readDocument } from './read-document'

/** A scene file read: its details, the text, and the head to write back untouched. */
export interface SceneFile {
  doc: SceneDoc
  head: string
}

/** Read a scene file. Throws a readable message; `onNewer` hears of a file from a newer Aurelia. */
export function parseSceneFile(text: string, onNewer: () => void = () => undefined): SceneFile {
  const parts = splitDocument(text)
  if (!parts) throw new Error('There are no details (frontmatter) at the top of this file.')
  const meta = readDocument(sceneSchema, parseFrontmatter(parts.yaml), onNewer)
  const body = bodyForEditor(parts.head, parts.body)
  return { doc: { meta, body, words: countWords(body) }, head: parts.head }
}

/** A brand-new scene file: its details, a blank line, and the (usually empty) text. */
export function newSceneText(meta: SceneDoc['meta'], body = ''): string {
  return newHead(meta) + body
}
