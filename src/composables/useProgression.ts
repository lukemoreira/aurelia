// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, watch } from 'vue'
import type { Scope } from '@/domain/continuity-universe'
import { stateRows } from '@/domain/continuity-views'
import { progression } from '@/domain/progression'
import { useWorkspaceStore } from '@/stores/workspace'
import { useContinuityModel } from './useContinuityModel'
import { useNavigation } from './useNavigation'

/** How many chapters the table shows at a time: a book of 120 chapters is read a stretch at a time. */
export const CHAPTERS_SHOWN = 24

/**
 * One character's Progression tab: where they are on the page chapter by chapter, a scrubber over
 * the story in reading order that shows the state at the scene it rests on, and every change
 * recorded about them. Read from the one continuity model — this book's, or the universe's books
 * end to end. Nothing here is written: changes are made on the scenes.
 */
export function useProgression(idOf: () => string) {
  const ws = useWorkspaceStore()
  const { model, universe } = useContinuityModel()
  const nav = useNavigation()

  const scope = ref<Scope>('book')
  const bookCount = computed(() => ws.universe?.books.length ?? 1)
  const wide = computed(() => scope.value === 'universe' && bookCount.value > 1)
  const m = computed(() => (wide.value ? universe.value?.merged : model.value))
  const p = computed(() => (m.value ? progression(m.value, idOf(), wide.value) : undefined))

  /** Where the scrubber rests, as the author left it; until then, the last scene they are on the page in. */
  const moved = ref<number>()
  watch([idOf, scope], () => (moved.value = undefined))
  const count = computed(() => p.value?.scenes.length ?? 0)
  const at = computed(() =>
    Math.min(Math.max(0, moved.value ?? p.value?.start ?? 0), Math.max(0, count.value - 1)),
  )
  const scene = computed(() => p.value?.scenes[at.value])
  const move = (to: number) => (moved.value = Math.min(Math.max(0, to), count.value - 1))
  /** The scrubber on the last scene of a chapter: the state at its end. */
  const goTo = (sceneId: string | undefined) => {
    const i = p.value?.scenes.findIndex((s) => s.id === sceneId) ?? -1
    if (i >= 0) move(i)
  }

  const state = computed(() =>
    m.value && scene.value ? stateRows(m.value, scene.value.id, idOf(), wide.value, true) : [],
  )
  /** Whether they are on the page anywhere: with nobody to follow yet there is no progression to show. */
  const appears = computed(() => p.value?.scenes.some((s) => s.present) ?? false)

  // The stretch of chapters in the table, and it follows the scrubber: a scene in a later stretch turns to it.
  const from = ref(0)
  watch([idOf, scope], () => (from.value = 0))
  const chapters = computed(() => p.value?.chapters ?? [])
  const paged = computed(() => chapters.value.length > CHAPTERS_SHOWN)
  watch(
    [at, () => chapters.value.length],
    () => {
      const i = chapters.value.findIndex((c) => at.value >= c.first && at.value <= c.end)
      if (i >= 0) from.value = Math.floor(i / CHAPTERS_SHOWN) * CHAPTERS_SHOWN
    },
    { immediate: true },
  )
  const shown = computed(() =>
    paged.value ? chapters.value.slice(from.value, from.value + CHAPTERS_SHOWN) : chapters.value,
  )
  /** "Chapters 25–48 of 120": what the table shows, among a long book's chapters. */
  const rangeWords = computed(
    () =>
      `Chapters ${from.value + 1}–${Math.min(chapters.value.length, from.value + CHAPTERS_SHOWN)} of ${chapters.value.length}`,
  )
  const page = (by: -1 | 1) =>
    (from.value = Math.max(
      0,
      Math.min(chapters.value.length - 1, from.value + by * CHAPTERS_SHOWN),
    ))
  const canPage = (by: -1 | 1) =>
    by < 0 ? from.value > 0 : from.value + CHAPTERS_SHOWN < chapters.value.length

  /** Open a scene (in its own book, in a universe) in the editor. */
  const open = (sceneId: string) => {
    const book = m.value?.byId.get(sceneId)?.book
    if (book) return nav.openScene(book, sceneId)
  }

  return {
    scope,
    bookCount,
    p,
    count,
    at,
    scene,
    move,
    goTo,
    state,
    appears,
    paged,
    rangeWords,
    page,
    canPage,
    shown,
    open,
  }
}
