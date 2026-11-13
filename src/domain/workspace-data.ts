// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  bookSchema,
  chapterSchema,
  partSchema,
  type Book,
  type Chapter,
  type Part,
} from './schema/book'
import { parseDocument } from './migrations'
import { recordSchema, type RecordFrontmatter } from './schema/record'
import { sceneSchema, type Scene } from './schema/scene'
import { universeSchema, type Universe } from './schema/universe'
import { workspaceSchema, type Workspace } from './schema/workspace'

/** A scene file: its frontmatter and its text. `words` is the stored count. */
export interface SceneDoc {
  meta: Scene
  body: string
  words: number
  /** The book whose folder the file is in. A scene whose chapter is missing is shown there, as unfiled. */
  book?: string
}

/** A record file (character, place, item…). `universe` is where it lives. */
export interface RecordDoc {
  meta: RecordFrontmatter
  universe: string
  summary?: string
  /** The notes under the details, as plain text. */
  body?: string
}

/**
 * Everything a loaded workspace holds, in the shape the storage layer (M2) will feed.
 * The in-memory sample builds it today; a folder or browser store builds it later.
 */
export interface WorkspaceData {
  workspace: Workspace
  universes: Universe[]
  books: Book[]
  parts: Part[]
  chapters: Chapter[]
  scenes: SceneDoc[]
  records: RecordDoc[]
  /** Where to open first. */
  startAt?: { book: string; scene: string }
}

/** Read every object through `parseDocument`. Throws on the first bad or newer one. */
export function validateWorkspaceData(data: WorkspaceData): WorkspaceData {
  return {
    ...data,
    workspace: parseDocument(workspaceSchema, data.workspace),
    universes: data.universes.map((u) => parseDocument(universeSchema, u)),
    books: data.books.map((b) => parseDocument(bookSchema, b)),
    parts: data.parts.map((p) => parseDocument(partSchema, p)),
    chapters: data.chapters.map((c) => parseDocument(chapterSchema, c)),
    scenes: data.scenes.map((s) => ({ ...s, meta: parseDocument(sceneSchema, s.meta) })),
    records: data.records.map((r) => ({ ...r, meta: parseDocument(recordSchema, r.meta) })),
  }
}
