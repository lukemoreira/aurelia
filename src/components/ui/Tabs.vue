<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

defineProps<{
  /** Names the tab list for a screen reader. */
  label: string
  /** Each tab's panel is the slot named after its `value`. */
  items: { value: string; label: string }[]
}>()
const model = defineModel<string>()
</script>

<template>
  <TabsRoot v-model="model">
    <TabsList :aria-label="label" class="flex gap-1 border-b border-line">
      <TabsTrigger
        v-for="t in items"
        :key="t.value"
        :value="t.value"
        class="-mb-px h-9 border-b-2 border-transparent px-3 text-[13px] font-medium text-ink-2 hover:text-ink data-[state=active]:border-gold data-[state=active]:font-semibold data-[state=active]:text-ink pointer-coarse:h-11"
      >
        {{ t.label }}
      </TabsTrigger>
    </TabsList>
    <TabsContent v-for="t in items" :key="t.value" :value="t.value" class="pt-3">
      <slot :name="t.value" />
    </TabsContent>
  </TabsRoot>
</template>
