// SPDX-License-Identifier: AGPL-3.0-or-later
import { bookSchema, chapterSchema, partSchema } from '@/domain/schema/book'
import { recordSchema } from '@/domain/schema/record'
import { universeSchema } from '@/domain/schema/universe'
import { workspaceSchema } from '@/domain/schema/workspace'
import type { WorkspaceData } from '@/domain/workspace-data'
import type { StorageAdapter } from './adapter'
import { OpenError, isPermissionError } from './errors'
import { parseFrontmatter, splitDocument } from './frontmatter'
import { AURELIA_DIR, WORKSPACE_FILE, classify, conflictedCopyOf } from './paths'
import { describeProblem, readDocument } from './read-document'
import { parseSceneFile } from './scene-file'

/** A file Aurelia could not use. It is shown to the author by path and never written. */
export interface Problem {
  path: string
  reason: string
}

/** A file a sync tool (or Aurelia) set aside because two versions met. */
export interface ConflictedCopy {
  path: string
  /** The file it was made from. */
  original: string
}

export interface LoadedWorkspace {
  data: WorkspaceData
  /** Hash of every file read, by path: what compare-and-write expects to find next time. */
  hashes: Map<string, string>
  /** Each scene file's head (frontmatter and the gap after it), kept to write back untouched. */
  heads: Map<string, string>
  scenePaths: Map<string, string>
  /** A file said it is from a newer Aurelia: nothing may be written. */
  readOnly: boolean
  problems: Problem[]
  copies: ConflictedCopy[]
}

const CHUNK = 16

/** Markdown file → its frontmatter as data. */
function frontmatterOf(text: string): unknown {
  const parts = splitDocument(text)
  if (!parts) throw new Error('There are no details (frontmatter) at the top of this file.')
  return parseFrontmatter(parts.yaml)
}

/**
 * Read a workspace from its files (ADR-0003). A file that cannot be read goes in `problems`,
 * with its path, and is never written. A newer file opens the workspace read-only.
 */
export async function loadWorkspace(adapter: StorageAdapter): Promise<LoadedWorkspace> {
  const found = await adapter.read(WORKSPACE_FILE)
  if (!found) throw new OpenError('not-workspace', 'aurelia.json is missing.')
  const hashes = new Map([[WORKSPACE_FILE, found.hash]])
  const problems: Problem[] = []
  const copies: ConflictedCopy[] = []
  const heads = new Map<string, string>()
  const scenePaths = new Map<string, string>()
  let readOnly = false
  const onNewer = () => (readOnly = true)

  let workspace
  try {
    workspace = readDocument(workspaceSchema, JSON.parse(found.text), onNewer)
  } catch (e) {
    throw new OpenError(
      readOnly ? 'newer-version' : 'unreadable',
      `“${WORKSPACE_FILE}” could not be read. ${describeProblem(e)}`,
    )
  }

  const data: WorkspaceData = {
    workspace,
    universes: [],
    books: [],
    parts: [],
    chapters: [],
    scenes: [],
    records: [],
  }

  const toRead: string[] = []
  for (const path of (await adapter.list()).sort()) {
    if (path === WORKSPACE_FILE || path.startsWith(AURELIA_DIR)) continue
    const original = conflictedCopyOf(path)
    if (original) copies.push({ path, original })
    else if (classify(path).kind !== 'other') toRead.push(path)
  }

  const contents = new Map<string, string>()
  for (let i = 0; i < toRead.length; i += CHUNK)
    await Promise.all(
      toRead.slice(i, i + CHUNK).map(async (path) => {
        try {
          const file = await adapter.read(path)
          if (!file) return
          hashes.set(path, file.hash)
          contents.set(path, file.text)
        } catch (e) {
          if (isPermissionError(e)) throw e
          problems.push({ path, reason: describeProblem(e) })
        }
      }),
    )

  /** Two files with one ID are a conflict for the author to see, never one picked silently. */
  const seen = new Map<string, string>()
  const claim = (id: string, path: string) => {
    const first = seen.get(id)
    if (first)
      throw new Error(`Another file already uses this ID (“${first}”). Open it to compare.`)
    seen.set(id, path)
  }

  for (const path of toRead) {
    const text = contents.get(path)
    if (text === undefined) continue
    const kind = classify(path)
    try {
      switch (kind.kind) {
        case 'book': {
          const b = readDocument(bookSchema, JSON.parse(text), onNewer)
          claim(b.id, path)
          data.books.push(b)
          break
        }
        case 'universe': {
          const u = readDocument(universeSchema, frontmatterOf(text), onNewer)
          claim(u.id, path)
          data.universes.push(u)
          break
        }
        case 'part': {
          const p = readDocument(partSchema, frontmatterOf(text), onNewer)
          claim(p.id, path)
          data.parts.push(p)
          break
        }
        case 'chapter': {
          const c = readDocument(chapterSchema, frontmatterOf(text), onNewer)
          claim(c.id, path)
          data.chapters.push(c)
          break
        }
        case 'scene': {
          const s = parseSceneFile(text, onNewer)
          claim(s.doc.meta.id, path)
          data.scenes.push(s.doc)
          heads.set(path, s.head)
          scenePaths.set(s.doc.meta.id, path)
          break
        }
        case 'record': {
          const r = readDocument(recordSchema, frontmatterOf(text), onNewer)
          claim(r.id, path)
          data.records.push({ meta: r, universe: kind.universe })
          break
        }
      }
    } catch (e) {
      problems.push({ path, reason: describeProblem(e) })
    }
  }

  // Nothing may vanish: say so when a file points at a chapter or a book that is not there.
  const chapterIds = new Set(data.chapters.map((c) => c.id))
  const bookIds = new Set(data.books.map((b) => b.id))
  for (const s of data.scenes)
    if (!chapterIds.has(s.meta.chapter))
      problems.push({
        path: scenePaths.get(s.meta.id)!,
        reason: 'Its chapter is missing, so it is not in the outline.',
      })
  for (const c of data.chapters)
    if (!bookIds.has(c.book))
      problems.push({
        path: seen.get(c.id)!,
        reason: 'Its book is missing, so it is not in the outline.',
      })

  return { data, hashes, heads, scenePaths, readOnly, problems, copies }
}
