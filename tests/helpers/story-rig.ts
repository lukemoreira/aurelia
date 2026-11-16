// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { renameItem } from '@/storage/outline-actions'
import { setBookMode } from '@/storage/story-actions'
import { useWorkspaceStore } from '@/stores/workspace'
import { outlineRig } from './outline-rig'

/**
 * A real workspace, open in the workspace store, with a branching book of three scenes in one
 * chapter: Start, Left, Right. The test file mocks `vue-router` itself.
 */
export async function storyRig() {
  setActivePinia(createPinia())
  const rig = await outlineRig()
  const { session } = rig
  const ws = useWorkspaceStore()
  ws.attach(session)
  const book = session.data.books[0]!.id
  const chapter = session.data.chapters[0]!.id
  const start = session.data.scenes[0]!.meta.id
  await renameItem(session, start, 'Start')
  const left = await session.createScene(chapter)
  await renameItem(session, left, 'Left')
  const right = await session.createScene(chapter)
  await renameItem(session, right, 'Right')
  await setBookMode(session, book, 'branching')
  await session.flush()
  ws.select(book, start)
  return { ...rig, ws, book, chapter, start, left, right }
}
