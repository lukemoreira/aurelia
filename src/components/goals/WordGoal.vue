<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import Popover from '@/components/ui/Popover.vue'
import type { WritingLogState } from '@/composables/useWritingLog'
import { useLayoutStore } from '@/stores/layout'
import WordGoalDetails from './WordGoalDetails.vue'

/** "320 / 500 words today" in the status bar; it opens today's progress, the days in a row and the goals. */
const props = defineProps<{ goals: WritingLogState }>()
const layout = useLayoutStore()
const fmt = (n: number) => n.toLocaleString('en-US')
// Another device may have written the log since: look again when it is opened.
watch(
  () => layout.goalsOpen,
  (open) => open && void props.goals.load(),
)
</script>

<template>
  <Popover v-if="goals.ready.value" v-model:open="layout.goalsOpen">
    <template #trigger>
      <button
        type="button"
        class="-mx-1.5 flex h-[22px] items-center gap-1.5 rounded-[5px] px-1.5 text-xs hover:bg-raised hover:text-ink pointer-coarse:h-11"
      >
        <Icon v-if="goals.met.value" name="check" :size="13" class="text-ok" />
        <span
          ><b class="font-medium text-ink-2">{{ fmt(goals.words.value) }}</b
          ><template v-if="goals.goal.value"> / {{ fmt(goals.goal.value) }}</template> words
          today</span
        >
      </button>
    </template>
    <WordGoalDetails :goals="goals" />
  </Popover>
</template>
