<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { formatWords } from '@/domain/outline'
import { useCorkboard } from '@/composables/useCorkboard'
import CorkCard from './CorkCard.vue'

/** Scenes as index cards in chapter columns, coloured by arc or status; drag to reorder. */
const c = useCorkboard()
const root = c.root

// As many columns as fit, at least one: a narrow window shows fewer, never squeezes them.
let observer: ResizeObserver | undefined
onMounted(() => {
  if (typeof ResizeObserver !== 'function' || !root.value) return
  observer = new ResizeObserver(([entry]) => {
    c.perPage.value = Math.max(1, Math.min(6, Math.floor((entry?.contentRect.width ?? 800) / 224)))
  })
  observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())
const ghost = (id: string) => ({ id, label: '' })
const mark = (id: string) => {
  const over = c.drag.over.value
  return over?.id === id && over.where !== 'inside' ? over.where : undefined
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line px-5 py-2.5 text-xs text-ink-2"
    >
      <ul aria-label="Colours" class="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1 p-0">
        <li v-for="l in c.legend.value" :key="l.id" class="flex items-center gap-1.5">
          <button
            v-if="c.plan.colourBy === 'arc'"
            type="button"
            class="flex items-center gap-1.5 rounded px-1 hover:bg-raised"
            :aria-pressed="c.plan.selected === l.id"
            @click="c.select(l.id)"
          >
            <span
              aria-hidden="true"
              class="h-1 w-[18px] rounded-sm"
              :style="{ background: l.colour }"
            />{{ l.name }}
          </button>
          <template v-else>
            <span
              aria-hidden="true"
              class="h-1 w-[18px] rounded-sm"
              :style="{ background: l.colour }"
            />{{ l.name }}
          </template>
        </li>
      </ul>
      <span class="flex-1" />
      <span v-if="c.edit.canEdit.value" class="text-ink-3"
        >Drag cards to reorder, or Alt + arrow keys. The manuscript follows.</span
      >
      <span role="group" aria-label="Chapters shown" class="flex items-center gap-1 text-ink">
        <button
          type="button"
          aria-label="Previous chapters"
          :disabled="!c.canPrev.value"
          class="size-8 rounded-[7px] border border-line-2 bg-surface text-ink-2 hover:bg-raised disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-surface pointer-coarse:size-11"
          @click="c.page(-1)"
        >
          ‹
        </button>
        <span class="px-1.5 font-medium" role="status">{{ c.rangeLabel.value }}</span>
        <button
          type="button"
          aria-label="Next chapters"
          :disabled="!c.canNext.value"
          class="size-8 rounded-[7px] border border-line-2 bg-surface text-ink-2 hover:bg-raised disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-surface pointer-coarse:size-11"
          @click="c.page(1)"
        >
          ›
        </button>
      </span>
    </div>

    <div ref="root" class="min-h-0 flex-1 relative overflow-auto px-5 pb-5 pt-4">
      <p v-if="!c.shown.value.length" class="m-0 text-[13px] text-ink-2">No chapters yet.</p>
      <div
        class="grid gap-3.5"
        :style="{ gridTemplateColumns: `repeat(${c.shown.value.length}, minmax(190px, 280px))` }"
      >
        <section
          v-for="col in c.shown.value"
          :key="col.id || 'unfiled'"
          :aria-label="col.title"
          :class="[
            'flex min-w-0 flex-col gap-2.5 rounded-card',
            c.drag.over.value?.id === col.id &&
              c.drag.over.value.where === 'inside' &&
              'outline outline-2 outline-offset-4 outline-gold',
          ]"
          @dragover="col.id && c.drag.move($event, ghost(col.id))"
          @dragleave="col.id && c.drag.leave(ghost(col.id))"
          @drop="col.id && c.drag.drop($event, ghost(col.id))"
        >
          <header class="flex flex-col gap-1.5 px-0.5">
            <span class="flex justify-between gap-2">
              <h2 class="m-0 text-[12.5px] font-semibold text-ink">
                {{ col.id ? `${col.number} · ${col.title}` : col.title }}
              </h2>
              <span
                :class="[
                  'text-[11.5px] tabular-nums',
                  c.over(col.words, col.target) ? 'font-semibold text-warn' : 'text-ink-2',
                ]"
                >{{
                  col.target
                    ? `${formatWords(col.words)} of ${formatWords(col.target)}`
                    : formatWords(col.words)
                }}{{ c.over(col.words, col.target) ? ' · over' : '' }}</span
              >
            </span>
            <span
              v-if="c.progress(col.words, col.target) !== undefined"
              aria-hidden="true"
              class="h-[3px] overflow-hidden rounded-full bg-raised"
              ><span
                class="block h-full"
                :class="c.over(col.words, col.target) ? 'bg-warn' : 'bg-gold'"
                :style="{ width: `${c.progress(col.words, col.target)}%` }"
            /></span>
          </header>
          <ul class="m-0 flex list-none flex-col gap-2.5 p-0">
            <li
              v-for="s in col.scenes"
              :key="s.id"
              :draggable="c.edit.canEdit.value"
              @dragstart="c.drag.start($event, { id: s.id, label: s.title })"
              @dragover.stop="c.drag.move($event, { id: s.id, label: s.title })"
              @dragleave="c.drag.leave({ id: s.id, label: s.title })"
              @drop.stop="c.drag.drop($event, { id: s.id, label: s.title })"
              @dragend="c.drag.end()"
            >
              <CorkCard
                :scene="s"
                :bar="c.barColour(s)"
                :selected="c.plan.selected === s.id"
                :dragging="c.drag.dragging.value === s.id"
                :drop="mark(s.id)"
                @select="c.select(s.id)"
                @open="c.open(s.id)"
                @key="c.onKey($event, s.id)"
              />
            </li>
          </ul>
          <button
            v-if="col.id && c.edit.canEdit.value"
            type="button"
            :aria-label="`New scene in ${col.title}`"
            class="h-9 rounded-[10px] border border-dashed border-line-2 text-[12.5px] font-medium text-ink-3 hover:bg-raised hover:text-ink pointer-coarse:h-11"
            @click="c.addScene(col.id)"
          >
            + Scene
          </button>
        </section>
      </div>
    </div>
  </div>
</template>
