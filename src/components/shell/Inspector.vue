<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import Tabs from '@/components/ui/Tabs.vue'
import SceneInspector from './SceneInspector.vue'

const route = useRoute()
const tab = ref('scene')
// Links, Notes and History arrive with the features they show; until then they are not offered.
const TABS = [{ value: 'scene', label: 'Scene' }]
</script>

<template>
  <!-- `relative` holds the resize handle the shell may slot in; the scrolling is inside. -->
  <aside
    aria-label="Scene inspector"
    class="relative flex h-full min-h-0 flex-col bg-chrome text-ink"
  >
    <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1.5">
      <h2 class="sr-only">Inspector</h2>
      <Tabs v-if="route.name === 'write'" v-model="tab" label="Inspector" :items="TABS">
        <template #scene><SceneInspector /></template>
      </Tabs>
      <div v-else class="px-1 py-6 text-center text-[12.5px]">
        <p class="m-0 font-semibold text-ink">Nothing to inspect here</p>
        <p class="mx-0 mb-0 mt-1 text-ink-2">The details of the open scene show in Write.</p>
      </div>
    </div>
    <slot />
  </aside>
</template>
