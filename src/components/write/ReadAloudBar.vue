<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { computed, ref, watch } from 'vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useReadAloud } from '@/composables/useReadAloud'
import { useEditsStore } from '@/stores/edits'
import { useLayoutStore } from '@/stores/layout'

const props = defineProps<{ editor: Editor }>()
const { status, current, pause, resume, stop } = useReadAloud()
const layout = useLayoutStore()
const edits = useEditsStore()
const group = ref<HTMLElement | null>(null)
const active = computed(() => current.value === props.editor)
const paused = computed(() => status.value === 'paused')
/** What a screen reader hears: said from a live region that stays on the page when the control goes. */
const said = computed(() => (!active.value ? '' : paused.value ? 'Paused' : 'Reading aloud'))

/** Stopped from the control: it goes away, so the keyboard goes back to the text. */
function stopAndReturn() {
  stop()
  props.editor.commands.focus(null, { scrollIntoView: false })
}

// The control goes away when reading ends (Stop, or the last paragraph): keyboard focus on it goes back to the text.
watch(
  active,
  (now) => {
    if (!now && group.value?.contains(document.activeElement) && !props.editor.isDestroyed)
      props.editor.commands.focus(null, { scrollIntoView: false })
  },
  { flush: 'pre' },
)
</script>

<template>
  <span role="status" class="sr-only">{{ said }}</span>
  <!-- Fixed over the page: above the status bar on a wide screen, under the top bar on a phone (the keyboard and the formatting bar are at the bottom there). -->
  <div
    v-if="active"
    ref="group"
    role="group"
    aria-label="Reading aloud"
    class="fixed left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-card border border-line bg-surface p-1 pl-3 font-ui text-[13px] text-ink shadow-card"
    :style="
      layout.wide
        ? { bottom: edits.toast ? '6.5rem' : '3rem' }
        : { top: 'calc(env(safe-area-inset-top) + 4.25rem)' }
    "
    @mousedown.prevent
  >
    <span class="pr-1 font-medium">{{ paused ? 'Paused' : 'Reading aloud' }}</span>
    <IconButton
      :icon="paused ? 'play' : 'pause'"
      :label="paused ? 'Resume' : 'Pause'"
      @click="paused ? resume() : pause()"
    />
    <IconButton icon="stop" label="Stop (Esc)" @click="stopAndReturn" />
  </div>
</template>
