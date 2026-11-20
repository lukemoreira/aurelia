<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { computed } from 'vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useReadAloud } from '@/composables/useReadAloud'
import { useLayoutStore } from '@/stores/layout'

const props = defineProps<{ editor: Editor }>()
const { status, pause, resume, stop } = useReadAloud()
const layout = useLayoutStore()
const paused = computed(() => status.value === 'paused')

/** Stopped from the keyboard: the control goes away, so the keyboard goes back to the text. */
function stopAndReturn() {
  stop()
  props.editor.commands.focus(null, { scrollIntoView: false })
}
</script>

<template>
  <!-- Fixed over the page: above the status bar on a wide screen, under the top bar on a phone (the keyboard and the formatting bar are at the bottom there). -->
  <div
    role="group"
    aria-label="Reading aloud"
    class="fixed left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-card border border-line bg-surface p-1 pl-3 font-ui text-[13px] text-ink shadow-card"
    :style="layout.wide ? { bottom: '3rem' } : { top: 'calc(env(safe-area-inset-top) + 4.25rem)' }"
    @mousedown.prevent
  >
    <span role="status" class="pr-1 font-medium">{{ paused ? 'Paused' : 'Reading aloud' }}</span>
    <IconButton
      :icon="paused ? 'play' : 'pause'"
      :label="paused ? 'Resume' : 'Pause'"
      @click="paused ? resume() : pause()"
    />
    <IconButton icon="stop" label="Stop (Esc)" @click="stopAndReturn" />
  </div>
</template>
