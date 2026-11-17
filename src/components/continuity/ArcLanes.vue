<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import type { useContinuity } from '@/composables/useContinuity'
import { laneWords } from '@/domain/continuity-views'
import { laneGlyph, laneStyle, tone } from './cells'

/** Each arc's beats across the chapters in view, as a table: a dot for a beat, a line while it moves on, a dashed line while it is silent. */
const props = defineProps<{ c: ReturnType<typeof useContinuity>; list?: boolean }>()
const c = props.c
</script>

<template>
  <div v-if="c.lanes.value.length" class="flex flex-col gap-2">
    <h3 class="m-0 text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3">Arcs</h3>
    <ul v-if="list" aria-label="How arcs move" class="m-0 flex list-none flex-col gap-1.5 p-0">
      <li
        v-for="lane in c.lanes.value"
        :key="lane.id"
        class="rounded-control border border-line bg-surface px-3 py-2 text-[12.5px]"
      >
        <span class="font-semibold">{{ lane.name }}</span>
        <span class="block text-ink-2">{{ laneWords(lane, c.chapters.value) }}</span>
      </li>
    </ul>
    <div v-else class="overflow-auto rounded-card border border-line bg-surface">
      <table class="w-full min-w-max border-collapse text-xs">
        <caption class="sr-only">
          How each arc moves, chapter by chapter.
          {{
            c.rangeWords.value
          }}.
        </caption>
        <thead>
          <tr style="height: 28px">
            <th
              scope="col"
              class="sticky left-0 z-10 w-[132px] min-w-[132px] sm:w-[220px] sm:min-w-[220px] border-b border-line bg-chrome px-3 text-left text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3"
            >
              Arcs
            </th>
            <th
              v-for="col in c.columns.value"
              :key="col.id || 'unfiled'"
              scope="col"
              class="min-w-[30px] border-b border-line bg-chrome px-0 text-center text-[11px] font-medium tabular-nums text-ink-3"
            >
              <span class="sr-only">Chapter </span>{{ col.number || 'Unfiled' }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="lane in c.lanes.value" :key="lane.id" style="height: 32px">
            <th
              scope="row"
              class="sticky left-0 z-10 w-[132px] max-w-[132px] overflow-hidden border-b border-line bg-surface px-3 text-left font-normal sm:w-[220px] sm:max-w-[220px]"
            >
              <span class="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  class="size-2.5 shrink-0 rounded-sm"
                  :style="{ background: tone(lane.tone) }"
                />
                <span class="truncate text-[12.5px] font-semibold text-ink">{{ lane.name }}</span>
                <span v-if="lane.silent" class="shrink-0 text-[11px] font-medium text-warn"
                  >silent</span
                >
              </span>
            </th>
            <td
              v-for="(cell, j) in lane.cells.slice(c.range.value.start, c.range.value.end)"
              :key="j"
              :title="`Chapter ${c.columns.value[j]?.number}: ${cell.text}`"
              class="border-b border-line px-0 text-center"
            >
              <span
                aria-hidden="true"
                class="flex h-6 items-center justify-center text-[11px]"
                :style="laneStyle(cell, tone(lane.tone))"
                >{{ laneGlyph(cell) }}</span
              >
              <span class="sr-only">{{ cell.text }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
