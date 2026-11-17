<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { WINDOW_AT } from '@/composables/useTimeline'
import { useVirtualRows } from '@/composables/useVirtualRows'
import { TOLD } from '@/domain/timeline'
import type { TimelineItem } from '@/domain/timeline'

/**
 * The items of one open group of the timeline. A group of up to `WINDOW_AT` items is drawn whole; a
 * longer one sits in a scrolling window of one-line rows and only the rows near it are drawn, so one
 * huge group costs what a short one does. Each row is a stop for the arrow keys (`data-tl`); the group's
 * header is the one Tab stop.
 */
const props = defineProps<{ items: TimelineItem[]; tabKey?: string }>()
defineEmits<{ open: [item: TimelineItem]; focused: [item: TimelineItem] }>()
const ROW = 36
const windowed = computed(() => props.items.length > WINDOW_AT)
const scroller = ref<HTMLElement | null>(null)
const setScroller = (el: unknown) => (scroller.value = el as HTMLElement | null)
const count = computed(() => props.items.length)
const { range, before, after } = useVirtualRows(count, ROW, scroller)
const shown = computed(() =>
  windowed.value ? props.items.slice(range.value.start, range.value.end) : props.items,
)
const row =
  'flex w-full items-baseline gap-x-2 rounded-control px-2 text-left text-[13px] hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink pointer-coarse:min-h-11'
</script>

<template>
  <div
    :ref="setScroller"
    :data-window="windowed || undefined"
    :class="windowed ? 'max-h-[360px] overflow-y-auto' : ''"
  >
    <ol class="m-0 ml-3 flex list-none flex-col gap-px border-l-2 border-line p-0 pl-2">
      <li v-if="windowed" aria-hidden="true" :style="{ height: `${before}px` }" />
      <li v-for="i in shown" :key="i.id" :style="windowed ? { height: `${ROW}px` } : undefined">
        <button
          type="button"
          data-tl
          :tabindex="!windowed && tabKey === `i:${i.id}` ? 0 : -1"
          :class="[row, windowed ? 'h-9 truncate' : 'min-h-9 flex-wrap py-1']"
          @focus="$emit('focused', i)"
          @click="$emit('open', i)"
        >
          <span class="min-w-[120px] text-xs tabular-nums text-ink-2">{{ i.words }}</span>
          {{ ' ' }}
          <span class="font-medium">{{ i.ref ? `${i.ref} · ` : '' }}{{ i.title }}</span>
          <template v-if="i.kind === 'event'">
            {{ ' ' }}<span class="text-xs text-ink-3">Event</span>
          </template>
          <template v-if="TOLD[i.order]">
            {{ ' ' }}<span class="text-xs font-medium text-gold-ink">{{ TOLD[i.order] }}</span>
          </template>
          <template v-if="i.book">
            {{ ' ' }}<span class="text-xs text-ink-3">{{ i.book }}</span>
          </template>
        </button>
      </li>
      <li v-if="windowed" aria-hidden="true" :style="{ height: `${after}px` }" />
    </ol>
  </div>
</template>
