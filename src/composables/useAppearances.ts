// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed } from 'vue'
import { appearances } from '@/index/appearances'
import { useWorkspaceStore } from '@/stores/workspace'
import { useNavigation } from './useNavigation'

/** The scenes a record appears in (linked or named), by book, across the whole universe. */
export function useAppearances(idOf: () => string) {
  const ws = useWorkspaceStore()
  const nav = useNavigation()
  const groups = computed(() => {
    void ws.indexVersion // look again whenever a scene or a name changed
    const universe = ws.universe
    const books = (ws.data?.books ?? [])
      .filter((b) => universe?.books.includes(b.id))
      .sort((a, b) => (universe?.books.indexOf(a.id) ?? 0) - (universe?.books.indexOf(b.id) ?? 0))
    return appearances(ws.index.backlinks(idOf()), books)
  })
  return {
    groups,
    total: computed(() => groups.value.reduce((n, g) => n + g.scenes.length, 0)),
    open: nav.openTarget,
  }
}
