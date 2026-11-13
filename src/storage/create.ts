// SPDX-License-Identifier: AGPL-3.0-or-later
import { CURRENT_SCHEMA_VERSION } from '@/domain/schema/common'
import { newId } from '@/domain/ids'
import type { Book, Chapter } from '@/domain/schema/book'
import type { Scene } from '@/domain/schema/scene'
import type { Universe } from '@/domain/schema/universe'
import type { StorageAdapter } from './adapter'
import { newHead } from './frontmatter'
import { WORKSPACE_FILE, bookPath, chapterPath, scenePath, universePath } from './paths'
import { newSceneText } from './scene-file'

const V = CURRENT_SCHEMA_VERSION
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

export const MAX_NAME = 80

/** What is in a folder someone picked: a workspace, nothing, or something that is not ours to write into. */
export type FolderState =
  { state: 'workspace' } | { state: 'empty' } | { state: 'other'; names: string[] }

// Files an operating system adds to a folder the author never made.
export const SYSTEM_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

export async function inspectFolder(adapter: StorageAdapter): Promise<FolderState> {
  const names = (await adapter.list({ shallow: true })).filter((n) => !SYSTEM_FILES.has(n))
  if (names.includes(WORKSPACE_FILE)) return { state: 'workspace' }
  return names.length ? { state: 'other', names } : { state: 'empty' }
}

/**
 * Write a minimal, valid workspace (ADR-0003): one universe, one book, one chapter and one
 * empty scene, all with real IDs. `aurelia.json` goes last, so a folder only counts as a
 * workspace once everything else is in it.
 */
export async function createWorkspace(
  adapter: StorageAdapter,
  name: string,
  workspaceId = newId('wsp'),
): Promise<void> {
  const unv = newId('unv')
  const bok = newId('bok')
  const chp = newId('chp')
  const scn = newId('scn')
  const universe: Universe = {
    title: name,
    schemaVersion: V,
    id: unv,
    kind: 'standalone',
    books: [bok],
  }
  const book: Book = {
    title: name,
    schemaVersion: V,
    id: bok,
    mode: 'linear',
    outline: [{ chapter: chp, scenes: [scn] }],
  }
  const chapter: Chapter = {
    title: 'Chapter one',
    schemaVersion: V,
    id: chp,
    book: bok,
    order: 'a',
  }
  const scene: Scene = {
    title: 'Untitled scene',
    schemaVersion: V,
    id: scn,
    chapter: chp,
    order: 'a',
  }

  await adapter.write(scenePath(unv, bok, scn), newSceneText(scene))
  await adapter.write(chapterPath(unv, bok, chp), newHead(chapter))
  await adapter.write(bookPath(unv, bok), json(book))
  await adapter.write(universePath(unv), newHead(universe))
  await adapter.write(
    WORKSPACE_FILE,
    json({ schemaVersion: V, id: workspaceId, name, universes: [unv] }),
  )
}
