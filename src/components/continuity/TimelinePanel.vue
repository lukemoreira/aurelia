<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { toolButton } from '@/components/ui/buttonStyles'
import Icon from '@/components/ui/Icon.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Select from '@/components/ui/Select.vue'
import type { useTimeline } from '@/composables/useTimeline'
import { useVirtualRows } from '@/composables/useVirtualRows'
import { WINDOW_AT } from '@/composables/useTimeline'
import { TOLD, ZOOMS, type TimelineItem, type Zoom } from '@/domain/timeline'
import TimelineList from './TimelineList.vue'
import TimelineRows from './TimelineRows.vue'

/**
 * The timeline: scenes and events on story time, in one calendar at a time, grouped by era, year,
 * month or day. A flashback says so in words. Up and Down move between the rows (one Tab stop for the
 * whole list), Enter opens one; "Table view" lists the same rows in a plain table. Scenes with no time
 * and times in another calendar are listed apart, never guessed into place.
 */
const props = defineProps<{ t: ReturnType<typeof useTimeline> }>()
const t = props.t
const list = ref(false)
const root = ref<HTMLElement | null>(null)
const kindOf = (i: TimelineItem) => (i.kind === 'event' ? 'Event' : 'Scene')

// The rows, and the one that is in the Tab order: the one last focused, or the first.
const keys = computed(() =>
  (t.tl.value?.groups ?? []).flatMap((g, n) => [
    `g:${g.key}`,
    ...(t.isOpen(g.key, n === 0) && g.items.length <= WINDOW_AT
      ? g.items.map((i) => `i:${i.id}`)
      : []),
  ]),
)
const current = ref<string>()
const tabKey = computed(() =>
  keys.value.includes(current.value ?? '') ? current.value : keys.value[0],
)
const tab = (key: string) => tabKey.value === key
/** Up and Down walk the rows and group headers; Home and End go to the first and last. */
function walk(e: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const all = [...(root.value?.querySelectorAll<HTMLElement>('[data-tl]') ?? [])]
  if (!all.length) return // the table view has none: the keys are the page's
  const at = all.indexOf(document.activeElement as HTMLElement)
  const to =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? all.length - 1
        : Math.min(all.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))
  e.preventDefault()
  // The next row of a long group may not be drawn yet: the window is moved a row, and the next key reaches it.
  const win = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-window]')
  const down = e.key === 'ArrowDown'
  if (
    win &&
    (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
    !win.contains(all[to] ?? null) &&
    (down ? win.scrollTop + win.clientHeight < win.scrollHeight - 1 : win.scrollTop > 0)
  ) {
    win.scrollTop += down ? 36 : -36
    return
  }
  all[to]?.focus()
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
/** "2 scenes", "1 scene, 1 event": what a group holds. */
const holds = (items: TimelineItem[]) => {
  const events = items.filter((i) => i.kind === 'event').length
  return [
    items.length - events && plural(items.length - events, 'scene'),
    events && plural(events, 'event'),
  ]
    .filter(Boolean)
    .join(', ')
}
const summary = () => {
  const cal = t.tl.value?.calendars.find((c) => c.id === t.tl.value?.calendar)?.name
  return `${holds(t.tl.value?.groups.flatMap((g) => g.items) ?? [])} in ${cal}`
}

// The table view is long, so it draws the rows near its window only.
const flat = computed(() => t.tl.value?.groups.flatMap((g) => g.items) ?? [])
const ROW = 40
const HEAD = 32
const scroller = ref<HTMLElement | null>(null)
const setScroller = (el: unknown) => (scroller.value = el as HTMLElement | null)
const count = computed(() => flat.value.length)
const { range, before, after } = useVirtualRows(count, ROW, scroller, HEAD)
const visible = computed(() => flat.value.slice(range.value.start, range.value.end))

// The two lists set apart open and close; what is in them is drawn only while they are open.
const apart = ref({ elsewhere: false, untimed: false })
const toggled = (key: 'elsewhere' | 'untimed', e: Event) =>
  (apart.value[key] = (e.target as HTMLDetailsElement).open)
const summaryClass =
  'flex min-h-8 cursor-pointer list-none items-center gap-1.5 font-medium [&::-webkit-details-marker]:hidden pointer-coarse:min-h-11'
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-4 p-5 lg:overflow-y-auto">
    <div class="flex flex-wrap items-center gap-2.5">
      <div class="mr-auto min-w-[200px]">
        <h2 id="timeline-title" class="m-0 text-sm font-semibold">Timeline</h2>
        <p v-if="t.tl.value?.calendar" class="m-0 text-xs text-ink-3" role="status">
          {{ summary() }}
        </p>
      </div>
      <div v-if="(t.tl.value?.calendars.length ?? 0) > 1" class="w-56">
        <Select
          :model-value="t.tl.value?.calendar"
          :options="
            t.tl.value!.calendars.map((c) => ({ value: c.id, label: `${c.name} (${c.count})` }))
          "
          aria-label="Calendar shown"
          @update:model-value="(v) => (t.calendar.value = v)"
        />
      </div>
      <SegmentedControl
        :model-value="t.zoom.value"
        label="Zoom"
        :options="ZOOMS"
        @update:model-value="(v) => (t.zoom.value = v as Zoom)"
      />
      <button type="button" :class="toolButton" :aria-pressed="list" @click="list = !list">
        Table view
      </button>
    </div>

    <p v-if="!t.tl.value?.calendar" role="status" class="m-0 py-6 text-[13px] text-ink-2">
      Nothing here has a date yet. Give a scene a story time in its inspector, or an event a date on
      its sheet, and it shows on the timeline.
    </p>

    <div v-else ref="root" @keydown="walk">
      <div
        v-if="list"
        :ref="setScroller"
        class="max-h-[480px] overflow-auto rounded-card border border-line bg-surface"
      >
        <table class="w-full border-collapse text-xs" :aria-rowcount="count + 1">
          <caption class="sr-only">
            Scenes and events in story time order.
          </caption>
          <thead>
            <tr aria-rowindex="1" :style="{ height: `${HEAD}px` }">
              <th
                v-for="h in ['When', 'What', 'Kind', 'Told', 'Book']"
                :key="h"
                scope="col"
                class="sticky top-0 z-10 border-b border-line bg-chrome px-3 text-left text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3"
              >
                {{ h }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr aria-hidden="true" :style="{ height: `${before}px` }">
              <td colspan="5" />
            </tr>
            <tr
              v-for="(i, n) in visible"
              :key="i.id"
              :aria-rowindex="range.start + n + 2"
              :style="{ height: `${ROW}px` }"
            >
              <td class="border-b border-line px-3 text-ink-2">{{ i.words }}</td>
              <th scope="row" class="border-b border-line px-3 text-left font-normal">
                <button
                  type="button"
                  class="min-h-8 text-left font-medium underline-offset-2 hover:underline pointer-coarse:min-h-11"
                  @click="t.open(i)"
                >
                  {{ i.ref ? `${i.ref} · ` : '' }}{{ i.title }}
                </button>
              </th>
              <td class="border-b border-line px-3 text-ink-2">{{ kindOf(i) }}</td>
              <td class="border-b border-line px-3 text-ink-2">
                {{ TOLD[i.order] || 'In order' }}
              </td>
              <td class="border-b border-line px-3 text-ink-2">{{ i.book ?? '' }}</td>
            </tr>
            <tr aria-hidden="true" :style="{ height: `${after}px` }">
              <td colspan="5" />
            </tr>
          </tbody>
        </table>
      </div>

      <ol v-else aria-labelledby="timeline-title" class="m-0 flex list-none flex-col gap-3 p-0">
        <li v-for="(g, n) in t.tl.value.groups" :key="g.key" class="flex flex-col gap-1">
          <h3 class="m-0 text-[13px]">
            <button
              type="button"
              data-tl
              :tabindex="tab(`g:${g.key}`) ? 0 : -1"
              class="flex min-h-8 w-full items-center gap-2 rounded-control px-2 text-left font-semibold hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink pointer-coarse:min-h-11"
              :aria-expanded="t.isOpen(g.key, n === 0)"
              @focus="current = `g:${g.key}`"
              @click="t.toggle(g.key, n === 0)"
            >
              <Icon
                name="chevron-right"
                :size="12"
                :class="[
                  'text-ink-3 transition-transform motion-reduce:transition-none',
                  t.isOpen(g.key, n === 0) && 'rotate-90',
                ]"
              />
              {{ g.label }}
              <span class="font-normal text-ink-3"> · {{ holds(g.items) }} </span>
              <span v-if="g.coarse" class="font-normal text-ink-3">
                · some do not say {{ t.zoom.value === 'day' ? 'the day' : 'the month' }}
              </span>
            </button>
          </h3>
          <TimelineRows
            v-if="t.isOpen(g.key, n === 0)"
            :items="g.items"
            :tab-key="tabKey"
            @focused="(i) => (current = g.items.length > WINDOW_AT ? `g:${g.key}` : `i:${i.id}`)"
            @open="t.open($event)"
          />
        </li>
      </ol>
    </div>

    <details
      v-if="t.tl.value?.elsewhere.length"
      class="group text-[13px]"
      @toggle="toggled('elsewhere', $event)"
    >
      <summary :class="summaryClass">
        <Icon
          name="chevron-right"
          :size="12"
          class="text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        In another calendar ({{ t.tl.value.elsewhere.length }})
      </summary>
      <template v-if="apart.elsewhere">
        <p class="m-0 py-1 text-xs text-ink-3">
          Times in different calendars are never compared. Pick the calendar above to see them.
        </p>
        <TimelineList :items="t.tl.value.elsewhere" @open="t.open($event)" />
      </template>
    </details>
    <details
      v-if="t.tl.value?.untimed.length"
      class="group text-[13px]"
      @toggle="toggled('untimed', $event)"
    >
      <summary :class="summaryClass">
        <Icon
          name="chevron-right"
          :size="12"
          class="text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        No time listed ({{ t.tl.value.untimed.length }})
      </summary>
      <template v-if="apart.untimed">
        <p class="m-0 py-1 text-xs text-ink-3">
          Scenes with no story time. They are still in reading order; give them a time to place them
          here.
        </p>
        <TimelineList :items="t.tl.value.untimed" @open="t.open($event)" />
      </template>
    </details>
  </div>
</template>
