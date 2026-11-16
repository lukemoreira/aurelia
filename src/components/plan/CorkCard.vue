<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Avatar from '@/components/ui/Avatar.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { formatWords } from '@/domain/outline'
import type { PlanScene } from '@/domain/plan'

/** One scene as an index card: its colour bar, number, arc, title, summary, point of view, status and words. */
defineProps<{
  scene: PlanScene
  /** The colour of the bar across the top (the arc's, or the status's). */
  bar: string
  selected: boolean
  dragging: boolean
  /** Where a dragged card would land on this one. */
  drop?: 'before' | 'after'
}>()
defineEmits<{ select: []; open: []; key: [e: KeyboardEvent] }>()
</script>

<template>
  <article
    :class="[
      'group relative flex min-h-32 flex-col gap-1.5 overflow-hidden rounded-[10px] border bg-surface px-3 pb-2.5 shadow-sm',
      selected ? 'border-gold outline outline-2 -outline-offset-1 outline-gold' : 'border-line',
      dragging && 'z-10 rotate-1 shadow-card',
      drop === 'before' &&
        'before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-0.5 before:bg-gold',
      drop === 'after' &&
        'after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-0.5 after:bg-gold',
    ]"
  >
    <span aria-hidden="true" class="-mx-3 mb-1 h-1" :style="{ background: bar }" />
    <span class="flex items-center justify-between gap-1.5">
      <span class="font-mono text-[11px] font-medium text-ink-3">{{ scene.ref }}</span>
      <span
        v-if="scene.arcs.length"
        class="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-ink-2"
      >
        <span
          aria-hidden="true"
          class="size-2 shrink-0 rounded-sm"
          :style="{ background: scene.arcs[0]!.colour ?? 'var(--ink-3)' }"
        />
        <span class="truncate"
          >{{ scene.arcs[0]!.name
          }}{{ scene.arcs.length > 1 ? ` +${scene.arcs.length - 1}` : '' }}</span
        >
      </span>
    </span>
    <h3 class="m-0 font-prose text-[15px] font-medium leading-[1.25] text-ink">
      <button
        type="button"
        :data-card="scene.id"
        :aria-current="selected ? 'true' : undefined"
        class="text-left after:absolute after:inset-0 after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ink focus-visible:after:rounded-[10px]"
        @click="$emit('select')"
        @dblclick="$emit('open')"
        @keydown="$emit('key', $event)"
      >
        {{ scene.title }}
      </button>
    </h3>
    <p class="m-0 line-clamp-3 flex-1 text-[12.5px] text-ink-2">{{ scene.summary }}</p>
    <span class="flex items-center gap-1.5 text-[11.5px] text-ink-3">
      <Avatar v-if="scene.pov" :name="scene.pov.name" :color="scene.pov.colour" :size="20" />
      <span v-if="scene.status" class="rounded-full border border-line-2 px-[7px] py-px text-ink-2"
        ><StatusDot :status="scene.status" show-label
      /></span>
      <span class="flex-1" />
      <span v-if="scene.findings" class="rounded-[5px] bg-warn-soft px-1.5 font-semibold text-warn"
        >{{ scene.findings }} {{ scene.findings === 1 ? 'finding' : 'findings' }}</span
      >
      <span class="tabular-nums">{{ formatWords(scene.words) }}</span>
    </span>
  </article>
</template>
