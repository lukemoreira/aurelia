<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import ArcLanes from '@/components/continuity/ArcLanes.vue'
import FindingsList from '@/components/continuity/FindingsList.vue'
import PovBalance from '@/components/continuity/PovBalance.vue'
import PresenceMap from '@/components/continuity/PresenceMap.vue'
import TimeChart from '@/components/continuity/TimeChart.vue'
import Select from '@/components/ui/Select.vue'
import { useContinuity } from '@/composables/useContinuity'
import { useWorkspaceStore } from '@/stores/workspace'

/** Continuity: who is on the page and how arcs move, story time against reading order, whose eyes, and what the checks found. */
const ws = useWorkspaceStore()
const c = useContinuity()
const mapList = ref(false)
const timeList = ref(false)
const whoOptions = [
  { value: 'everyone', label: 'Everyone on the page' },
  { value: 'main', label: 'Main and POV' },
]
const button =
  'h-8 rounded-control border border-line-2 bg-surface px-3 text-[13px] font-medium text-ink hover:bg-raised disabled:text-ink-3 pointer-coarse:h-11'
const section = 'flex flex-col gap-3 rounded-card border border-line bg-surface p-4'
const heading = 'm-0 text-sm font-semibold'
</script>

<template>
  <div class="flex min-h-full flex-col lg:h-full lg:min-h-0">
    <div class="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-line px-5 py-3.5">
      <div class="min-w-[240px] flex-1">
        <h1 class="m-0 font-prose text-[26px] font-medium leading-[1.2]">Continuity</h1>
        <p class="m-0 mt-0.5 text-[12.5px] text-ink-3">
          {{ ws.book?.title }} · {{ c.chapters.value.length }} chapters ·
          {{ c.model.value?.scenes.length ?? 0 }} scenes · checked on this device
        </p>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div class="flex min-w-0 flex-1 flex-col gap-4 p-5 lg:overflow-y-auto">
        <ul
          class="m-0 grid list-none grid-cols-2 gap-2.5 p-0 md:grid-cols-4"
          aria-label="At a glance"
        >
          <li
            v-for="s in c.stats.value"
            :key="s.label"
            class="rounded-card border border-line bg-surface px-3.5 py-3"
          >
            <span class="block font-prose text-[22px] font-medium leading-tight">{{
              s.value
            }}</span>
            <span class="text-xs text-ink-2">{{ s.label }}</span>
          </li>
        </ul>

        <section aria-labelledby="map-title" :class="section">
          <div class="flex flex-wrap items-center gap-2.5">
            <h2 id="map-title" :class="[heading, 'mr-auto']">
              Who is on the page, and how arcs move
            </h2>
            <div role="group" aria-label="Chapters" class="flex items-center gap-1.5">
              <button
                type="button"
                :class="button"
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
                :class="button"
                :disabled="!c.canPage(1)"
                aria-label="Later chapters"
                @click="c.page(1)"
              >
                →
              </button>
            </div>
            <div class="w-60">
              <Select v-model="c.who.value" :options="whoOptions" aria-label="Characters shown" />
            </div>
            <button
              type="button"
              :class="button"
              :aria-pressed="mapList"
              @click="mapList = !mapList"
            >
              Table view
            </button>
          </div>
          <PresenceMap v-model:list="mapList" :c="c" />
          <ArcLanes :c="c" :list="mapList" />
        </section>

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
          <section aria-labelledby="time-title" :class="section">
            <div class="flex items-center gap-2.5">
              <h2 id="time-title" :class="[heading, 'mr-auto']">
                Story time against reading order
              </h2>
              <button
                type="button"
                :class="button"
                :aria-pressed="timeList"
                @click="timeList = !timeList"
              >
                Table view
              </button>
            </div>
            <TimeChart v-if="c.chart.value" :chart="c.chart.value" :list="timeList" />
          </section>
          <section aria-labelledby="pov-title" :class="section">
            <h2 id="pov-title" :class="heading">POV balance</h2>
            <PovBalance :c="c" />
          </section>
        </div>
      </div>
      <FindingsList :c="c" />
    </div>
  </div>
</template>
