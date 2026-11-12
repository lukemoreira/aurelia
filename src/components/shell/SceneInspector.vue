<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Avatar from '@/components/ui/Avatar.vue'
import Icon from '@/components/ui/Icon.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import Tag from '@/components/ui/Tag.vue'
import { sceneDetails } from '@/domain/scene-details'
import { useWorkspaceStore } from '@/stores/workspace'

const ws = useWorkspaceStore()
const d = computed(() => (ws.data && ws.sceneId ? sceneDetails(ws.data, ws.sceneId) : undefined))
const colour = (c?: string) => (c ? `var(--${c})` : undefined)
const progress = computed(() =>
  d.value?.target ? Math.min(100, Math.round((d.value.words / d.value.target) * 100)) : 0,
)

const label = 'text-[11px] font-semibold uppercase tracking-[.06em] text-ink-3'
const section = 'flex flex-col gap-2 border-t border-line pt-3.5'
</script>

<template>
  <div v-if="d" class="flex flex-col gap-4 text-[12.5px]">
    <div class="flex items-center justify-between">
      <h3 :class="[label, 'tracking-[.08em]']">Scene {{ d.label }}</h3>
      <span
        v-if="d.status"
        class="inline-flex h-[26px] items-center rounded-full border border-line-2 bg-surface px-2.5 text-xs font-medium"
      >
        <StatusDot :status="d.status" show-label />
      </span>
    </div>

    <dl class="m-0 grid grid-cols-[76px_minmax(0,1fr)] items-center gap-y-2.5">
      <template v-if="d.pov">
        <dt class="text-ink-3">POV</dt>
        <dd class="m-0 flex items-center gap-2">
          <Avatar :name="d.pov.name" :color="colour(d.pov.color)" :size="24" />{{ d.pov.name }}
        </dd>
      </template>
      <template v-if="d.location">
        <dt class="text-ink-3">Location</dt>
        <dd class="m-0 flex items-center gap-2">
          <Icon name="place" :size="15" class="text-ink-3" />{{ d.location }}
        </dd>
      </template>
      <template v-if="d.storyTime">
        <dt class="text-ink-3">Story time</dt>
        <dd class="m-0 flex items-center gap-2">
          <Icon name="calendar" :size="15" class="text-ink-3" />{{ d.storyTime }}
        </dd>
      </template>
      <dt class="text-ink-3">Length</dt>
      <dd class="m-0 flex flex-col gap-[5px]">
        <span class="flex justify-between"
          ><span>{{ d.words.toLocaleString('en-US') }} words</span
          ><span v-if="d.target" class="text-ink-3"
            >of {{ d.target.toLocaleString('en-US') }}</span
          ></span
        >
        <span v-if="d.target" aria-hidden="true" class="h-1 overflow-hidden rounded-full bg-raised"
          ><span class="block h-full rounded-full bg-gold" :style="{ width: `${progress}%` }"
        /></span>
      </dd>
    </dl>

    <div
      v-if="d.objective || d.conflict || d.outcome"
      class="flex flex-col gap-2.5 border-t border-line pt-3.5"
    >
      <div
        v-for="[title, text] in [
          ['Objective', d.objective],
          ['Conflict', d.conflict],
          ['Outcome', d.outcome],
        ] as const"
        :key="title"
      >
        <template v-if="text">
          <h3 :class="label">{{ title }}</h3>
          <div class="mt-[3px] text-ink-2">{{ text }}</div>
        </template>
      </div>
    </div>

    <div v-if="d.people.length || d.arcs.length" :class="section">
      <h3 v-if="d.people.length" :class="label">In this scene</h3>
      <ul class="m-0 flex list-none flex-wrap gap-1.5 p-0">
        <li
          v-for="p in d.people"
          :key="p.id"
          :class="[
            'inline-flex h-[26px] items-center gap-1.5 rounded-full py-0 pl-[3px] pr-[9px] text-xs',
            p.bookOnly
              ? 'border border-dashed border-line-2 text-ink-2'
              : 'border border-line bg-surface text-ink',
          ]"
        >
          <Avatar :name="p.name" :color="colour(p.color)" :size="20" />{{ p.name }}
          <span v-if="p.pov" class="text-[11px] font-semibold text-gold-ink">POV</span>
          <span v-if="p.bookOnly" class="text-[11px] text-ink-3">this book</span>
        </li>
      </ul>
      <ul
        v-if="d.arcs.length"
        aria-label="Arcs"
        class="m-0 mt-0.5 flex list-none flex-wrap gap-1.5 p-0"
      >
        <li
          v-for="a in d.arcs"
          :key="a.id"
          class="inline-flex h-6 items-center gap-1.5 rounded-md border border-line bg-surface px-[9px] text-xs"
        >
          <span
            aria-hidden="true"
            class="size-2 rounded-sm"
            :style="{ background: colour(a.color) ?? 'var(--ink-3)' }"
          />{{ a.name }}
        </li>
      </ul>
    </div>

    <div v-if="d.changes.length" :class="section">
      <h3 :class="label">What changes here</h3>
      <dl class="m-0 grid grid-cols-[92px_minmax(0,1fr)] items-baseline gap-x-2.5 gap-y-[7px]">
        <template v-for="(c, i) in d.changes" :key="i">
          <dt class="m-0 justify-self-start">
            <Tag>{{ c.kind }}</Tag>
          </dt>
          <dd class="m-0">{{ c.text }}</dd>
        </template>
      </dl>
    </div>

    <div :class="[section, 'flex-row items-center']">
      <h3 :class="label">Choices</h3>
      <span class="flex-1 text-ink-3">{{
        d.choices.length ? d.choices.join(' · ') : 'None — leads straight on'
      }}</span>
    </div>
  </div>
</template>
