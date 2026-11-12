<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { useReturnFocus } from '@/composables/useReturnFocus'
import IconButton from './IconButton.vue'

defineProps<{ title: string; side: 'left' | 'right' }>()
const open = defineModel<boolean>('open', { default: false })
const returnFocus = useReturnFocus(open)
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/40" />
      <DialogContent
        aria-describedby=""
        aria-modal="true"
        :class="[
          'fixed inset-y-0 z-50 flex w-[min(88vw,340px)] flex-col bg-chrome pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-ink shadow-card',
          side === 'left'
            ? 'left-0 border-r border-line pl-[env(safe-area-inset-left)]'
            : 'right-0 border-l border-line pr-[env(safe-area-inset-right)]',
        ]"
        @close-auto-focus="returnFocus"
      >
        <header
          class="flex h-14 shrink-0 items-center justify-between border-b border-line pl-4 pr-1.5"
        >
          <DialogTitle class="text-sm font-semibold">{{ title }}</DialogTitle>
          <DialogClose as-child>
            <IconButton icon="close" label="Close" size="lg" :tooltip="false" />
          </DialogClose>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto"><slot /></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
