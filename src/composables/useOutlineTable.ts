// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, nextTick, ref } from 'vue'
import type { MenuItem } from '@/components/ui/Menu.vue'
import { isId } from '@/domain/ids'
import { useNavigation } from './useNavigation'
import { usePlan } from './usePlan'
import { useTreeDrag } from './useTreeDrag'
import { useVirtualRows } from './useVirtualRows'

/** A row's height. The same for every row, which is what lets the table draw only the ones in view. */
export const ROW_HEIGHT = 44
/** The sticky header above the rows. */
export const HEADER_HEIGHT = 36

/**
 * The outline table: which rows are in the page, drag-and-drop (the same moves as the navigator),
 * and the keyboard (arrows between rows, Alt+↑/↓ to move, F2 to rename, Enter to open).
 */
export function useOutlineTable() {
  const p = usePlan()
  const nav = useNavigation()
  const scroller = ref<HTMLElement | null>(null)
  const count = computed(() => p.rows.value.length)
  const { range, before, after, reveal } = useVirtualRows(
    count,
    ROW_HEIGHT,
    scroller,
    HEADER_HEIGHT,
  )
  const visible = computed(() => p.rows.value.slice(range.value.start, range.value.end))

  const drag = useTreeDrag(
    () => p.edit.dropTarget,
    (id, target) => void p.edit.drop(id, target),
  )

  const indexOf = (id: string) => p.rows.value.findIndex((r) => r.id === id)
  /** Put keyboard focus on a row's title, drawing the row first if it is out of the window. */
  async function focusRow(id: string) {
    const i = indexOf(id)
    if (i < 0) return
    reveal(i)
    await nextTick()
    await nextTick()
    scroller.value?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)?.focus()
  }

  async function onKey(e: KeyboardEvent, id: string) {
    const i = indexOf(id)
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      await p.edit.step(id, e.key === 'ArrowUp' ? -1 : 1)
      await focusRow(id)
    } else if (
      !e.altKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    ) {
      e.preventDefault()
      const next = p.rows.value[i + (e.key === 'ArrowUp' ? -1 : 1)]
      if (next) await focusRow(next.id)
    } else if (e.key === 'F2' && p.edit.canEdit.value && id !== 'unfiled') {
      e.preventDefault()
      p.edit.rename(id)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void nav.openId(id === 'unfiled' ? undefined : id)
    }
  }

  /** The row's actions menu: what the navigator offers, with "Open in Write" first for a scene. */
  function menu(id: string): MenuItem[] {
    const own = p.edit.rowMenu(id)
    return isId(id, 'scn') ? [{ id: 'open', label: 'Open in Write', icon: 'write' }, ...own] : own
  }
  function onAction(id: string, action: string) {
    if (action === 'open') void nav.openId(id)
    else p.edit.onAction(id, action)
  }

  return { ...p, scroller, visible, before, after, range, drag, onKey, menu, onAction, focusRow }
}
