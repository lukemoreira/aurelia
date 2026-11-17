// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, effectScope, shallowRef, watch, type ShallowRef } from 'vue'
import type { RecordType } from '@/domain/schema/record'
import type { NewName } from '@/index/new-names'
import { changeNotNames } from '@/storage/names-actions'
import { addRecord } from '@/storage/record-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGuarded } from './useGuarded'
import { useNavigation } from './useNavigation'
import { useOutlineEdits } from './useOutlineEdits'

/** How long typing must pause before the list is worked out again (it reads every scene of the book). */
const PAUSE_MS = 700

type Workspace = ReturnType<typeof useWorkspaceStore>
const scans = new WeakMap<Workspace, ShallowRef<NewName[]>>()

/**
 * The one scan of the open book for new names, however many screens show it (the World list's
 * count, the panel, the Names tab): it reads every scene, so it is done once. A name, a record or
 * another book changes the answer at once; typing in a scene waits for a pause.
 */
function sharedScan(ws: Workspace): ShallowRef<NewName[]> {
  const known = scans.get(ws)
  if (known) return known
  const names = shallowRef<NewName[]>([])
  const refresh = () => (names.value = ws.bookId ? ws.index.newNames(ws.bookId) : [])
  // Detached: it belongs to the workspace, not to the screen that asked first.
  effectScope(true).run(() => {
    watch([() => ws.structureVersion, () => ws.bookId, () => ws.book?.notNames], refresh, {
      immediate: true,
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    watch(
      () => ws.indexVersion,
      () => {
        clearTimeout(timer)
        timer = setTimeout(refresh, PAUSE_MS)
      },
    )
  })
  scans.set(ws, names)
  return names
}

/**
 * The Names panel's new names (ADR-0010 §5): capitalised words that recur in this book and are not
 * a record yet. Create character, create place, or "not a name" (which can be given back) — each
 * is the author's click, and none writes into a scene.
 */
export function useNewNames() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const edit = useOutlineEdits()
  const nav = useNavigation()
  const guarded = useGuarded()
  const names = sharedScan(ws)

  /** Make a record of the word, shared by the universe; the word is then a name, so it leaves the list. */
  const create = (found: NewName, type: Extract<RecordType, 'character' | 'place'>) =>
    guarded(async () => {
      const session = ws.session
      const universe = ws.universe
      if (!session || !universe) return
      const id = await addRecord(session, { type, title: found.word, universeId: universe.id })
      edits.toast = {
        text: `Made “${found.word}” a ${type}.`,
        action: { label: 'Open', run: () => void nav.openTarget({ kind: 'record', id }) },
      }
    })

  /** "Not a name": the book remembers, on every device; Undo (or "Give back" in the list) gives the word back. */
  const notAName = (found: NewName) =>
    guarded(async () => {
      const session = ws.session
      const book = ws.book
      if (!session || !book) return
      await changeNotNames(session, book.id, { add: found.word })
      edits.toast = {
        text: `“${found.word}” is not a name.`,
        undo: () => guarded(() => changeNotNames(session, book.id, { remove: found.word })),
      }
    })

  /** Offer a word again that was said not to be a name. */
  const giveBack = (word: string) =>
    guarded(async () => {
      if (ws.session && ws.book) await changeNotNames(ws.session, ws.book.id, { remove: word })
    })

  return {
    names,
    /** Words the author said are not names, in this book: they can be given back. */
    dismissed: computed(() => ws.book?.notNames ?? []),
    canEdit: edit.canEdit,
    create,
    notAName,
    giveBack,
    /** Take the author to the first scene the word stands in. */
    openFirst: (found: NewName) => {
      const scene = found.places[0]
      if (scene && ws.bookId) void nav.openScene(ws.bookId, scene.id)
    },
  }
}
