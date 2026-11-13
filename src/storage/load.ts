// SPDX-License-Identifier: AGPL-3.0-or-later
import { workspaceSchema } from '@/domain/schema/workspace'
import type { WorkspaceData } from '@/domain/workspace-data'
import type { StorageAdapter } from './adapter'
import { applyParsed, parseFile, parsedId, parsedTitle } from './entities'
import { OpenError, isPermissionError } from './errors'
import { AURELIA_DIR, WORKSPACE_FILE, classify, conflictedCopyOf } from './paths'
import { describeProblem, readDocument } from './read-document'

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

/** Two or more files that carry one ID. All are kept; the author chooses which one stays. */
export interface DuplicateId {
  id: string
  files: { path: string; title: string }[]
}

export interface LoadedWorkspace {
  data: WorkspaceData
  /** The text of `aurelia.json` as read: a rename changes only the name in it. */
  workspaceText: string
  /** Hash of every file read, by path: what compare-and-write expects to find next time. */
  hashes: Map<string, string>
  /** The text of every file read, by path: what an edit starts from. */
  texts: Map<string, string>
  /** Each scene's and record's head (frontmatter and the gap after it), kept to write back untouched. */
  heads: Map<string, string>
  /** The file each item (scene, chapter, book, record…) was read from, by ID. */
  paths: Map<string, string>
  duplicates: DuplicateId[]
  /** A file said it is from a newer Aurelia: nothing may be written. */
  readOnly: boolean
  problems: Problem[]
  copies: ConflictedCopy[]
}

const CHUNK = 16

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
  const paths = new Map<string, string>()
  const duplicates = new Map<string, DuplicateId>()
  const bookHome = new Map<string, string>()
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

  let data: WorkspaceData = {
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
    else if (classify(path).kind !== 'other') toRead.push(path) // the outline too: its hash is what a rewrite expects
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

  const titles = new Map<string, string>()
  for (const path of toRead) {
    const text = contents.get(path)
    if (text === undefined) continue
    try {
      const parsed = parseFile(path, text, onNewer)
      if (!parsed) continue
      const id = parsedId(parsed)
      const title = parsedTitle(parsed)
      const first = paths.get(id)
      // Two files with one ID are a conflict for the author to see, never one picked silently.
      if (first) {
        const found = duplicates.get(id) ?? {
          id,
          files: [{ path: first, title: titles.get(first) ?? first }],
        }
        found.files.push({ path, title })
        duplicates.set(id, found)
        continue
      }
      paths.set(id, path)
      titles.set(path, title)
      if (parsed.kind === 'book')
        bookHome.set(id, (classify(path) as { universe: string }).universe)
      if (parsed.kind === 'scene' || parsed.kind === 'record') heads.set(path, parsed.head)
      data = applyParsed(data, parsed)
    } catch (e) {
      problems.push({ path, reason: describeProblem(e) })
    }
  }
  data = adoptStrays(data, bookHome)

  // Nothing may vanish: a scene with no chapter shows as Unfiled; say so when a chapter has no book.
  const bookIds = new Set(data.books.map((b) => b.id))
  for (const s of data.scenes)
    if (s.book && !bookIds.has(s.book))
      problems.push({
        path: paths.get(s.meta.id)!,
        reason: 'Its book is missing, so it is not in the outline.',
      })
  for (const c of data.chapters)
    if (!bookIds.has(c.book))
      problems.push({
        path: paths.get(c.id)!,
        reason: 'Its book is missing, so it is not in the outline.',
      })

  return {
    data,
    workspaceText: found.text,
    hashes,
    texts: new Map([[WORKSPACE_FILE, found.text], ...contents]),
    heads,
    paths,
    duplicates: [...duplicates.values()],
    readOnly,
    problems,
    copies,
  }
}

/**
 * Books and universes found on disk but not listed where they belong (a crash between writing a
 * new book and listing it, a sync client that dropped one line) are shown, never hidden: the lists
 * are order and a convenience, the files are the truth. Written back by the next change to the list.
 */
function adoptStrays(data: WorkspaceData, bookHome: Map<string, string>): WorkspaceData {
  const universes = data.universes.map((u) => {
    const strays = [...bookHome].filter(([id, home]) => home === u.id && !u.books.includes(id))
    return strays.length ? { ...u, books: [...u.books, ...strays.map(([id]) => id)] } : u
  })
  const unlisted = universes.map((u) => u.id).filter((id) => !data.workspace.universes.includes(id))
  const workspace = unlisted.length
    ? { ...data.workspace, universes: [...data.workspace.universes, ...unlisted] }
    : data.workspace
  return { ...data, universes, workspace }
}
