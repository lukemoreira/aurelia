<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import { useActionToast } from '@/composables/useActionToast'
import { useEditsStore } from '@/stores/edits'

const edits = useEditsStore()
const { undoButton, undo, dismiss } = useActionToast()
</script>

<template>
  <!-- What a move did, for a screen reader only: nothing else says where the row went. -->
  <p role="status" class="sr-only">{{ edits.announcement }}</p>
  <!-- Stays until it is dismissed or replaced: the author is never rushed to undo a delete. Sits in
       the main column, so the status bar below it stays readable. -->
  <div
    v-if="edits.toast"
    :role="edits.toast.error ? 'alert' : 'status'"
    :class="[
      'absolute bottom-4 left-4 z-[55] flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-3 rounded-card border bg-surface py-2.5 pl-4 pr-2.5 text-[13px] text-ink shadow-card',
      edits.toast.error ? 'border-danger-line' : 'border-line',
    ]"
  >
    <span class="font-medium">{{ edits.toast.text }}</span>
    <span class="flex gap-2">
      <button
        v-if="edits.toast.undo"
        :ref="(el) => (undoButton = el as HTMLElement | null)"
        type="button"
        class="inline-flex h-7 items-center rounded-control bg-gold px-2.5 text-[13px] font-semibold text-on-gold hover:brightness-95 pointer-coarse:h-11"
        @click="undo"
      >
        Undo
      </button>
      <Button variant="quiet" size="sm" @click="dismiss">Dismiss</Button>
    </span>
  </div>
</template>
