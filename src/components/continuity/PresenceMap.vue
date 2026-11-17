<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import Avatar from '@/components/ui/Avatar.vue'
import type { useContinuity } from '@/composables/useContinuity'
import { useVirtualRows } from '@/composables/useVirtualRows'
import { presenceRuns, type PresenceCell } from '@/domain/continuity-views'
import { cellClass, cellStyle, glyph, tone } from './cells'

/**
 * Who is on the page, chapter by chapter, as a real table: a row for each person, a column for
 * each chapter in view, words in every cell (the colours only help). Only the rows near the
 * window are drawn, and "Table view" lists the same data as plain lines.
 */
const props = defineProps<{ c: ReturnType<typeof useContinuity> }>()
const c = props.c
const ROW = 36
const HEAD = 32
const scroller = ref<HTMLElement | null>(null)
const setScroller = (el: unknown) => (scroller.value = el as HTMLElement | null)
const count = computed(() => c.shown.value.length)
const { range, before, after } = useVirtualRows(count, ROW, scroller, HEAD)
const visible = computed(() => c.shown.value.slice(range.value.start, range.value.end))
/** The same data as plain lines (the "Table view" button of the section). */
/** The parts of the chapters in view, each over as many columns as it has. */
const parts = computed(() => {
  const out: { key: number; title: string; span: number }[] = []
  c.columns.value.forEach((col, i) => {
    const last = out.at(-1)
    if (last && last.title === (col.part ?? '')) last.span++
    else out.push({ key: i, title: col.part ?? '', span: 1 })
  })
  return out.some((p) => p.title) ? out : []
})
const asList = defineModel<boolean>('list', { default: false })
const runs = (row: (typeof c.shown.value)[number]) => presenceRuns(row, c.chapters.value)
const words = (r: { from: number; to: number; text: string }) =>
  `${r.from === r.to ? 'chapter' : 'chapters'} ${r.from === r.to ? r.from : `${r.from}–${r.to}`}: ${r.text.toLowerCase()}`
const legend = [
  { text: 'POV', cell: { state: 'pov', finding: false, text: '' } },
  { text: 'On the page', cell: { state: 'on', finding: false, text: '' } },
  { text: 'Mentioned', cell: { state: 'mentioned', finding: false, text: '' } },
  { text: 'Dies', cell: { state: 'on', exit: 'dies', finding: false, text: '' } },
  { text: 'Finding', cell: { state: 'on', finding: true, text: '' } },
] satisfies { text: string; cell: PresenceCell }[]
</script>

