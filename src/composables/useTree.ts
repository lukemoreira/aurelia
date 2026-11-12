// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, type MaybeRefOrGetter, toValue } from 'vue'
import type { IconName, StatusKind } from '@/domain/ui-names'

export interface TreeNode {
  id: string
  label: string
  icon?: IconName
  status?: StatusKind
  meta?: string
  /** Shows a pin button on the row; this is the key the pin toggles. */
  pinKey?: string
  children?: TreeNode[]
}

/** Maps between the ids the app uses and the node objects Reka's Tree selects. */
export function useTreeNodes(
  items: MaybeRefOrGetter<TreeNode[]>,
  selectedId: MaybeRefOrGetter<string | undefined>,
) {
  const byId = computed(() => {
    const map = new Map<string, TreeNode>()
    const walk = (nodes: TreeNode[]) =>
      nodes.forEach((n) => {
        map.set(n.id, n)
        if (n.children) walk(n.children)
      })
    walk(toValue(items))
    return map
  })
  const selected = computed(() => byId.value.get(toValue(selectedId) ?? ''))
  return { selected }
}
