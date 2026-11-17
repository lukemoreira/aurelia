<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { FILTERS, type useContinuity } from '@/composables/useContinuity'
import type { ContinuityFinding } from '@/domain/continuity-checks'
import FindingCard from './FindingCard.vue'

/** What the checks found, in words: what, where and why. Filter it, go to the scene, or mark a finding intended. Checks never change the text. */
const props = defineProps<{ c: ReturnType<typeof useContinuity> }>()
const c = props.c
const root = ref<HTMLElement | null>(null)
const showPossible = ref(false)
const showMarked = ref(false)
const place = (f: ContinuityFinding) => c.model.value?.byId.get(f.scene)?.ref ?? ''
const button =
  'h-8 rounded-[7px] px-2.5 text-xs font-medium pointer-coarse:h-11 pointer-coarse:px-3.5'
/** The other scenes a finding is about, as lines: "Also: 1.1 · The Breakwater". */
const evidence = (f: ContinuityFinding) =>
  f.related
    .map((id) => c.model.value?.sceneName(id))
    .filter(Boolean)
    .join(' · ')
const total = () => c.counts.value.all ?? 0

// A cell of the map that holds a finding sends the keyboard here, to that finding.
watch(
  () => c.focusRequest.value,
  async (req) => {
    if (!req) return
    showPossible.value = true
    await nextTick()
    const el = [...(root.value?.querySelectorAll<HTMLElement>('[data-fingerprint]') ?? [])].find(
      (e) => e.dataset.fingerprint === req.fingerprint,
    )
    el?.scrollIntoView?.({ block: 'nearest' })
    el?.focus()
  },
)
</script>

<template>
  <aside
    ref="root"
    aria-label="Findings"
    class="order-first flex shrink-0 flex-col gap-3 border-b border-line bg-chrome p-4 lg:order-none lg:w-[340px] lg:overflow-y-auto lg:border-b-0 lg:border-l"
  >
    <div class="flex items-baseline justify-between">
      <h2 class="m-0 text-sm font-semibold">
        Findings <span class="font-medium text-ink-3">{{ total() }}</span>
      </h2>
      <button
        v-if="c.marked.value.length"
        type="button"
        :class="[button, 'px-1 text-ink-2 underline underline-offset-2 hover:text-ink']"
        :aria-expanded="showMarked"
        @click="showMarked = !showMarked"
      >
        {{ c.marked.value.length }} marked as intended
      </button>
    </div>

    <p v-if="c.only.value" class="m-0 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-2">
      Findings for {{ c.onlyTitle.value }}
      <button
        type="button"
        :class="[button, 'px-1 text-gold-ink underline underline-offset-2']"
        @click="c.showAll()"
      >
        Show all
      </button>
    </p>

    <div role="group" aria-label="Filter findings" class="flex flex-wrap gap-1">
      <button
        v-for="f in FILTERS"
        :key="f.value"
        type="button"
        :aria-pressed="c.filter.value === f.value"
        :class="[
          button,
          'border',
          c.filter.value === f.value
            ? 'border-gold-ink bg-gold-soft font-semibold text-ink'
            : 'border-line-2 text-ink-2 hover:bg-raised',
        ]"
        @click="c.filter.value = f.value"
      >
        {{ f.label }}
        <span v-if="f.value !== 'all' && c.counts.value[f.value]" class="text-ink-3">{{
          c.counts.value[f.value]
        }}</span>
      </button>
    </div>

    <p v-if="!c.certain.value.length" role="status" class="m-0 text-[12.5px] text-ink-2">
      Nothing to fix here. Checks run on this device, from the changes and times you recorded.
    </p>
    <ol v-else class="m-0 flex list-none flex-col gap-2 p-0">
      <FindingCard
        v-for="f in c.certain.value"
        :key="f.fingerprint"
        :data-finding="f.check"
        :data-fingerprint="f.fingerprint"
        :title="f.title"
        :body="f.body"
        :severity="f.severity"
      >
        <template v-if="f.related.length" #evidence>Also: {{ evidence(f) }}</template>
        <button
          type="button"
          :class="[button, 'text-gold-ink hover:bg-gold-soft']"
          @click="c.show(f)"
        >
          Go to {{ place(f) || 'scene' }}
        </button>
        <button
          v-if="c.canEdit.value && f.intendable"
          type="button"
          :class="[button, 'text-ink-2 hover:bg-raised']"
          :aria-label="`Mark intended: ${f.title}, ${f.body}`"
          @click="c.dismiss(f, true)"
        >
          Mark intended
        </button>
      </FindingCard>
    </ol>

    <div v-if="c.possible.value.length" class="flex flex-col gap-2">
      <button
        type="button"
        :class="[button, 'self-start px-1 text-ink-2 underline underline-offset-2 hover:text-ink']"
        :aria-expanded="showPossible"
        @click="showPossible = !showPossible"
      >
        {{ c.possible.value.length }} possible
        {{ c.possible.value.length === 1 ? 'overlap' : 'overlaps' }}
      </button>
      <ul v-if="showPossible" class="m-0 flex list-none flex-col gap-2 p-0">
        <FindingCard
          v-for="f in c.possible.value"
          :key="f.fingerprint"
          :data-fingerprint="f.fingerprint"
          :title="f.title"
          :body="f.body"
          :severity="f.severity"
        >
          <button
            type="button"
            :class="[button, 'text-gold-ink hover:bg-gold-soft']"
            @click="c.show(f)"
          >
            Go to {{ place(f) || 'scene' }}
          </button>
          <button
            v-if="c.canEdit.value"
            type="button"
            :class="[button, 'text-ink-2 hover:bg-raised']"
            :aria-label="`Mark intended: ${f.title}, ${f.body}`"
            @click="c.dismiss(f, true)"
          >
            Mark intended
          </button>
        </FindingCard>
      </ul>
    </div>

    <ul
      v-if="showMarked && c.marked.value.length"
      aria-label="Marked as intended"
      class="m-0 flex list-none flex-col gap-1.5 p-0"
    >
      <li
        v-for="f in c.marked.value"
        :key="f.fingerprint"
        class="flex items-start justify-between gap-2 rounded-[10px] border border-dashed border-line-2 px-3 py-2 text-[12.5px] text-ink-2"
      >
        <span>{{ f.body }}</span>
        <button
          v-if="c.canEdit.value"
          type="button"
          :class="[button, 'shrink-0 text-ink hover:bg-raised']"
          :aria-label="`Undo: ${f.title}, ${f.body}`"
          @click="c.dismiss(f, false)"
        >
          Undo
        </button>
      </li>
    </ul>

    <p class="m-0 border-t border-line pt-3 text-xs text-ink-3">
      Checks run on this device from your scene data. They never change your text.
    </p>
  </aside>
</template>
