<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVirtualRows } from '@/composables/useVirtualRows'
import type { TimelineItem } from '@/domain/timeline'

/**
 * A plain list of timeline items that are set apart (a scene with no time, a time in another calendar):
 * one button each, and only the rows near the window are drawn, so a long list costs a short one.
 */
const props = defineProps<{ items: TimelineItem[] }>()
defineEmits<{ open: [item: TimelineItem] }>()
const ROW = 36
const scroller = ref<HTMLElement | null>(null)
const setScroller = (el: unknown) => (scroller.value = el as HTMLElement | null)
const count = computed(() => props.items.length)
const { range, before, after } = useVirtualRows(count, ROW, scroller)
const visible = computed(() => props.items.slice(range.value.start, range.value.end))
</script>

<template>
  <div :ref="setScroller" class="max-h-[240px] relative overflow-y-auto">
    <ul class="m-0 list-none p-0">
      <li aria-hidden="true" :style="{ height: `${before}px` }" />
      <li
        v-for="i in visible"
        :key="i.id"
        :style="{ height: `${ROW}px` }"
        class="flex items-center"
      >
        <button
          type="button"
          class="flex min-h-8 w-full items-baseline gap-2 truncate rounded-control px-2 text-left text-[13px] hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink pointer-coarse:min-h-11"
          @click="$emit('open', i)"
        >
          <span class="truncate font-medium">{{ i.ref ? `${i.ref} · ` : '' }}{{ i.title }}</span>
          {{ ' ' }}<span v-if="i.words" class="shrink-0 text-xs text-ink-3">{{ i.words }}</span>
          {{ ' ' }}<span v-if="i.book" class="shrink-0 text-xs text-ink-3">{{ i.book }}</span>
        </button>
      </li>
      <li aria-hidden="true" :style="{ height: `${after}px` }" />
    </ul>
  </div>
</template>
