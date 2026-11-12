<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { TreeItem, TreeRoot } from 'reka-ui'
import { isPinChord } from '@/composables/useKeyboardShortcuts'
import { useTreeNodes, type TreeNode } from '@/composables/useTree'
import Icon from './Icon.vue'
import StatusDot from './StatusDot.vue'

const props = defineProps<{ items: TreeNode[]; label: string; pinned?: string[] }>()
const emit = defineEmits<{ pin: [key: string] }>()
const selectedId = defineModel<string>()
const expanded = defineModel<string[]>('expanded', { default: () => [] })
const { selected } = useTreeNodes(() => props.items, selectedId)

/** Alt+P (⌥P) pins or unpins the focused row, the keyboard's way to what the pin button does. */
function onKeydown(e: KeyboardEvent, node: TreeNode) {
  if (!node.pinKey || !isPinChord(e)) return
  e.preventDefault()
  e.stopPropagation()
  emit('pin', node.pinKey)
}

const onSelect = (node: TreeNode | undefined) => {
  if (node) selectedId.value = node.id
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
      class="group flex h-7 cursor-pointer items-center gap-1.5 rounded-[7px] pr-2 text-ink-2 hover:bg-raised data-[selected]:bg-gold-soft data-[selected]:font-semibold data-[selected]:text-gold-ink pointer-coarse:h-11"
      @keydown="onKeydown($event, item.value)"
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
          'size-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-line hover:text-ink pointer-coarse:size-11',
          pinned?.includes(item.value.pinKey)
            ? 'flex text-gold-ink'
            : 'hidden group-hover:flex group-focus-visible:flex pointer-coarse:flex',
        ]"
        @click.stop="emit('pin', item.value.pinKey)"
      >
        <Icon name="pin" :size="12" />
      </button>
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