<template>
  <div class="flex flex-col gap-2">
    <ul
      class="m-0 flex list-none flex-wrap items-center gap-x-3.5 gap-y-1 p-0 text-xs text-ink-2"
      aria-label="How to read the map"
    >
      <li v-for="l in legend" :key="l.text" class="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          :class="[cellClass, 'size-4']"
          :style="cellStyle(l.cell, 'var(--ink-2)')"
          >{{ glyph(l.cell) }}</span>{{ l.text }}
      </li>
      <li class="text-ink-3">in each character’s colour</li>
    </ul>

    <p v-if="!c.shown.value.length" role="status" class="m-0 py-6 text-[13px] text-ink-2">
      Nobody is on the page yet. Name a character in a scene, or add one to it, and they show here.
    </p>

    <ul
      v-else-if="asList"
      aria-label="Who is on the page"
      class="m-0 flex list-none flex-col gap-1.5 p-0"
    >
      <li
        v-for="row in c.shown.value"
        :key="row.id"
        class="rounded-control border border-line bg-surface px-3 py-2 text-[12.5px]"
      >
        <span class="font-semibold">{{ row.name }}</span>
        <span v-if="row.role" class="text-ink-3"> · {{ row.role }}</span>
        <span class="block text-ink-2">
          {{ runs(row).map(words).join(' · ') || 'Not on the page in any chapter.' }}
        </span>
      </li>
    </ul>

    <div
      v-else
      :ref="setScroller"
      class="relative max-h-[420px] overflow-auto rounded-card border border-line bg-surface"
    >
      <table class="w-full min-w-max border-collapse text-xs" :aria-rowcount="count + 1">
        <caption class="sr-only">
          Who is on the page in each chapter.
          {{
            c.rangeWords.value
          }}.
        </caption>
        <thead>
          <!-- Parts over their chapters, when the book has parts -->
          <tr v-if="parts.length" aria-hidden="true">
            <th class="sticky left-0 z-20 bg-chrome" />
            <th
              v-for="p in parts"
              :key="p.key"
              :colspan="p.span"
              class="border-b border-l border-line bg-chrome px-1.5 text-left text-[11px] font-medium text-ink-3"
            >
              <span class="block truncate">{{ p.title }}</span>
            </th>
          </tr>
          <tr aria-rowindex="1" :style="{ height: `${HEAD}px` }">
            <th
              scope="col"
              class="sticky left-0 top-0 z-20 w-[132px] min-w-[132px] sm:w-[220px] sm:min-w-[220px] border-b border-line bg-chrome px-3 text-left text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3"
            >
              Characters
            </th>
            <th
              v-for="col in c.columns.value"
              :key="col.id || 'unfiled'"
              scope="col"
              :title="col.title"
              class="sticky top-0 z-10 min-w-[30px] border-b border-line bg-chrome px-0 text-center text-[11px] font-medium tabular-nums text-ink-3"
            >
              <span class="sr-only">Chapter </span>{{ col.number || 'Unfiled' }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr aria-hidden="true" :style="{ height: `${before}px` }">
            <td :colspan="c.columns.value.length + 1" />
          </tr>
          <tr
            v-for="(row, i) in visible"
            :key="row.id"
            :aria-rowindex="range.start + i + 2"
            :style="{ height: `${ROW}px` }"
          >
            <th
              scope="row"
              class="sticky left-0 z-10 w-[132px] max-w-[132px] overflow-hidden border-b border-line bg-surface px-3 text-left font-normal sm:w-[220px] sm:max-w-[220px]"
            >
              <span class="flex items-center gap-2">
                <Avatar :name="row.name" :color="tone(row.tone)" :size="24" />
                <span class="flex min-w-0 flex-col leading-tight">
                  <span class="truncate text-[12.5px] font-semibold text-ink">{{ row.name }}</span>
                  <span v-if="row.role" class="truncate text-[11px] text-ink-3">{{
                    row.role
                  }}</span>
                </span>
              </span>
            </th>
            <td
              v-for="(cell, j) in row.cells.slice(c.range.value.start, c.range.value.end)"
              :key="j"
              :title="`Chapter ${c.columns.value[j]?.number}: ${cell.text}`"
              class="border-b border-line px-0 text-center"
            >
              <!-- A finding or a death is a button: it says what it is under the map (no hover on a phone or from the keyboard), and a finding takes the keyboard to its card in the list. -->
              <button
                v-if="cell.finding || cell.exit"
                type="button"
                class="mx-auto block rounded-[5px] p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink pointer-coarse:size-11"
                @click="c.describeCell(row, c.range.value.start + j, cell.text)"
              >
                <span
                  aria-hidden="true"
                  :class="[cellClass, 'size-6']"
                  :style="cellStyle(cell, tone(row.tone))"
                  >{{ glyph(cell) }}</span
                >
                <span class="sr-only">{{ cell.text }}</span>
              </button>
              <template v-else>
                <span
                  aria-hidden="true"
                  :class="[cellClass, 'size-6']"
                  :style="cellStyle(cell, tone(row.tone))"
                  >{{ glyph(cell) }}</span
                >
                <span class="sr-only">{{ cell.text }}</span>
              </template>
            </td>
          </tr>
          <tr aria-hidden="true" :style="{ height: `${after}px` }">
            <td :colspan="c.columns.value.length + 1" />
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="c.detail.value" role="status" class="m-0 text-xs text-ink-2">{{ c.detail.value }}</p>
  </div>
</template>
