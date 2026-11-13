<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { TreeItem, TreeRoot } from 'reka-ui'
import { isPinChord } from '@/composables/useKeyboardShortcuts'
import { useTreeDrag } from '@/composables/useTreeDrag'
import { useTreeNodes, type TreeNode } from '@/composables/useTree'
import type { MoveTarget } from '@/domain/outline-moves'
import Icon from './Icon.vue'
import Menu, { type MenuItem } from './Menu.vue'
import StatusDot from './StatusDot.vue'

const props = defineProps<{
  items: TreeNode[]
  label: string
  pinned?: string[]
  /** A row's actions. None (or an empty list) means the row has no menu and no action keys. */
  menu?: (node: TreeNode) => MenuItem[]
  /** Whether the dragged row may land on this row, and how: not given, nothing can be dropped. */
  dropTarget?: (dragId: string, node: TreeNode, at: number) => MoveTarget | null
}>()
const emit = defineEmits<{
  pin: [key: string]
  /** `keyboard`: made with a shortcut key, so focus has to be put somewhere sensible afterwards. */
  action: [id: string, action: string, keyboard?: boolean]
  drop: [id: string, target: MoveTarget]
}>()
const selectedId = defineModel<string>()
const expanded = defineModel<string[]>('expanded', { default: () => [] })
const { selected } = useTreeNodes(() => props.items, selectedId)
const drag = useTreeDrag(
  () => props.dropTarget,
  (id, target) => emit('drop', id, target),
)

/** Delete, and Backspace (a Mac's delete key is Backspace; ⌘⌫ too), never while typing in a field. */
const isDeleteKey = (e: KeyboardEvent) =>
  (e.key === 'Delete' && !e.altKey && !e.shiftKey) ||
  (e.key === 'Backspace' && !e.altKey && !e.ctrlKey && !e.shiftKey)

/**
 * Alt+P (⌥P) pins the focused row. With a menu: F2 renames, Delete or Backspace deletes, Alt+↑
 * and Alt+↓ move the row, and the context-menu key (or Shift+F10) opens its menu — the keyboard's
 * way to everything the pointer does.
 */
function onKeydown(e: KeyboardEvent, node: TreeNode) {
  if (node.pinKey && isPinChord(e)) {
    e.preventDefault()
    e.stopPropagation()
    emit('pin', node.pinKey)
    return
  }
  const items = props.menu?.(node) ?? []
  if (!items.length) return
  const act = (action: string) => {
    if (!items.some((i) => i.id === action && !i.disabled)) return
    e.preventDefault()
    e.stopPropagation()
    emit('action', node.id, action, true)
  }
  const typing = (e.target as HTMLElement | null)?.closest(
    'input, textarea, select, [contenteditable]',
  )
  if (typing) return
  if (e.key === 'F2') act('rename')
  else if (isDeleteKey(e)) act('delete')
  else if (e.altKey && e.key === 'ArrowUp') act('up')
  else if (e.altKey && e.key === 'ArrowDown') act('down')
  else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-row-menu]')?.click()
  }
}

const onSelect = (node: TreeNode | undefined) => {
  if (node) selectedId.value = node.id
}

/** A line where the drop would land: above or below the row, or a frame around it. */
const dropClass = (node: TreeNode) => {
  const where = drag.over.value?.id === node.id ? drag.over.value.where : undefined
  return where === 'before'
    ? 'shadow-[inset_0_2px_0_var(--gold)]'
    : where === 'after'
      ? 'shadow-[inset_0_-2px_0_var(--gold)]'
      : where === 'inside'
        ? 'outline outline-2 -outline-offset-2 outline-gold'
        : ''
}
</script>

<template>
  <TreeRoot
    v-slot="{ flattenItems }"
    :items="items"
    :get-key="(n: TreeNode) => n.id"
    :model-value="selected"
    :expanded="expanded"
    selection-behavior="replace"
    :aria-label="label"
    class="flex flex-col gap-px text-[13px]"
    @update:model-value="onSelect"
    @update:expanded="expanded = $event"
  >
    <TreeItem
      v-for="item in flattenItems"
      :key="item._id"
      v-slot="{ isExpanded }"
      v-bind="item.bind"
      :style="{ paddingLeft: `${8 + (item.level - 1) * 14}px` }"
      :draggable="!!item.value.draggable && !!menu"
      :class="[
        'group flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] pr-2 text-ink-2 hover:bg-raised data-[selected]:bg-gold-soft data-[selected]:font-semibold data-[selected]:text-gold-ink pointer-coarse:h-11',
        item.value.draggable && menu && 'active:cursor-grabbing',
        dropClass(item.value),
        // The row being carried is marked with a dashed frame, not faded (text is never dimmed).
        drag.dragging.value === item.value.id &&
          'bg-raised outline outline-1 -outline-offset-1 outline-dashed outline-line-2',
      ]"
      @keydown="onKeydown($event, item.value)"
      @dragstart="drag.start($event, item.value)"
      @dragover="drag.move($event, item.value)"
      @dragleave="drag.leave(item.value)"
      @drop="drag.drop($event, item.value)"
      @dragend="drag.end()"
    >
      <Icon
        v-if="item.hasChildren"
        name="chevron-right"
        :size="12"
        :class="[
          'text-ink-3 transition-transform motion-reduce:transition-none',
          isExpanded && 'rotate-90',
        ]"
      />
      <span v-else class="w-3 shrink-0" />
      <Icon v-if="item.value.icon" :name="item.value.icon" :size="15" />
      <span class="min-w-0 flex-1 truncate">{{ item.value.label }}</span>
      <button
        v-if="item.value.pinKey"
        type="button"
        tabindex="-1"
        :aria-label="`Pin ${item.value.label}`"
        :aria-pressed="pinned?.includes(item.value.pinKey) ?? false"
        :class="[
          'size-8 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-line hover:text-ink pointer-coarse:size-11',
          pinned?.includes(item.value.pinKey)
            ? 'flex text-gold-ink'
            : 'hidden group-hover:flex group-focus-visible:flex pointer-coarse:flex',
        ]"
        @click.stop="emit('pin', item.value.pinKey)"
      >
        <Icon name="pin" :size="12" />
      </button>
      <Menu
        v-if="menu && menu(item.value).length"
        :items="menu(item.value)"
        align="end"
        @select="emit('action', item.value.id, $event)"
      >
        <template #trigger>
          <button
            type="button"
            tabindex="-1"
            data-row-menu
            :aria-label="`Actions for ${item.value.label}`"
            class="hidden size-8 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-line hover:text-ink group-hover:flex group-focus-visible:flex group-data-[selected]:flex pointer-coarse:flex pointer-coarse:size-11"
            @click.stop
            @keydown.stop
          >
            <Icon name="more" :size="14" />
          </button>
        </template>
      </Menu>
      <StatusDot v-if="item.value.status" :status="item.value.status" />
      <span
        v-if="item.value.meta"
        class="min-w-7 text-right text-[11.5px] font-normal tabular-nums text-ink-3 group-data-[selected]:text-gold-ink"
      >
        {{ item.value.meta }}
      </span>
    </TreeItem>
  </TreeRoot>
</template>
