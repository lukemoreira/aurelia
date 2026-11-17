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

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    size?: DialogSize
    /** Work is under way: Escape, a click outside and the close button leave the dialog as it is. */
    locked?: boolean
  }>(),
  { description: undefined, size: 'sm', locked: false },
)
const open = defineModel<boolean>('open', { default: false })
/** Focus moved into the dialog: `preventDefault()` to choose the control yourself. */
defineEmits<{ openAutoFocus: [event: Event] }>()
const returnFocus = useReturnFocus(open)
/** Work is under way: what would close the dialog does not. */
const hold = (event: Event) => props.locked && event.preventDefault()
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
        @escape-key-down="hold"
        @pointer-down-outside="hold"
        @interact-outside="hold"
        @open-auto-focus="$emit('openAutoFocus', $event)"
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
            ><IconButton icon="close" label="Close" size="sm" :tooltip="false" :disabled="locked"
          /></DialogClose>
        </header>
        <div class="overflow-auto px-5 py-2 text-[13px]"><slot /></div>
        <!-- A div, not a footer: a footer in a dialog is a second page footer (landmark) to a screen reader. -->
        <div v-if="$slots.footer" class="flex flex-wrap justify-end gap-2 px-5 pb-4 pt-3">
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
