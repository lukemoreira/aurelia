<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { useReturnFocus } from '@/composables/useReturnFocus'
import IconButton from './IconButton.vue'

export type DialogSize = 'sm' | 'md' | 'lg'

const SIZES: Record<DialogSize, string> = {
  sm: 'max-w-[480px]',
  md: 'max-w-[640px]',
  lg: 'max-w-[760px]',
}

withDefaults(defineProps<{ title: string; description?: string; size?: DialogSize }>(), {
  description: undefined,
  size: 'sm',
})
const open = defineModel<boolean>('open', { default: false })
const returnFocus = useReturnFocus(open)
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/40" />
      <DialogContent
        :aria-describedby="description ? undefined : ''"
        :class="[
          'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-dialog border border-line bg-surface text-ink shadow-card',
          SIZES[size],
        ]"
        @close-auto-focus="returnFocus"
      >
        <header class="flex items-start gap-3 px-5 pb-2 pt-4">
          <div class="flex-1">
            <DialogTitle class="text-base font-semibold">{{ title }}</DialogTitle>
            <DialogDescription v-if="description" class="mt-1 text-[13px] text-ink-2">
              {{ description }}
            </DialogDescription>
          </div>
          <DialogClose as-child
            ><IconButton icon="close" label="Close" size="sm" :tooltip="false"
          /></DialogClose>
        </header>
        <div class="overflow-auto px-5 py-2 text-[13px]"><slot /></div>
        <footer v-if="$slots.footer" class="flex justify-end gap-2 px-5 pb-4 pt-3">
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
