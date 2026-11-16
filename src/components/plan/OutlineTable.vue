<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import Menu from '@/components/ui/Menu.vue'
import { formatWords } from '@/domain/outline'
import { rowStatus, rowTitle, rowWords, type PlanRow } from '@/domain/plan'
import { NO_VALUE } from '@/composables/usePlan'
import { HEADER_HEIGHT, ROW_HEIGHT, useOutlineTable } from '@/composables/useOutlineTable'
import ArcPicker from './ArcPicker.vue'
import CellSelect from './CellSelect.vue'

/** The outline as a table: parts, chapters and scenes with their point of view, status, arcs and words. */
const t = useOutlineTable()
const scroller = t.scroller
const setScroller = (el: unknown) => (scroller.value = el as HTMLElement | null)
const grid =
  'grid grid-cols-[minmax(240px,1fr)_160px_130px_minmax(150px,230px)_64px_36px] items-center gap-x-2 px-3'
const head = 'text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3'
const node = (row: PlanRow) => ({ id: row.id, label: rowTitle(row) })
const dropMark = (id: string) => {
  const over = t.drag.over.value
  if (over?.id !== id) return ''
  if (over.where === 'before')
    return 'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-gold'
  if (over.where === 'after')
    return 'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gold'
  return 'outline outline-2 -outline-offset-2 outline-gold'
}
</script>

<template>
  <div :ref="setScroller" class="relative min-h-0 flex-1 overflow-auto">
    <div
      role="table"
      aria-label="Outline"
      :aria-rowcount="t.rows.value.length + 1"
      class="min-w-[860px]"
    >
      <div
        role="row"
        aria-rowindex="1"
        :style="{ height: `${HEADER_HEIGHT}px` }"
        :class="[grid, 'sticky top-0 z-10 border-b border-line bg-canvas']"
      >
        <span role="columnheader" :class="head">Title</span>
        <span role="columnheader" :class="head">Point of view</span>
        <span role="columnheader" :class="head">Status</span>
        <span role="columnheader" :class="head">Arcs</span>
        <span role="columnheader" :class="[head, 'text-right']">Words</span>
        <span role="columnheader" class="sr-only">Actions</span>
      </div>

      <div role="rowgroup">
        <div aria-hidden="true" :style="{ height: `${t.before.value}px` }" />
        <div
          v-for="(row, i) in t.visible.value"
          :key="`${row.kind}:${row.id}`"
          role="row"
          :aria-rowindex="t.range.value.start + i + 2"
          :draggable="t.edit.canEdit.value && row.id !== 'unfiled'"
          :style="{ height: `${ROW_HEIGHT}px` }"
          :class="[
            grid,
            'group relative border-b border-line',
            row.kind === 'part' && 'bg-chrome',
            t.plan.selected === row.id && '!bg-gold-soft',
            t.drag.dragging.value === row.id && 'opacity-60',
            dropMark(row.id),
          ]"
          @dragstart="t.drag.start($event, node(row))"
          @dragover="t.drag.move($event, node(row))"
          @dragleave="t.drag.leave(node(row))"
          @drop="t.drag.drop($event, node(row))"
          @dragend="t.drag.end()"
        >
          <span
            role="cell"
            :class="[
              'flex min-w-0 items-center',
              row.kind === 'scene' && 'pl-7',
              row.kind === 'chapter' && 'pl-3',
            ]"
          >
            <button
              type="button"
              :data-row="row.id"
              :aria-current="t.plan.selected === row.id ? 'true' : undefined"
              :class="[
                'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-1.5 text-left hover:bg-raised pointer-coarse:h-11',
                row.kind === 'part' &&
                  'text-[11px] font-semibold uppercase tracking-[.09em] text-ink-2',
                row.kind === 'chapter' && 'font-semibold text-ink',
                row.kind === 'scene' && 'font-prose text-[14px] text-ink',
              ]"
              @click="t.select(row.id)"
              @dblclick="t.onAction(row.id, 'open')"
              @keydown="t.onKey($event, row.id)"
            >
              <span
                v-if="row.kind === 'scene'"
                class="w-8 shrink-0 font-mono text-[11px] text-ink-3"
                >{{ row.scene.ref }}</span
              >
              <span
                v-else-if="row.kind === 'chapter' && !row.unfiled"
                class="font-mono text-[11px] font-medium text-ink-3"
                >{{ row.chapter.number }}</span
              >
              <span class="truncate">{{ rowTitle(row) }}</span>
              <span
                v-if="row.kind === 'scene' && row.scene.findings"
                class="ml-auto shrink-0 rounded-[5px] bg-warn-soft px-1.5 text-[11px] font-semibold text-warn"
                >{{ row.scene.findings }}
                {{ row.scene.findings === 1 ? 'finding' : 'findings' }}</span
              >
            </button>
          </span>

          <span role="cell" class="min-w-0">
            <CellSelect
              v-if="row.kind === 'scene'"
              :label="`Point of view of ${row.scene.title}`"
              :options="t.povOptions.value"
              :model-value="row.scene.pov?.id ?? NO_VALUE"
              :disabled="!t.edit.canEdit.value"
              @update:model-value="(v) => v && t.setPov(row.id, v)"
            />
          </span>

          <span role="cell" class="min-w-0">
            <CellSelect
              :label="`Status of ${rowTitle(row)}`"
              :options="t.statusOptions"
              :model-value="rowStatus(row) ?? NO_VALUE"
              :disabled="!t.edit.canEdit.value || row.id === 'unfiled'"
              @update:model-value="(v) => v && t.setStatus(row.id, v)"
            />
          </span>

          <span role="cell" class="min-w-0">
            <ArcPicker
              v-if="row.kind === 'scene'"
              :model-value="row.scene.arcIds"
              :options="t.arcOptions.value"
              :label="`Arcs of ${row.scene.title}`"
              :disabled="!t.edit.canEdit.value"
              @update:model-value="(v) => t.setArcs(row.id, v)"
            />
          </span>

          <span role="cell" class="text-right text-[12.5px] tabular-nums text-ink-2">{{
            formatWords(rowWords(row))
          }}</span>

          <span role="cell" class="flex justify-end">
            <Menu
              v-if="t.menu(row.id).length"
              align="end"
              :items="t.menu(row.id)"
              @select="t.onAction(row.id, $event)"
            >
              <template #trigger>
                <button
                  type="button"
                  :aria-label="`Actions for ${rowTitle(row)}`"
                  class="flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-ink focus-visible:text-ink pointer-coarse:size-11 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
                >
                  <Icon name="more" :size="16" />
                </button>
              </template>
            </Menu>
          </span>
        </div>
        <div aria-hidden="true" :style="{ height: `${t.after.value}px` }" />
      </div>
    </div>
  </div>
</template>
