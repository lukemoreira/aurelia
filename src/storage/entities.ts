// SPDX-License-Identifier: AGPL-3.0-or-later
import { bookSchema, chapterSchema, partSchema } from '@/domain/schema/book'
import { recordSchema } from '@/domain/schema/record'
import { universeSchema } from '@/domain/schema/universe'
import type { RecordDoc, SceneDoc, WorkspaceData } from '@/domain/workspace-data'
import { bodyForEditor, parseFrontmatter, splitDocument } from './frontmatter'
import { classify } from './paths'
import { readDocument } from './read-document'
import { parseSceneFile } from './scene-file'

/** A file of the workspace, read: which kind of thing it holds, and the thing. */
export type Parsed =
  | { kind: 'universe'; value: WorkspaceData['universes'][number] }
  | { kind: 'book'; value: WorkspaceData['books'][number] }
  | { kind: 'part'; value: WorkspaceData['parts'][number] }
  | { kind: 'chapter'; value: WorkspaceData['chapters'][number] }
  | { kind: 'scene'; doc: SceneDoc; head: string }
  | { kind: 'record'; doc: RecordDoc; head: string }

/** The ID of what a file holds. */
export const parsedId = (p: Parsed) =>
  p.kind === 'scene' || p.kind === 'record' ? p.doc.meta.id : p.value.id

/** The title of what a file holds, for a screen that has to name a file. */
export const parsedTitle = (p: Parsed) =>
  p.kind === 'scene' || p.kind === 'record' ? p.doc.meta.title : p.value.title

/** Markdown file → its frontmatter as data. */
function frontmatterOf(text: string): unknown {
  const parts = splitDocument(text)
  if (!parts) throw new Error('There are no details (frontmatter) at the top of this file.')
  return parseFrontmatter(parts.yaml)
}

/**
 * Read a file of the workspace by where it sits (ADR-0003: the path says how to read it, the
 * frontmatter is the truth). Null for a path that holds nothing of ours (the derived outline,
 * `.aurelia/`, other files). Throws a readable message; `onNewer` hears of a newer file.
 */
export function parseFile(path: string, text: string, onNewer: () => void): Parsed | null {
  const kind = classify(path)
  switch (kind.kind) {
    case 'book':
      return { kind: 'book', value: readDocument(bookSchema, JSON.parse(text), onNewer) }
    case 'universe':
      return { kind: 'universe', value: readDocument(universeSchema, frontmatterOf(text), onNewer) }
    case 'part':
      return { kind: 'part', value: readDocument(partSchema, frontmatterOf(text), onNewer) }
    case 'chapter':
      return { kind: 'chapter', value: readDocument(chapterSchema, frontmatterOf(text), onNewer) }
    case 'scene': {
      const { doc, head } = parseSceneFile(text, onNewer)
      return { kind: 'scene', doc: { ...doc, book: kind.book }, head }
    }
    case 'record': {
      const parts = splitDocument(text)
      if (!parts) throw new Error('There are no details (frontmatter) at the top of this file.')
      const meta = readDocument(recordSchema, parseFrontmatter(parts.yaml), onNewer)
      const body = bodyForEditor(parts.head, parts.body)
      const doc: RecordDoc = {
        meta,
        universe: kind.universe,
        body,
        ...(meta.summary ? { summary: meta.summary } : {}),
      }
      return { kind: 'record', doc, head: parts.head }
    }
    default:
      return null
  }
}

const replaceBy = <T>(list: T[], idOf: (item: T) => string, item: T): T[] => {
  const id = idOf(item)
  return list.some((x) => idOf(x) === id)
    ? list.map((x) => (idOf(x) === id ? item : x))
    : [...list, item]
}

/** `data` with what a file holds put in: replaces the item with that ID, or adds it. */
export function applyParsed(data: WorkspaceData, p: Parsed): WorkspaceData {
  const id = (x: { id: string }) => x.id
  switch (p.kind) {
    case 'universe':
      return { ...data, universes: replaceBy(data.universes, id, p.value) }
    case 'book':
      return { ...data, books: replaceBy(data.books, id, p.value) }
    case 'part':
      return { ...data, parts: replaceBy(data.parts, id, p.value) }
    case 'chapter':
      return { ...data, chapters: replaceBy(data.chapters, id, p.value) }
    case 'scene':
      return { ...data, scenes: replaceBy(data.scenes, (s) => s.meta.id, p.doc) }
    case 'record':
      return { ...data, records: replaceBy(data.records, (r) => r.meta.id, p.doc) }
  }
}

/** `data` without the item with this ID, whatever kind it is. */
export function removeById(data: WorkspaceData, itemId: string): WorkspaceData {
  const not = (x: { id: string }) => x.id !== itemId
  return {
    ...data,
    universes: data.universes.filter(not),
    books: data.books.filter(not),
    parts: data.parts.filter(not),
    chapters: data.chapters.filter(not),
    scenes: data.scenes.filter((s) => s.meta.id !== itemId),
    records: data.records.filter((r) => r.meta.id !== itemId),
  }
}
