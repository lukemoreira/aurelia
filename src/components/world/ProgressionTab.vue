<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import { toolButton } from '@/components/ui/buttonStyles'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { useProgression } from '@/composables/useProgression'
import { SCOPES, SCOPE_LABEL } from '@/domain/continuity-universe'
import ProgressionTable from './ProgressionTable.vue'

/**
 * A character's progression: where they are on the page chapter by chapter, a scrubber that moves
 * through the story in reading order to show their state at any scene, and every change recorded
 * about them. It is read from the scenes' changes; nothing is edited here.
 */
const props = defineProps<{ id: string; name: string }>()
const c = useProgression(() => props.id)
const list = ref(false)
const heading = 'm-0 text-[13px] font-semibold text-ink'
</script>

<template>
  <section aria-labelledby="progression-title" class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2.5">
      <div class="mr-auto">
        <h2 id="progression-title" class="m-0 text-[13px] font-medium text-ink">Progression</h2>
        <p class="m-0 text-xs text-ink-3">
          What changes for {{ name }}, scene by scene in reading order.
        </p>
      </div>
      <SegmentedControl
        v-if="c.bookCount.value > 1"
        v-model="c.scope.value"
        :label="SCOPE_LABEL"
        :options="SCOPES"
      />
      <button type="button" :class="toolButton" :aria-pressed="list" @click="list = !list">
        Table view
      </button>
    </div>

    <p
      v-if="!c.appears.value && !c.p.value?.log.length"
      role="status"
      class="m-0 text-[13px] text-ink-2"
    >
      {{ name }} is not on the page of any scene yet, and nothing has changed for them. Name them in
      a scene, or record a change on it, and their progression shows here.
    </p>
    <template v-else>
      <ProgressionTable v-model:list="list" :c="c" :name="name" />

      <div class="flex flex-col gap-2 rounded-card border border-line bg-surface p-3.5">
        <label
          v-if="c.count.value > 1"
          for="progression-scrub"
          class="flex items-baseline justify-between gap-2 text-[13px] font-medium"
        >
          Story position
          <span class="text-ink-2">{{ c.scene.value?.ref }}</span>
        </label>
        <div v-if="c.count.value > 1" class="flex items-center gap-2">
          <button
            type="button"
            :class="toolButton"
            :disabled="c.at.value <= 0"
            aria-label="Earlier scene"
            @click="c.move(c.at.value - 1)"
          >
            ←
          </button>
          <input
            id="progression-scrub"
            type="range"
            min="0"
            :max="Math.max(0, c.count.value - 1)"
            :value="c.at.value"
            :aria-valuetext="c.scene.value?.name"
            class="min-w-0 flex-1 accent-[var(--gold-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            @input="c.move(Number(($event.target as HTMLInputElement).value))"
          />
          <button
            type="button"
            :class="toolButton"
            :disabled="c.at.value >= c.count.value - 1"
            aria-label="Later scene"
            @click="c.move(c.at.value + 1)"
          >
            →
          </button>
        </div>
        <p class="m-0 text-xs text-ink-2">
          {{ c.scene.value?.name }}
          <button
            v-if="c.scene.value"
            type="button"
            class="ml-1 min-h-8 font-medium text-gold-ink underline underline-offset-2 pointer-coarse:min-h-11"
            @click="c.open(c.scene.value.id)"
          >
            Open scene
          </button>
        </p>
      </div>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section aria-labelledby="state-title" class="flex flex-col gap-2">
          <h3 id="state-title" :class="heading">State at {{ c.scene.value?.ref }}</h3>
          <p v-if="!c.state.value.length" class="m-0 text-[13px] text-ink-2">
            Nothing is recorded about {{ name }} at this point.
          </p>
          <dl v-else class="m-0 flex flex-col gap-2">
            <div v-for="row in c.state.value" :key="row.label" class="flex flex-col gap-0.5">
              <dt class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3">
                {{ row.label }}
              </dt>
              <dd
                v-for="(item, i) in row.items"
                :key="i"
                :class="['m-0 text-[13px]', item.later ? 'text-ink-2' : '']"
              >
                {{ item.text }}
                <span v-if="item.later" class="text-ink-3"> · in {{ item.later }}</span>
                <span v-if="item.since" class="text-ink-3"> · since {{ item.since }}</span>
                <span v-if="item.some" class="text-ink-3"> · on some paths</span>
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="log-title" class="flex flex-col gap-2">
          <h3 id="log-title" :class="heading">What changes, scene by scene</h3>
          <p v-if="!c.p.value?.log.length" class="m-0 text-[13px] text-ink-2">
            No change is recorded about {{ name }} yet.
          </p>
          <ol v-else class="m-0 flex list-none flex-col gap-1.5 p-0">
            <li
              v-for="(e, i) in c.p.value.log"
              :key="i"
              :class="[
                'flex flex-col gap-0.5 rounded-control border border-line px-3 py-2 text-[12.5px]',
                e.at > c.at.value ? 'bg-canvas text-ink-2' : 'bg-surface',
              ]"
            >
              <span class="flex flex-wrap items-center gap-x-2 text-ink-3">
                <button
                  type="button"
                  class="min-h-8 font-medium text-ink-2 underline underline-offset-2 hover:text-ink pointer-coarse:min-h-11"
                  @click="c.open(e.scene)"
                >
                  {{ e.ref }} {{ e.sceneTitle }}
                </button>
                {{ ' ' }}<span>{{ e.kind }}</span>
                <template v-if="e.at > c.at.value">
                  {{ ' ' }}<span>· later in the story</span>
                </template>
              </span>
              {{ ' ' }}<span>{{ e.text }}</span>
            </li>
          </ol>
        </section>
      </div>
    </template>
  </section>
</template>
