// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from 'vue-router'
import { isId } from '@/domain/ids'
import type { Entry } from '@/index/palette-entries'
import { scenePath, viewPath, type ViewName } from '@/router'
import { useWorkspaceStore } from '@/stores/workspace'

/** Every way of moving around the workspace goes through here, so each one is a route. */
export function useNavigation() {
  const router = useRouter()
  const ws = useWorkspaceStore()

  function openBook(bookId: string) {
    const scene = ws.sceneFor(bookId)
    return router.push(scene ? scenePath(bookId, scene) : viewPath(bookId, 'plan'))
  }
  function openScene(bookId: string, sceneId: string) {
    return router.push(scenePath(bookId, sceneId))
  }
  /** Where a view tab goes: Write returns to the book's current scene. */
  function viewHref(view: ViewName): string | undefined {
    const book = ws.bookId
    if (!book) return undefined
    if (view !== 'write') return viewPath(book, view)
    const scene = ws.sceneFor(book)
    return scene ? scenePath(book, scene) : viewPath(book, 'plan')
  }
  function openView(view: ViewName) {
    const href = viewHref(view)
    if (href) return router.push(href)
  }
  function openRecord(bookId: string, recordId: string) {
    return router.push({ path: viewPath(bookId, 'world'), query: { record: recordId } })
  }
  function openChapter(chapterId: string) {
    const chapter = ws.data?.chapters.find((c) => c.id === chapterId)
    const first = ws.data?.scenes.find((s) => s.meta.chapter === chapterId)
    if (chapter && first) return openScene(chapter.book, first.meta.id)
  }
  function openEntry(entry: Entry) {
    const book = entry.bookId ?? ws.bookId
    if (entry.kind === 'book') return openBook(entry.id)
    if (entry.kind === 'chapter') return openChapter(entry.id)
    if (!book) return
    return entry.kind === 'scene' ? openScene(book, entry.id) : openRecord(book, entry.id)
  }

  /** Open whatever an id names: a scene, a chapter, a book or a record. Groups and parts do nothing. */
  function openId(id: string | undefined) {
    if (!id) return
    if (isId(id, 'scn')) return openScene(ws.bookId ?? '', id)
    if (isId(id, 'chp')) return openChapter(id)
    if (isId(id, 'bok')) return openBook(id)
    if (!id.startsWith('lib:') && !isId(id, 'prt') && ws.bookId) return openRecord(ws.bookId, id)
  }

  return { openBook, openScene, viewHref, openView, openRecord, openChapter, openEntry, openId }
}
