<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'
import Icon from './Icon.vue'
import type { IconName } from '@/domain/ui-names'
import Kbd from './Kbd.vue'

export interface MenuItem {
  id: string
  label: string
  icon?: IconName
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  /** Draw a divider above this item. */
  separated?: boolean
}

defineProps<{ items: MenuItem[]; align?: 'start' | 'center' | 'end' }>()
const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <!-- Not modal: a modal menu hides the page with aria-hidden while focus is still in it. -->
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child><slot name="trigger" /></DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :align="align ?? 'start'"
        :side-offset="6"
        class="z-50 min-w-48 rounded-card border border-line bg-surface p-1 shadow-card"
      >
        <template v-for="item in items" :key="item.id">
          <DropdownMenuSeparator v-if="item.separated" class="my-1 h-px bg-line" />
          <DropdownMenuItem
            :disabled="item.disabled"
            :class="[
              'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px] outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-3 data-[highlighted]:bg-raised pointer-coarse:h-11',
              item.danger ? 'text-danger' : 'text-ink',
            ]"
            @select="emit('select', item.id)"
          >
            <Icon v-if="item.icon" :name="item.icon" :size="15" />
            <span class="flex-1">{{ item.label }}</span>
            <Kbd v-if="item.shortcut">{{ item.shortcut }}</Kbd>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
