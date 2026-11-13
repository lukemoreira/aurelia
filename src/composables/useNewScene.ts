// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from 'vue-router'
import { scenePath } from '@/router'
import { useWorkspaceStore } from '@/stores/workspace'

/** "New scene": an empty scene after the last one in the open chapter, opened for writing. */
export function useNewScene() {
  const ws = useWorkspaceStore()
  const router = useRouter()
  return async function newScene() {
    const chapter = ws.context?.chapter.chapter
    if (!chapter || ws.view?.readOnly) return
    const id = await ws.addScene(chapter.id)
    if (id) await router.push(scenePath(chapter.book, id))
  }
}
