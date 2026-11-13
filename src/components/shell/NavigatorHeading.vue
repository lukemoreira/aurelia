<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import Menu, { type MenuItem } from '@/components/ui/Menu.vue'

/** A section heading of the navigator, with a "+" menu when there is something to add. */
defineProps<{ label: string; addLabel: string; items: MenuItem[] }>()
defineEmits<{ select: [id: string] }>()
</script>

<template>
  <div class="flex items-center justify-between pr-1">
    <h2
      class="px-2.5 pb-1 pt-3.5 text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-3"
    >
      {{ label }}
    </h2>
    <Menu v-if="items.length" :items="items" align="end" @select="$emit('select', $event)">
      <template #trigger>
        <button
          type="button"
          :aria-label="addLabel"
          class="mt-2 flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink pointer-coarse:size-11"
        >
          <Icon name="plus" :size="14" />
        </button>
      </template>
    </Menu>
  </div>
</template>
