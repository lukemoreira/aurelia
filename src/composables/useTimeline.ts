// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, reactive, ref, watch, type Ref } from 'vue'
import type { ContinuityModel } from '@/domain/continuity'
import { timeline, type TimelineItem, type Zoom } from '@/domain/timeline'
import { useNavigation } from './useNavigation'

/** A group of more items than this is shown in a scrolling window, a screenful of rows drawn at a time. */
export const WINDOW_AT = 60

/** Up to this many items every group starts open; a longer story opens only the first. */
const OPEN_ALL = 80

/**
 * The timeline of the model in view (a book, or the universe's books): one calendar at a time, grouped
 * by era, year, month or day, with the groups that open and close. Nothing here is written.
 */
export function useTimeline(model: Ref<ContinuityModel | undefined>) {
  const nav = useNavigation()
  const calendar = ref<string>()
  const zoom = ref<Zoom>('year')
  const tl = computed(() =>
    model.value ? timeline(model.value, calendar.value, zoom.value) : undefined,
  )

  const count = computed(() => tl.value?.groups.reduce((n, g) => n + g.items.length, 0) ?? 0)
  const toggled = reactive(new Map<string, boolean>())
  watch([calendar, zoom], () => toggled.clear())
  const isOpen = (key: string, first: boolean) =>
    toggled.get(key) ?? (count.value <= OPEN_ALL || first)
  const toggle = (key: string, first: boolean) => toggled.set(key, !isOpen(key, first))

  /** Scenes open in the editor (in their own book); an event opens its sheet. */
  const open = (item: TimelineItem) =>
    item.kind === 'scene' && item.bookId
      ? nav.openScene(item.bookId, item.id)
      : nav.openTarget({ kind: 'record', id: item.id })

  return { tl, calendar, zoom, count, isOpen, toggle, open }
}
