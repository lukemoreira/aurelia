<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import FindingCard from '@/components/continuity/FindingCard.vue'
import type { useStoryMap } from '@/composables/useStoryMap'
import type { StoryFinding } from '@/domain/story-graph'

/** The checks of a branching story, as words: what is wrong, where, and what can be done about it. */
const props = defineProps<{ map: ReturnType<typeof useStoryMap> }>()
const m = props.map
const showSetAside = ref(false)

/** The button that mends a finding, in words. Only a dead end can be mended in one click. */
const FIX_WORDS: Record<StoryFinding['fix'], string> = {
  'pick-scene': 'Pick a scene',
  'mark-ending': 'Mark as ending',
  'add-way-in': 'Add a way in',
  'add-choice': 'Add a choice',
}
/** A button of the list: 32 px with a mouse, 44 on touch. */
const button =
  'h-8 rounded-[7px] px-2.5 text-xs font-medium pointer-coarse:h-11 pointer-coarse:px-3.5'
</script>

<template>
  <section aria-labelledby="problems-title" class="flex flex-col gap-3">
    <div class="flex items-baseline justify-between">
      <h2 id="problems-title" class="m-0 text-sm font-semibold">
        Problems <span class="font-medium text-ink-3">{{ m.split.value.active.length }}</span>
      </h2>
      <span class="text-xs text-ink-3">checked on every change</span>
    </div>

    <p v-if="!m.split.value.active.length" class="m-0 text-[12.5px] text-ink-2" role="status">
      Nothing to fix. Every scene can be reached, and every path can finish.
    </p>
    <ol v-else class="m-0 flex list-none flex-col gap-2 p-0">
      <FindingCard
        v-for="f in m.split.value.active"
        :key="f.fingerprint"
        :title="f.title"
        :body="f.body"
        :severity="f.severity"
      >
        <button
          v-if="m.canEdit.value"
          type="button"
          :class="[button, 'border border-line-2 text-ink hover:bg-raised']"
          @click="m.fix(f)"
        >
          {{ FIX_WORDS[f.fix] }}
        </button>
        <button
          type="button"
          :class="[button, 'text-gold-ink hover:bg-gold-soft']"
          @click="m.show(f)"
        >
          Show
        </button>
        <button
          v-if="m.canEdit.value && f.severity !== 'error'"
          type="button"
          :class="[button, 'text-ink-2 hover:bg-raised']"
          :aria-label="`Mark intended: ${f.title}, ${f.body}`"
          @click="m.dismiss(f, true)"
        >
          Mark intended
        </button>
      </FindingCard>
    </ol>

    <div v-if="m.split.value.dismissed.length" class="flex flex-col gap-2">
      <button
        type="button"
        class="flex h-8 items-center self-start rounded-[7px] px-1 text-xs font-medium text-ink-2 underline underline-offset-2 hover:text-ink pointer-coarse:h-11"
        :aria-expanded="showSetAside"
        @click="showSetAside = !showSetAside"
      >
        {{ m.split.value.dismissed.length }} marked as intended
      </button>
      <ul v-if="showSetAside" class="m-0 flex list-none flex-col gap-1.5 p-0">
        <li
          v-for="f in m.split.value.dismissed"
          :key="f.fingerprint"
          class="flex items-start justify-between gap-2 rounded-[10px] border border-dashed border-line-2 px-3 py-2 text-[12.5px] text-ink-2"
        >
          <span>{{ f.body }}</span>
          <button
            v-if="m.canEdit.value"
            type="button"
            :class="[button, 'shrink-0 text-ink hover:bg-raised']"
            @click="m.dismiss(f, false)"
          >
            Undo
          </button>
        </li>
      </ul>
    </div>

    <p v-if="m.summary.value" class="m-0 border-t border-line pt-3 text-[12.5px] text-ink-2">
      {{ m.summary.value.endingsReachable }}
      {{ m.summary.value.endingsReachable === 1 ? 'ending' : 'endings' }} reachable
      <template v-if="m.summary.value.endings !== m.summary.value.endingsReachable">
        of {{ m.summary.value.endings }}
      </template>
    </p>
  </section>
</template>
