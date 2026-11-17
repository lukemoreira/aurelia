<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { toolButton } from '@/components/ui/buttonStyles'
import type { useProgression } from '@/composables/useProgression'
import { useVirtualRows } from '@/composables/useVirtualRows'

/**
 * Where a character is on the page, chapter by chapter, as a real table: the words in every cell say
 * what the bar shows. A long book is read a stretch of chapters at a time (the same ← → as the Continuity
 * map), and only the rows near the window are drawn. "Table view" lists the same rows as plain lines.
 * On a phone the bar and the point-of-view column give way: the words say it.
 */
const props = defineProps<{ c: ReturnType<typeof useProgression>; name: string }>()
const c = props.c
const asList = defineModel<boolean>('list', { default: false })
const ROW = 48
const HEAD = 32
const scroller = ref<HTMLElement | null>(null)
const setScroller = (el: unknown) => (scroller.value = el as HTMLElement | null)
const count = computed(() => c.shown.value.length)
const { range, before, after } = useVirtualRows(count, ROW, scroller, HEAD)
const visible = computed(() => c.shown.value.slice(range.value.start, range.value.end))
const most = computed(() => Math.max(1, ...c.shown.value.map((r) => r.words)))
/** The scrubber rests in a scene of this chapter. */
const here = (r: { first: number; end: number }) => c.at.value >= r.first && c.at.value <= r.end
const heads = [
  { text: 'Chapter', class: '' },
  { text: 'On the page', class: '' },
  { text: 'Point of view', class: 'hidden sm:table-cell' },
  { text: 'Changes', class: '' },
]
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="c.paged.value" role="group" aria-label="Chapters" class="flex items-center gap-1.5">
      <button
        type="button"
        :class="toolButton"
        :disabled="!c.canPage(-1)"
        aria-label="Earlier chapters"
        @click="c.page(-1)"
      >
        ←
      </button>
      <span class="min-w-[150px] text-center text-xs text-ink-2" role="status">{{
        c.rangeWords.value
      }}</span>
      <button
        type="button"
        :class="toolButton"
        :disabled="!c.canPage(1)"
        aria-label="Later chapters"
        @click="c.page(1)"
      >
        →
      </button>
    </div>

    <ul
      v-if="asList"
      :aria-label="`${name} chapter by chapter`"
      class="m-0 flex list-none flex-col gap-1.5 p-0"
    >
      <li
        v-for="r in c.shown.value"
        :key="r.key"
        class="rounded-control border border-line bg-surface px-3 py-2 text-[12.5px]"
      >
        <span class="font-semibold">{{ r.label }}</span>
        <span v-if="r.title" class="text-ink-3"> · {{ r.title }}</span>
        <span class="block text-ink-2">{{ r.text }}</span>
      </li>
    </ul>

    <div
      v-else
      :ref="setScroller"
      class="relative max-h-[360px] overflow-y-auto overflow-x-hidden rounded-card border border-line bg-surface sm:overflow-x-auto"
    >
      <table class="w-full border-collapse text-xs" :aria-rowcount="count + 1">
        <caption class="sr-only">
          {{
            name
          }}
          on the page in each chapter: the scenes and words they are in, whether the chapter is told
          from their point of view, and the changes recorded.
        </caption>
        <thead>
          <tr aria-rowindex="1" :style="{ height: `${HEAD}px` }">
            <th
              v-for="h in heads"
              :key="h.text"
              scope="col"
              :class="[
                'sticky top-0 z-10 border-b border-line bg-chrome px-3 text-left text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3',
                h.class,
              ]"
            >
              {{ h.text }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr aria-hidden="true" :style="{ height: `${before}px` }">
            <td colspan="4" />
          </tr>
          <tr
            v-for="(r, i) in visible"
            :key="r.key"
            :aria-rowindex="range.start + i + 2"
            :aria-current="here(r) || undefined"
            :style="{ height: `${ROW}px` }"
            :class="here(r) ? 'bg-gold-soft' : ''"
          >
            <th
              scope="row"
              :class="[
                'border-b border-line px-3 text-left font-normal',
                here(r) ? 'shadow-[inset_3px_0_0_var(--gold-ink)]' : '',
              ]"
            >
              <button
                v-if="r.last"
                type="button"
                class="flex min-h-8 flex-col text-left leading-tight hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink pointer-coarse:min-h-11"
                @click="c.goTo(r.last)"
              >
                <span class="font-semibold text-ink"
                  >{{ r.label }}
                  <span
                    v-if="here(r)"
                    class="ml-1 rounded bg-surface px-1 text-[11px] text-gold-ink"
                    >Here</span
                  ></span
                >
                <span class="break-words text-[11px] text-ink-3">{{
                  r.part ? `${r.part} · ${r.title}` : r.title
                }}</span>
                <span class="sr-only">Show the state at the end of this chapter</span>
              </button>
            </th>
            <td class="border-b border-line px-3">
              <span class="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  class="hidden h-2 rounded-full bg-ember sm:block"
                  :class="r.pov ? '' : 'opacity-40'"
                  :style="{ width: `${Math.round((r.words / most) * 80)}px` }"
                />
                <span class="text-ink-2">
                  {{
                    r.scenes
                      ? `${r.scenes} ${r.scenes === 1 ? 'scene' : 'scenes'}, ${r.words.toLocaleString('en')} words`
                      : 'Not on the page'
                  }}<span class="sm:hidden">{{ r.pov ? ', point of view' : '' }}</span>
                </span>
              </span>
            </td>
            <td class="hidden border-b border-line px-3 text-ink-2 sm:table-cell">
              {{ r.pov ? 'Yes' : 'No' }}
            </td>
            <td class="border-b border-line px-3 text-ink-2">
              {{ r.changes ? r.changes : 'None' }}
            </td>
          </tr>
          <tr aria-hidden="true" :style="{ height: `${after}px` }">
            <td colspan="4" />
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
