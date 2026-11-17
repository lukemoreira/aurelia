// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, watch } from 'vue'
import type { MenuItem } from '@/components/ui/Menu.vue'
import {
  canMovePlace,
  placeAncestors,
  placeChildren,
  placeTree,
  stepTarget,
  type PlaceNode,
} from '@/domain/places'
import type { MoveTarget } from '@/domain/outline-moves'
import { movePlace } from '@/storage/world-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import type { TreeNode } from './useTree'
import { useGuarded } from './useGuarded'
import { useNavigation } from './useNavigation'
import { useOutlineEdits } from './useOutlineEdits'
import { useRecordEdits } from './useRecordEdits'
import { useVisibleRecords } from './useWorld'
import { altLabel, deleteLabel } from './useKeyboardShortcuts'

/** What the "Move to…" choice of the top level is called (a Select cannot hold an empty value). */
export const PLACE_TOP = 'top'

/** The places and worlds as a tree, and every way of moving one: drag, the keyboard, "Move to…". */
export function usePlaces() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const edit = useOutlineEdits()
  const nav = useNavigation()
  const guarded = useGuarded()
  const { newRecord } = useRecordEdits()
  const records = useVisibleRecords()

  const nodes = computed<TreeNode[]>(() => {
    const draggable = edit.canEdit.value
    const toNode = (n: PlaceNode): TreeNode => ({
      id: n.id,
      label: n.title,
      icon: n.type === 'world' ? 'globe' : 'place',
      draggable,
      ...(n.kind ? { meta: n.kind } : {}),
      ...(n.children.length ? { children: n.children.map(toNode) } : {}),
    })
    return placeTree(records.value).map(toNode)
  })

  // Everything with something inside it starts open; a place that comes later opens too.
  const expanded = ref<string[]>([])
  const seen = new Set<string>()
  watch(
    nodes,
    (list) => {
      const walk = (ns: TreeNode[]) =>
        ns.forEach((n) => {
          if (n.children && !seen.has(n.id)) {
            seen.add(n.id)
            expanded.value = [...expanded.value, n.id]
          }
          if (n.children) walk(n.children)
        })
      walk(list)
    },
    { immediate: true },
  )

  /** Put a place inside another (null: at the top), say where it went, and offer the way back. */
  const move = (id: string, parentId: string | null) =>
    guarded(async () => {
      const session = ws.session
      const data = ws.data
      if (!session || !data) return
      const record = data.records.find((r) => r.meta.id === id)
      const before = record?.meta.parent ?? null
      if (before === parentId) return
      await movePlace(session, id, parentId)
      const where = parentId ? `inside “${titleOf(parentId)}”` : 'to the top'
      const words = `Moved “${record?.meta.title}” ${where}.`
      edits.toast = { text: words, undo: () => guardedUndo(id, before) }
      await edits.announce(words)
    })
  async function guardedUndo(id: string, parentId: string | null) {
    const session = ws.session
    if (!session) return
    await guarded(async () => {
      await movePlace(session, id, parentId)
      edits.toast = null
    })
  }
  const titleOf = (id: string) => ws.data?.records.find((r) => r.meta.id === id)?.meta.title ?? ''

  /** One level out (to the level of its parent) or in (under the place above it): the keyboard's way. */
  function step(id: string, by: 'out' | 'in') {
    const target = stepTarget(records.value, id, by)
    return target === undefined ? undefined : move(id, target)
  }

  /** A row's actions, or none when the workspace cannot be written to. */
  function menu(node: TreeNode): MenuItem[] {
    if (!edit.canEdit.value) return []
    const out = stepTarget(records.value, node.id, 'out') !== undefined
    const into = stepTarget(records.value, node.id, 'in') !== undefined
    return [
      { id: 'rename', label: 'Rename…', icon: 'write', shortcut: 'F2' },
      { id: 'new', label: 'New place inside', icon: 'plus' },
      {
        id: 'up',
        label: 'Move out one level',
        icon: 'chevron-up',
        shortcut: `${altLabel} ↑`,
        disabled: !out,
        separated: true,
      },
      {
        id: 'down',
        label: 'Move into the place above',
        icon: 'chevron-down',
        shortcut: `${altLabel} ↓`,
        disabled: !into,
      },
      { id: 'move', label: 'Move to…', icon: 'place' },
      {
        id: 'delete',
        label: 'Delete',
        icon: 'trash',
        shortcut: deleteLabel,
        danger: true,
        separated: true,
      },
    ]
  }

  /** The row that the "Move to…" dialog is about. */
  const moving = ref<string | null>(null)

  function onAction(id: string, action: string, keyboard = false) {
    if (action === 'rename') edit.rename(id)
    else if (action === 'delete') void edit.remove(id, keyboard)
    else if (action === 'up') void step(id, 'out')
    else if (action === 'down') void step(id, 'in')
    else if (action === 'move') moving.value = id
    else if (action === 'new') void newInside(id)
  }

  /** A new place made inside this one: it asks for a name, then sits in the tree under it. */
  function newInside(parent: string) {
    newRecord('place', 'universe', {
      after: async (id) => {
        await move(id, parent)
      },
    })
  }

  /** What a drop on a row does: the dragged place goes inside it, when that is allowed. */
  function dropTarget(dragId: string, node: { id: string }): MoveTarget | null {
    return canMovePlace(records.value, dragId, node.id).ok && dragId !== node.id
      ? { id: node.id, where: 'inside' }
      : null
  }

  /** Where `id` can go: the top, and every place that is not itself or inside it, with where it sits. */
  function destinations(id: string) {
    const label = (pid: string) =>
      [...placeAncestors(records.value, pid).map((a) => a.title), titleOf(pid)].join(' › ')
    return [
      { value: PLACE_TOP, label: 'The top (nothing above it)' },
      ...records.value
        .filter((r) => r.meta.id !== id && canMovePlace(records.value, id, r.meta.id).ok)
        .map((r) => ({ value: r.meta.id, label: label(r.meta.id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ]
  }

  return {
    nodes,
    expanded,
    moving,
    menu,
    onAction,
    dropTarget,
    destinations,
    move,
    canEdit: edit.canEdit,
    /** Opening a place from the tree. */
    open: (id: string) => nav.openTarget({ kind: 'record', id }),
    /** Where a place sits and what is directly inside it (the sheet's breadcrumb and list). */
    ancestors: (id: string) => placeAncestors(records.value, id),
    children: (id: string) => placeChildren(records.value, id),
  }
}
