// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, nextTick, ref, watch } from 'vue'
import { useNavigation } from './useNavigation'
import { usePlan } from './usePlan'
import { useTreeDrag } from './useTreeDrag'

/** How many chapter columns are drawn at once (a book of 120 chapters is paged, not stretched). */
export const COLUMNS_PER_PAGE = 4

/**
 * The corkboard: chapters are columns, scenes are cards. A page of columns at a time, moved with
 * the range buttons; drag a card (or Alt+arrows) and the manuscript follows, one file per move.
 */
export function useCorkboard() {
  const p = usePlan()
  const nav = useNavigation()
  const root = ref<HTMLElement | null>(null)
  const start = ref(0)
  const perPage = ref(COLUMNS_PER_PAGE)

  const columns = computed(() => p.chapters.value)
  const shown = computed(() => columns.value.slice(start.value, start.value + perPage.value))
  const first = computed(() => start.value + 1)
  const last = computed(() => Math.min(columns.value.length, start.value + perPage.value))
  const rangeLabel = computed(() =>
    first.value === last.value
      ? `Chapter ${first.value} of ${columns.value.length}`
      : `Chapters ${first.value}–${last.value} of ${columns.value.length}`,
  )
  const canPrev = computed(() => start.value > 0)
  const canNext = computed(() => start.value + perPage.value < columns.value.length)
  const page = (by: -1 | 1) =>
    (start.value = Math.max(
      0,
      Math.min(Math.max(0, columns.value.length - perPage.value), start.value + by * perPage.value),
    ))

  // A book that has become shorter (a delete, a restore) must not leave the page past its end.
  watch(
    () => columns.value.length,
    () => (start.value = Math.min(start.value, Math.max(0, columns.value.length - perPage.value))),
  )
  /** Show the column of a scene or chapter (the selection moved to one that is off the page). */
  function reveal(id: string | null) {
    const i = columns.value.findIndex((c) => c.id === id || c.scenes.some((s) => s.id === id))
    if (i < 0) return
    if (i < start.value) start.value = i
    else if (i >= start.value + perPage.value) start.value = i - perPage.value + 1
  }
  watch(() => p.plan.selected, reveal)

  const drag = useTreeDrag(
    () => p.edit.dropTarget,
    (id, target) => void p.edit.drop(id, target),
  )

  async function focusCard(id: string) {
    await nextTick()
    await nextTick()
    root.value?.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`)?.focus()
  }

  async function onKey(e: KeyboardEvent, id: string) {
    const col = columns.value.findIndex((c) => c.scenes.some((s) => s.id === id))
    const cards = columns.value[col]?.scenes ?? []
    const row = cards.findIndex((s) => s.id === id)
    const arrow = (k: string) => e.key === k && !e.metaKey && !e.ctrlKey
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      await p.edit.step(id, e.key === 'ArrowUp' ? -1 : 1)
      await focusCard(id)
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      const to = columns.value[col + (e.key === 'ArrowLeft' ? -1 : 1)]
      if (to?.id) {
        await p.edit.moveToChapter(id, to.id)
        reveal(id)
        await focusCard(id)
      }
    } else if (arrow('ArrowUp') || arrow('ArrowDown')) {
      e.preventDefault()
      const next = cards[row + (e.key === 'ArrowUp' ? -1 : 1)]
      if (next) await focusCard(next.id)
    } else if (arrow('ArrowLeft') || arrow('ArrowRight')) {
      e.preventDefault()
      const to = columns.value[col + (e.key === 'ArrowLeft' ? -1 : 1)]
      const near = to?.scenes[Math.min(row, to.scenes.length - 1)]
      if (near) {
        reveal(near.id)
        await focusCard(near.id)
      }
    } else if (e.key === 'F2' && p.edit.canEdit.value) {
      e.preventDefault()
      p.edit.rename(id)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void nav.openId(id)
    }
  }

  const progress = (words: number, target?: number) =>
    target ? Math.min(100, Math.round((words / target) * 100)) : undefined

  /** A chapter past its word target (the board says so in words, not only in colour). */
  const over = (words: number, target?: number) => !!target && words > target

  return {
    ...p,
    root,
    perPage,
    shown,
    rangeLabel,
    canPrev,
    canNext,
    page,
    drag,
    onKey,
    progress,
    over,
  }
}
