// SPDX-License-Identifier: AGPL-3.0-or-later
// Make the book an import planned (ADR-0014). It is always a NEW book: nothing that is in the workspace is
// changed, so an import can never cost an author their words. The book's files go first and are saved one
// by one; the line that lists the book (in a shared universe, or in `aurelia.json`) goes last, so a stop
// leaves files that are shown as an unlisted book, never a listing with nothing behind it.
import { newId } from '@/domain/ids'
import { planFiles, planIds, type ImportPlan } from '@/import/plan'
import { CURRENT_SCHEMA_VERSION } from '@/domain/schema/common'
import { checkTitle } from '@/domain/titles'
import type { StorageAdapter } from './adapter'
import { StorageError } from './errors'
import { newHead } from './frontmatter'
import { setTopLevel } from './json-edit'
import { freshId, syncOutline } from './outline-actions'
import { WORKSPACE_FILE, universePath } from './paths'
import type { WorkspaceSession } from './session'

const V = CURRENT_SCHEMA_VERSION
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

/** The scene to open after an import: where the story starts, else the first one. */
const firstScene = (plan: ImportPlan) => plan.start ?? plan.chapters[0]?.scenes[0]?.key

/**
 * The plan as a new book of the open workspace: in `universeId` when that is a shared universe, else a book
 * of its own (as "New book" makes one). Returns the book and the scene to open.
 */
export async function importBook(
  s: WorkspaceSession,
  plan: ImportPlan,
  opts: { title?: string; universeId?: string } = {},
): Promise<{ book: string; scene: string }> {
  const name = checkTitle(opts.title ?? plan.title)
  if (!name.ok) throw new StorageError('other', name.error || 'Give the book a name.')
  const made = { ...plan, title: name.title }
  let result = { book: '', scene: '' }
  await s.exclusive(async () => {
    const shared = opts.universeId
      ? s.data.universes.find((u) => u.id === opts.universeId && u.kind === 'shared')
      : undefined
    const unv = shared?.id ?? freshId(s, 'unv')
    const ids = planIds(made, unv, (prefix) => freshId(s, prefix))
    // A book of its own: its universe first (listing it), as "New book" does, so a stop never leaves a book in no universe.
    // Then its files, content first; the workspace's list of universes, and a shared universe's list of books, last.
    if (!shared)
      await s.create([
        {
          path: universePath(unv),
          text: newHead({
            title: made.title,
            schemaVersion: V,
            id: unv,
            kind: 'standalone',
            books: [ids.book],
          }),
        },
      ])
    await s.create(planFiles(made, ids))
    if (shared) await s.setFields(shared.id, { books: [...shared.books, ids.book] })
    else {
      const list = [...s.data.workspace.universes.filter((u) => u !== unv), unv]
      await s.write(WORKSPACE_FILE, setTopLevel(s.current(WORKSPACE_FILE) ?? '', 'universes', list))
    }
    await s.flushPaths([...(await syncOutline(s, ids.book)), universePath(unv), WORKSPACE_FILE])
    const first = firstScene(made)
    result = { book: ids.book, scene: (first && ids.scenes.get(first)) || '' }
  })
  return result
}

/**
 * A new workspace that holds only the imported book (the Welcome screen's import): the book's files, its
 * universe, and `aurelia.json` last, so a folder only counts as a workspace once everything is in it. The
 * caller opens it and regenerates the outline files (`regenerateOutlines`).
 */
export async function createImportedWorkspace(
  adapter: StorageAdapter,
  name: string,
  plan: ImportPlan,
  workspaceId = newId('wsp'),
): Promise<void> {
  const unv = newId('unv')
  const ids = planIds(plan, unv, (prefix) => newId(prefix))
  // The book is named as the workspace is: the name the author gave in the preview.
  for (const f of planFiles({ ...plan, title: name }, ids)) await adapter.write(f.path, f.text)
  await adapter.write(
    universePath(unv),
    newHead({ title: name, schemaVersion: V, id: unv, kind: 'standalone', books: [ids.book] }),
  )
  await adapter.write(
    WORKSPACE_FILE,
    json({ schemaVersion: V, id: workspaceId, name, universes: [unv] }),
  )
}
