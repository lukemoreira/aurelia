// SPDX-License-Identifier: AGPL-3.0-or-later
import { ref } from 'vue'
import type { MoveTarget } from '@/domain/outline-moves'
import type { TreeNode } from './useTree'

/**
 * Drag and drop for tree rows, with the browser's own drag events. Which drops make sense is the
 * caller's to say (`resolve`: the row's id, where in the row the pointer is, 0 at the top and 1 at
 * the bottom); a row that answers null is not a drop target. Touch screens do not drag: the row
 * menu offers the same moves.
 */
export function useTreeDrag(
  resolve: () => ((dragId: string, node: TreeNode, at: number) => MoveTarget | null) | undefined,
  drop: (id: string, target: MoveTarget) => void,
) {
  const dragging = ref<string | null>(null)
  /** Where the drop would land: the row and which side of it. */
  const over = ref<MoveTarget | null>(null)

  const target = (e: DragEvent, node: TreeNode) => {
    const row = e.currentTarget as HTMLElement
    const box = row.getBoundingClientRect()
    return dragging.value
      ? (resolve()?.(dragging.value, node, (e.clientY - box.top) / (box.height || 1)) ?? null)
      : null
  }

  return {
    dragging,
    over,
    start(e: DragEvent, node: TreeNode) {
      dragging.value = node.id
      e.dataTransfer?.setData('text/plain', node.label)
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    },
    move(e: DragEvent, node: TreeNode) {
      const t = target(e, node)
      over.value = t ? { id: node.id, where: t.where } : null
      if (t) {
        e.preventDefault() // this row takes the drop
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      }
    },
    leave(node: TreeNode) {
      if (over.value?.id === node.id) over.value = null
    },
    drop(e: DragEvent, node: TreeNode) {
      const t = target(e, node)
      const id = dragging.value
      this.end()
      if (t && id) {
        e.preventDefault()
        drop(id, t)
      }
    },
    end() {
      dragging.value = null
      over.value = null
    },
  }
}
