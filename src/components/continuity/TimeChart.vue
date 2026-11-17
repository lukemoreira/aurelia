<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import type { TimeChart } from '@/domain/continuity-views'

/** Story time against reading order: a rising line is a story told in order; a hollow dot is a flashback, a red one a jump. */
const props = defineProps<{ chart: TimeChart; list?: boolean }>()
const [X0, X1, Y0, Y1] = [36, 392, 150, 24]
const xOf = (x: number) => X0 + (x / Math.max(1, props.chart.scenes - 1)) * (X1 - X0)
const yOf = (rank: number) => Y0 - (rank / Math.max(1, props.chart.moments - 1)) * (Y0 - Y1)
const inOrder = computed(() => props.chart.points.filter((p) => p.order === 'in order'))
const line = computed(() => inOrder.value.map((p) => `${xOf(p.x)},${yOf(p.rank)}`).join(' '))
/** The first few jumps are named beside their dots; the rest are in the table view. */
const jumpsShown = computed(
  () =>
    new Set(
      props.chart.points
        .filter((p) => p.jump)
        .slice(0, 3)
        .map((p) => p.scene),
    ),
)
const jumps = computed(() => props.chart.points.filter((p) => p.jump).length)
const away = computed(() => props.chart.points.filter((p) => p.order !== 'in order').length)
const summary = computed(
  () =>
    `Story time for each scene in reading order, ${props.chart.calendar ?? ''}. ${props.chart.points.length} scenes with a time, ${away.value} marked as a flashback or flash-forward, ${jumps.value} out of order and not marked.`,
)
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="!chart.points.length" role="status" class="m-0 text-[12.5px] text-ink-2">
      No scene has a story time yet. Give scenes a time in the inspector and the line shows here.
    </p>
    <template v-else-if="!list">
      <svg viewBox="0 0 400 178" width="100%" role="img" :aria-label="summary" class="block">
        <path
          :d="`M${X0} ${Y0}H${X1}M${X0} ${Y1}H${X1}`"
          style="stroke: var(--line); fill: none"
          stroke-width="1"
        />
        <text x="4" y="12" font-size="10" style="fill: var(--ink-3)">Later</text>
        <text x="4" y="172" font-size="10" style="fill: var(--ink-3)">Earlier</text>
        <text :x="X1" y="172" text-anchor="end" font-size="10" style="fill: var(--ink-3)">
          Reading order →
        </text>
        <text
          v-if="chart.calendar"
          :x="X1"
          y="12"
          text-anchor="end"
          font-size="10"
          style="fill: var(--ink-3)"
        >
          {{ chart.calendar }}
        </text>
        <text
          v-for="t in chart.ticks"
          :key="t.number"
          :x="xOf(t.x)"
          y="167"
          text-anchor="middle"
          font-size="9"
          style="fill: var(--ink-3)"
        >
          {{ t.number }}
        </text>
        <polyline
          :points="line"
          style="stroke: var(--ink-2); fill: none"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <g v-for="p in chart.points" :key="p.scene">
          <circle
            v-if="p.order !== 'in order'"
            :cx="xOf(p.x)"
            :cy="yOf(p.rank)"
            r="4"
            style="fill: var(--surface); stroke: var(--ink-3)"
            stroke-width="1.6"
          />
          <circle
            v-else-if="p.jump"
            :cx="xOf(p.x)"
            :cy="yOf(p.rank)"
            r="5.5"
            style="fill: var(--danger); stroke: var(--surface)"
            stroke-width="2"
          />
          <circle
            v-else
            :cx="xOf(p.x)"
            :cy="yOf(p.rank)"
            r="3"
            style="fill: var(--surface); stroke: var(--ink-2)"
            stroke-width="2"
          />
          <text
            v-if="p.jump && jumpsShown.has(p.scene)"
            :x="xOf(p.x) + (xOf(p.x) > 300 ? -8 : 8)"
            :y="yOf(p.rank) + 3"
            :text-anchor="xOf(p.x) > 300 ? 'end' : 'start'"
            font-size="10"
            font-weight="600"
            style="fill: var(--danger)"
          >
            {{ p.ref }} is earlier
          </text>
          <title>
            {{ p.ref }} · {{ p.title }}: {{ p.words
            }}{{ p.order !== 'in order' ? `, ${p.order}` : ''
            }}{{ p.jump ? ', before the scene it follows' : '' }}
          </title>
        </g>
      </svg>
      <p class="m-0 text-xs text-ink-2">
        {{ chart.points.length }} scenes with a time{{
          chart.calendar ? ` in ${chart.calendar}` : ''
        }}
        · {{ away }} marked as a flashback or flash-forward · {{ jumps }} out of order
        <template v-if="chart.elsewhere">
          · {{ chart.elsewhere }} in another calendar, not compared</template
        >
      </p>
    </template>
    <div v-else class="max-h-72 relative overflow-auto rounded-card border border-line bg-surface">
      <table class="w-full border-collapse text-xs">
        <caption class="sr-only">
          Story time of each scene, in reading order.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              class="border-b border-line bg-chrome px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3"
            >
              Scene
            </th>
            <th
              scope="col"
              class="border-b border-line bg-chrome px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3"
            >
              Story time
            </th>
            <th
              scope="col"
              class="border-b border-line bg-chrome px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3"
            >
              Order
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in chart.points" :key="p.scene">
            <th scope="row" class="border-b border-line px-3 py-1.5 text-left font-normal">
              {{ p.ref }} · {{ p.title }}
            </th>
            <td class="border-b border-line px-3 py-1.5">{{ p.words }}</td>
            <td class="border-b border-line px-3 py-1.5">
              {{ p.jump ? 'Before the scene it follows' : p.order }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
