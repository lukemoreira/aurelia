<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import type { IconName } from '@/domain/ui-names'
import Icon from './Icon.vue'
import Tooltip from './Tooltip.vue'

defineProps<{
  /** Names the tab list for a screen reader. */
  label: string
  /**
   * Each tab's panel is the slot named after its `value`. A tab with an icon shows only the icon,
   * with its label as the tooltip and as its name for a screen reader: a narrow strip fits.
   */
  items: { value: string; label: string; icon?: IconName }[]
  /** Fill a side panel: the strip stays put and only the open tab's panel scrolls, under it. */
  fill?: boolean
}>()
const model = defineModel<string>()
const trigger =
  '-mb-px h-9 shrink-0 border-b-2 border-transparent text-[13px] font-medium text-ink-2 hover:text-ink data-[state=active]:border-gold data-[state=active]:font-semibold data-[state=active]:text-ink pointer-coarse:h-11'
</script>

<template>
  <TabsRoot v-model="model" :class="fill && 'flex min-h-0 flex-1 flex-col'">
    <TabsList
      :aria-label="label"
      :class="[
        'relative flex gap-0.5 overflow-x-auto border-b border-line [scrollbar-width:thin]',
        fill && 'mx-3 shrink-0',
      ]"
    >
      <template v-for="t in items" :key="t.value">
        <Tooltip v-if="t.icon" :text="t.label">
          <TabsTrigger
            :value="t.value"
            :aria-label="t.label"
            :class="[trigger, 'flex w-9 items-center justify-center pointer-coarse:w-11']"
            ><Icon :name="t.icon"
          /></TabsTrigger>
        </Tooltip>
        <TabsTrigger v-else :value="t.value" :class="[trigger, 'px-2.5']">{{
          t.label
        }}</TabsTrigger>
      </template>
    </TabsList>
    <TabsContent
      v-for="t in items"
      :key="t.value"
      :value="t.value"
      :class="['pt-3', fill && 'relative min-h-0 flex-1 overflow-y-auto px-3 pb-4']"
    >
      <slot :name="t.value" />
    </TabsContent>
  </TabsRoot>
</template>
