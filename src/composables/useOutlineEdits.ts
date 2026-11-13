// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, effectScope } from 'vue'
import { useRouter } from 'vue-router'
import type { MenuItem } from '@/components/ui/Menu.vue'
import { isId } from '@/domain/ids'
import {
  planMove,
  planStep,
  stepAvailability,
  type Move,
  type MoveTarget,
} from '@/domain/outline-moves'
import { RECORD_INFO } from '@/domain/record-types'
import { wordsFor } from '@/storage/errors'
import {
  addBook,
  addChapter,
  addPart,
  applyMove,
  bookOf,
  deleteItem,
  renameItem,
  restoreDeleted,
} from '@/storage/outline-actions'
import { scenePath } from '@/router'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { altLabel, deleteLabel } from './useKeyboardShortcuts'
import { useNavigation } from './useNavigation'

/** What an item is called in a sentence: "scene", "chapter", a record's type. */
function kindWord(data: NonNullable<ReturnType<typeof useWorkspaceStore>['data']>, id: string) {
  if (isId(id, 'scn')) return 'scene'
  if (isId(id, 'chp')) return 'chapter'
  if (isId(id, 'prt')) return 'part'
  if (isId(id, 'bok')) return 'book'
  const type = data.records.find((r) => r.meta.id === id)?.meta.type
  return type ? RECORD_INFO[type].label.toLowerCase() : 'item'
}

export const titleOf = (
  data: NonNullable<ReturnType<typeof useWorkspaceStore>['data']>,
  id: string,
) =>
  data.scenes.find((s) => s.meta.id === id)?.meta.title ??
  data.records.find((r) => r.meta.id === id)?.meta.title ??
  [...data.books, ...data.chapters, ...data.parts].find((x) => x.id === id)?.title ??
  ''

/**
 * What the author does to the outline from the navigator and the palette: add, rename, delete
 * (to the trash, with a way back), reorder. Each is one storage action; this adds the questions
 * to ask, where to go afterwards, and the words when it does not work.
 */
