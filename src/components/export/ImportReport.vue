<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import { smallCapsHeading } from '@/components/ui/fieldStyles'
import type { ImportPlan, ReportItem } from '@/import/plan'

const props = defineProps<{
  plan: ImportPlan
  stats: { chapters: number; scenes: number; choices: number; words: number }
}>()

const SCENES_SHOWN = 4
const NAMES_SHOWN = 8
const more = (n: number, word: string) => `and ${n} more ${word}${n === 1 ? '' : 's'}`
const plural = (n: number, word: string) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`
const sections = computed<{ id: string; title: string; tone: string; items: ReportItem[] }[]>(() =>
  [
    {
      id: 'unread',
      title: 'What could not be read',
      tone: 'border-warn-line bg-warn-soft',
      items: props.plan.report.unread,
    },
    {
      id: 'notes',
      title: 'Good to know',
      tone: 'border-info-line bg-info-soft',
      items: props.plan.report.notes,
    },
  ].filter((s) => s.items.length),
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <section aria-labelledby="imp-made" class="flex flex-col gap-2">
      <h3 id="imp-made" :class="smallCapsHeading">What will be made</h3>
      <p class="m-0">
        {{ plan.mode === 'branching' ? 'A branching book' : 'A book' }} with
        {{ plural(stats.chapters, 'chapter') }}, {{ plural(stats.scenes, 'scene')
        }}<template v-if="stats.choices">, {{ plural(stats.choices, 'choice') }}</template> and
        about {{ plural(stats.words, 'word') }}.
      </p>
      <ul
        tabindex="0"
        aria-label="The chapters and scenes that will be made"
        class="m-0 flex max-h-44 list-none flex-col gap-1.5 relative overflow-y-auto rounded-control border border-line p-3"
      >
        <li v-for="(c, i) in plan.chapters" :key="i">
          <span class="font-semibold">{{ c.title }}</span>
          <span class="text-ink-2"> · {{ plural(c.scenes.length, 'scene') }}</span>
          <span class="block text-[12.5px] text-ink-2">
            {{
              c.scenes
                .slice(0, SCENES_SHOWN)
                .map((s) => s.title)
                .join(' · ')
            }}<template v-if="c.scenes.length > SCENES_SHOWN">
              · {{ more(c.scenes.length - SCENES_SHOWN, 'scene') }}</template
            >
          </span>
        </li>
      </ul>
    </section>

    <section aria-labelledby="imp-read" class="flex flex-col gap-2">
      <h3 id="imp-read" :class="smallCapsHeading">Report</h3>
      <p v-if="!sections.length" class="m-0 text-ink-2">Everything was read.</p>
      <div
        v-for="s in sections"
        :key="s.id"
        :class="['flex flex-col gap-2 rounded-control border px-3.5 py-3', s.tone]"
      >
        <h4 class="m-0 text-[13px] font-semibold">{{ s.title }}</h4>
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          <li v-for="(item, n) in s.items" :key="n" class="flex flex-col gap-0.5">
            <span>{{ item.text }}</span>
            <ul
              v-if="item.names.length"
              class="m-0 flex list-none flex-col gap-px p-0 text-[12.5px] text-ink-2"
            >
              <li
                v-for="(name, k) in item.names.slice(0, NAMES_SHOWN)"
                :key="k"
                class="break-words"
              >
                {{ name }}
              </li>
              <li v-if="item.names.length > NAMES_SHOWN">
                and {{ item.names.length - NAMES_SHOWN }} more
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
