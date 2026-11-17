// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, effectScope, shallowRef, toRaw, watch } from 'vue'
import {
  continuityFindings,
  splitDismissed,
  type ContinuityFinding,
} from '@/domain/continuity-checks'
import { continuityModel, type ContinuityInput } from '@/domain/continuity'
import { mergeModels, universeModels } from '@/domain/continuity-universe'
import type { WorkspaceData } from '@/domain/workspace-data'
import { useWorkspaceStore } from '@/stores/workspace'

/** How long typing in a scene waits before the book is read for continuity again. */
const TYPING_PAUSE_MS = 400

/** True when only the text of scenes changed: the changes, times, people and order are the same objects. */
function onlyTextChanged(a: WorkspaceData | null, b: WorkspaceData | null) {
  if (!a || !b) return false
  if (
    a.universes !== b.universes ||
    a.books !== b.books ||
    a.chapters !== b.chapters ||
    a.parts !== b.parts ||
    a.records !== b.records ||
    a.scenes.length !== b.scenes.length
  )
    return false
  return a.scenes.every((s, i) => s.meta === b.scenes[i]!.meta)
}

function createContinuityModel() {
  const ws = useWorkspaceStore()
  // The book is read from a snapshot of the workspace. A change to anything but the words of a scene
  // takes effect at once; typing is waited out, so a keystroke does not read a long book again.
  const snapshot = shallowRef<WorkspaceData | null>(ws.data)
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(
    () => ws.data,
    (next, prev) => {
      clearTimeout(timer)
      if (!onlyTextChanged(prev, next)) snapshot.value = next
      else
        timer = setTimeout(() => {
          snapshot.value = ws.data
        }, TYPING_PAUSE_MS)
    },
    { flush: 'sync' },
  )

  // The store hands the index out wrapped as reactive, and the index fills its own caches as it is asked:
  // asked through the wrapper, that would write to what this computed has read, and it would never settle.
  const index = () => toRaw(ws.index)
  const inputFor = (data: WorkspaceData, bookId: string): ContinuityInput => ({
    data,
    bookId,
    named: (id) =>
      index()
        .foundNames(id)
        .filter((n) => n.target.kind === 'record')
        .map((n) => n.target.id),
    brokenLinks: (id) =>
      index()
        .linksTo(id)
        .filter((l) => l.status !== 'ok')
        .map((l) => ({ text: l.text, status: l.status as 'missing' | 'ambiguous' })),
  })
  const model = computed(() => {
    const data = snapshot.value
    const bookId = ws.bookId
    if (!data || !bookId || !data.books.some((b) => b.id === bookId)) return undefined
    return continuityModel(inputFor(data, bookId))
  })
  /** Every finding of the book, the ones marked intended included. */
  const all = computed(() => (model.value ? continuityFindings(model.value) : []))
  const split = computed(() => splitDismissed(all.value, ws.book?.dismissedFindings))

  // The whole universe: each book read from what is true at the end of the one before, and the books
  // laid end to end. Only read when a screen asks for it; the findings are read apart from the models,
  // so a screen that only draws the story (a progression) does not run every check of every book.
  const universe = computed(() => {
    const data = snapshot.value
    const bookId = ws.bookId
    if (!data || !bookId || !data.books.some((b) => b.id === bookId)) return undefined
    const models = universeModels(data, bookId, (id) => inputFor(data, id))
    return { data, models, merged: mergeModels(models) }
  })
  /** The findings of every book of the universe, each marked with its book, and split by that book's own marks. */
  const universeFindings = computed(() => {
    const u = universe.value
    if (!u) return undefined
    const tag = (f: ContinuityFinding, book: string): ContinuityFinding => ({ ...f, book })
    const parts = u.models.map((m) =>
      splitDismissed(
        continuityFindings(m).map((f) => tag(f, m.bookId)),
        u.data.books.find((b) => b.id === m.bookId)?.dismissedFindings,
      ),
    )
    return {
      all: parts.flatMap((p) => [...p.active, ...p.dismissed]),
      split: {
        active: parts.flatMap((p) => p.active),
        dismissed: parts.flatMap((p) => p.dismissed),
      },
    }
  })
  return { model, all, split, universe, universeFindings }
}

const shared = new WeakMap<object, ReturnType<typeof createContinuityModel>>()

/**
 * The open book read for continuity: its model (scenes in reading order, who is on the page, the
 * state at every scene) and its findings. One instance serves every screen that shows it, so the
 * inspector, the cards and the Continuity view read the book once.
 */
export function useContinuityModel() {
  const ws = useWorkspaceStore()
  let it = shared.get(ws)
  if (!it) {
    it = effectScope(true).run(createContinuityModel)!
    shared.set(ws, it)
  }
  return it
}
