// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { MenuItem } from '@/components/ui/Menu.vue'
import { LIBRARY_GROUPS, NEW_RECORD_TYPES, RECORD_INFO } from '@/domain/record-types'
import type { RecordType } from '@/domain/schema/record'
import { fold } from '@/index/palette-search'
import { viewPath } from '@/router'
import { useWorkspaceStore } from '@/stores/workspace'
import { useRecordEdits } from './useRecordEdits'

/** The World view: the records of this book and its universe, by kind, filtered by name, and the one open. */
export function useWorld() {
  const ws = useWorkspaceStore()
  const route = useRoute()
  const router = useRouter()
  const { newRecord } = useRecordEdits()
  const filter = ref('')

  /** Shared records of this universe, and the ones private to this book. */
  const visible = computed(() =>
    (ws.data?.records ?? []).filter((r) =>
      r.meta.scope === 'universe'
        ? r.universe === ws.universe?.id
        : r.meta.scope === `book:${ws.bookId}`,
    ),
  )
  const groups = computed(() => {
    const q = fold(filter.value)
    return LIBRARY_GROUPS.flatMap((g) => {
      const items = visible.value
        .filter((r) => g.types.includes(r.meta.type) && (!q || fold(r.meta.title).includes(q)))
        .sort((a, b) => a.meta.title.localeCompare(b.meta.title))
      return items.length ? [{ ...g, items }] : []
    })
  })

  const selectedId = computed(() =>
    typeof route.query.record === 'string' ? route.query.record : undefined,
  )
  /** The open record, if it is still there. */
  const selected = computed(() => ws.data?.records.find((r) => r.meta.id === selectedId.value))

  const open = (id: string) =>
    ws.bookId && router.push({ path: viewPath(ws.bookId, 'world'), query: { record: id } })
  const close = () => ws.bookId && router.push({ path: viewPath(ws.bookId, 'world') })

  /**
   * What New offers. In a shared universe each kind is made shared or for this book only (the
   * choice is part of the action, not a setting that looks like a filter); a standalone book has
   * nothing to share with, so there is no choice.
   */
  const newItems = computed<MenuItem[]>(() => {
    const shared = ws.universe?.kind === 'shared'
    return NEW_RECORD_TYPES.flatMap((t): MenuItem[] => {
      const word = `New ${RECORD_INFO[t].label.toLowerCase()}`
      const icon = RECORD_INFO[t].icon
      return shared
        ? [
            { id: `${t}:universe`, label: `${word} — shared`, icon },
            { id: `${t}:book`, label: `${word} — this book only`, icon },
          ]
        : [{ id: `${t}:universe`, label: word, icon }]
    })
  })

  return {
    filter,
    groups,
    total: computed(() => visible.value.length),
    selectedId,
    selected,
    open,
    close,
    newItems,
    create: (id: string) => {
      const [type, scope] = id.split(':')
      newRecord(type as RecordType, scope === 'book' ? 'book' : 'universe')
    },
  }
}