function createOutlineEdits() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const router = useRouter()
  const nav = useNavigation()

  /** Which rows have a place above or below them: worked out once per change, not once per row. */
  const steps = computed(() => (ws.data ? stepAvailability(ws.data) : new Map()))

  /** A real workspace that can be written to; the sample is a tour. */
  const canEdit = computed(() => !!ws.session && !ws.view?.readOnly)

  async function guarded(work: () => Promise<void>) {
    try {
      await work()
    } catch (e) {
      edits.toast = { text: wordsFor(e, 'That did not work. Nothing was lost.'), error: true }
    }
  }

  /** After a delete or a restore: leave what is gone, and never sit on a screen with nothing in it. */
  async function settleRoute() {
    const data = ws.data
    if (!data) return
    const book = ws.bookId && ws.hasBook(ws.bookId) ? ws.bookId : data.books[0]?.id
    if (!book) return
    const sceneGone = !!ws.sceneId && !data.scenes.some((s) => s.meta.id === ws.sceneId)
    if (book !== ws.bookId || sceneGone) await nav.openBook(book)
  }

  function newBook(standalone = false) {
    const session = ws.session
    if (!session) return
    const inUniverse = ws.universe?.kind === 'shared' && !standalone ? ws.universe.id : undefined
    edits.ask = {
      title: inUniverse ? `New book in ${ws.universe?.title}` : 'New book',
      confirm: 'Create book',
      initial: '',
      run: async (title) => {
        const made = await addBook(session, {
          title,
          ...(inUniverse ? { universeId: inUniverse } : {}),
        })
        await router.push(scenePath(made.book, made.scene))
      },
    }
  }

  const newPart = (bookId = ws.bookId) =>
    guarded(async () => {
      if (ws.session && bookId) await addPart(ws.session, bookId)
    })

  /** A chapter (with its first scene) at the end of the book, or of a part; opened for writing. */
  const newChapter = (bookId = ws.bookId, partId?: string) =>
    guarded(async () => {
      if (!ws.session || !bookId) return
      const made = await addChapter(ws.session, bookId, partId ? { partId } : {})
      await router.push(scenePath(bookId, made.scene))
    })

  /** A scene at the end of a chapter; opened for writing. */
  const newScene = (chapterId?: string) =>
    guarded(async () => {
      const chapter = chapterId ?? ws.context?.chapter.chapter.id
      if (!chapter || !ws.bookId) return
      const id = await ws.addScene(chapter)
      if (id) await router.push(scenePath(ws.bookId, id))
    })

  function rename(id: string) {
    const session = ws.session
    const data = ws.data
    if (!session || !data) return
    edits.ask = {
      title: `Rename ${kindWord(data, id)}`,
      confirm: 'Save',
      initial: titleOf(data, id),
      run: (name) => renameItem(session, id, name),
    }
  }

  async function undo(stamp: string) {
    const session = ws.session
    if (!session) return
    await guarded(async () => {
      const result = await restoreDeleted(session, stamp)
      edits.toast = result.skipped.length
        ? {
            text: 'Part of it could not come back, because something else is in its place. It is still in Recently deleted.',
            error: true,
          }
        : null
    })
  }

  const remove = (id: string, keyboard = false) =>
    guarded(async () => {
      const session = ws.session
      if (!session) return
      const gone = await deleteItem(session, id)
      edits.toast = {
        text: `Moved “${gone.label}” to Recently deleted.`,
        undo: () => undo(gone.stamp),
        focusUndo: keyboard,
      }
      await settleRoute()
    })

  /** A move made, and said: a screen reader hears where the item went, since nothing else tells it. */
  async function moved(move: Move | null) {
    const data = ws.data
    if (!ws.session || !move || !data) return
    const what = titleOf(data, move.id)
    const where = move.target.where === 'inside' ? 'into' : move.target.where
    const words = `Moved “${what}” ${where} “${titleOf(data, move.target.id)}”`
    await applyMove(ws.session, move)
    await edits.announce(`${words}.`)
  }

  const step = (id: string, by: -1 | 1) =>
    guarded(() => moved(ws.data ? planStep(ws.data, id, by) : null))

  /** A scene to the end of a chapter (the "Move to chapter…" dialog, and filing an unfiled scene). */
  const moveToChapter = (id: string, chapter: string) =>
    guarded(() => moved(ws.data ? planMove(ws.data, id, { id: chapter, where: 'inside' }) : null))

  /** What a drag-and-drop does: the same move the keyboard makes. */
  const drop = (id: string, target: MoveTarget) =>
    guarded(() => moved(ws.data ? planMove(ws.data, id, target) : null))

  /**
   * Where a dragged row would land on this row, by where in it the pointer is: near the top or
   * bottom it goes before or after, in the middle (or when that does not fit) inside. Null when
   * the drop would be nonsense or change nothing.
   */
  function dropTarget(dragId: string, node: { id: string }, at: number): MoveTarget | null {
    const data = ws.data
    if (!data) return null
    const near = at < 0.5 ? 'before' : 'after'
    const tries: MoveTarget['where'][] =
      at < 0.3 ? ['before', 'inside'] : at > 0.7 ? ['after', 'inside'] : ['inside', near]
    const where = tries.find((w) => planMove(data, dragId, { id: node.id, where: w }))
    return where ? { id: node.id, where } : null
  }

  /** The actions a row offers, or none when the workspace cannot be written to. */
  function rowMenu(id: string): MenuItem[] {
    const data = ws.data
    if (!canEdit.value || !data) return []
    const rename: MenuItem = { id: 'rename', label: 'Rename…', icon: 'write', shortcut: 'F2' }
    const del: MenuItem = {
      id: 'delete',
      label: 'Delete',
      icon: 'trash',
      shortcut: deleteLabel,
      danger: true,
      separated: true,
    }
    const trash: MenuItem = { id: 'trash', label: 'Recently deleted…', icon: 'trash' }
    const order = (): MenuItem[] => [
      {
        id: 'up',
        label: 'Move up',
        icon: 'chevron-up',
        shortcut: `${altLabel} ↑`,
        disabled: !steps.value.get(id)?.up,
        separated: true,
      },
      {
        id: 'down',
        label: 'Move down',
        icon: 'chevron-down',
        shortcut: `${altLabel} ↓`,
        disabled: !steps.value.get(id)?.down,
      },
    ]
    if (isId(id, 'scn'))
      return [
        rename,
        ...order(),
        { id: 'move', label: 'Move to chapter…', icon: 'chapter' },
        del,
        trash,
      ]
    if (isId(id, 'chp'))
      return [rename, { id: 'new-scene', label: 'New scene', icon: 'plus' }, ...order(), del, trash]
    if (isId(id, 'prt'))
      return [
        rename,
        { id: 'new-chapter', label: 'New chapter here', icon: 'plus' },
        ...order(),
        del,
        trash,
      ]
    if (isId(id, 'bok'))
      return [
        rename,
        { id: 'new-part', label: 'New part', icon: 'part' },
        { id: 'new-chapter', label: 'New chapter', icon: 'chapter' },
        del, // the last book is refused in words when it is tried, not hidden
        trash,
      ]
    return data.records.some((r) => r.meta.id === id) ? [rename, del, trash] : []
  }

  /** A row's action, from its menu or its shortcut keys. */
  function onAction(id: string, action: string, keyboard = false) {
    const book = bookOf(ws.data!, id)
    if (action === 'rename') rename(id)
    else if (action === 'delete') void remove(id, keyboard)
    else if (action === 'trash') edits.trashOpen = true
    else if (action === 'up') void step(id, -1)
    else if (action === 'down') void step(id, 1)
    else if (action === 'move') edits.moving = id
    else if (action === 'new-scene') void newScene(id)
    else if (action === 'new-part') void newPart(book)
    else if (action === 'new-chapter') void newChapter(book, isId(id, 'prt') ? id : undefined)
  }

  return {
    canEdit,
    newBook,
    newPart,
    newChapter,
    newScene,
    rename,
    remove,
    undo,
    step,
    moveToChapter,
    drop,
    dropTarget,
    rowMenu,
    onAction,
  }
}

const shared = new WeakMap<object, ReturnType<typeof createOutlineEdits>>()

/**
 * What the author does to the outline from the navigator, the palette and the sheets. One
 * instance serves every caller of a store (its computed values are worked out once, not per
 * component); the first caller's component supplies the router.
 */
export function useOutlineEdits() {
  const ws = useWorkspaceStore()
  let edits = shared.get(ws)
  if (!edits) {
    edits = effectScope(true).run(createOutlineEdits)!
    shared.set(ws, edits)
  }
  return edits
}
