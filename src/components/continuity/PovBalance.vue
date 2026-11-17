<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import type { useContinuity } from '@/composables/useContinuity'
import { formatWords } from '@/domain/outline'
import { tone } from './cells'

/** Whose eyes the book is told through (words and scenes for each point of view), and how many set-ups are paid off. */
const props = defineProps<{ c: ReturnType<typeof useContinuity> }>()
const c = props.c
const n = (v: number) => v.toLocaleString('en-US')
</script>

<template>
  <div class="flex flex-col gap-3">
    <p v-if="!c.pov.value.length" role="status" class="m-0 text-[12.5px] text-ink-2">
      No scene has a point of view yet.
    </p>
    <template v-else>
      <div aria-hidden="true" class="flex h-2.5 overflow-hidden rounded-full bg-raised">
        <span
          v-for="p in c.pov.value"
          :key="p.id"
          :style="{ width: `${p.share}%`, background: tone(p.tone) }"
        />
      </div>
      <table class="w-full border-collapse text-[12.5px]">
        <caption class="sr-only">
          Words and scenes for each point-of-view character.
        </caption>
        <thead class="sr-only">
          <tr>
            <th scope="col">Character</th>
            <th scope="col">Words</th>
            <th scope="col">Scenes</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in c.pov.value" :key="p.id">
            <th scope="row" class="py-1 text-left font-medium">
              <span class="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  class="size-2.5 rounded-sm"
                  :style="{ background: tone(p.tone) }"
                />{{ p.name }}
              </span>
            </th>
            <td class="py-1 text-right tabular-nums text-ink-2">{{ n(p.words) }} words</td>
            <td class="py-1 text-right tabular-nums text-ink-2">
              {{ p.scenes }} {{ p.scenes === 1 ? 'scene' : 'scenes' }}
            </td>
            <td class="py-1 pl-3 text-right font-semibold tabular-nums">{{ p.share }}%</td>
          </tr>
        </tbody>
      </table>
    </template>

    <div class="flex items-center justify-between border-t border-line pt-3 text-[12.5px]">
      <span class="font-semibold">Set-ups and pay-offs</span>
      <span v-if="c.setups.value.total" class="text-ink-2">
        {{ c.setups.value.paid }} of {{ c.setups.value.total }} paid off
      </span>
      <span v-else class="text-ink-3">None recorded</span>
    </div>

    <details class="border-t border-line pt-3 text-[12.5px]">
      <summary class="cursor-pointer font-semibold">Pacing, chapter by chapter</summary>
      <table class="mt-2 w-full border-collapse">
        <caption class="sr-only">
          Words in each chapter against what it was meant to be.
        </caption>
        <thead class="sr-only">
          <tr>
            <th scope="col">Chapter</th>
            <th scope="col">Words</th>
            <th scope="col">Target</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in c.pace.value" :key="p.id || 'unfiled'">
            <th scope="row" class="py-1 text-left font-normal">
              {{ p.number || 'Unfiled' }} · {{ p.title }}
            </th>
            <td class="py-1 text-right tabular-nums">{{ formatWords(p.words) }}</td>
            <td class="py-1 pl-3 text-right tabular-nums text-ink-3">
              {{ p.target ? `of ${formatWords(p.target)}` : 'no target' }}
            </td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>
