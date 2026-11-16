<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Switch from '@/components/ui/Switch.vue'
import { useEditorStore } from '@/stores/editor'
import { useWorkspaceStore } from '@/stores/workspace'

/** "Show names": the names Aurelia found are drawn in the text, by type (ADR-0010). Off, they read as plain text. */
const appearance = useEditorStore()
const ws = useWorkspaceStore()

const KEY: Record<string, { label: string; bar: string }> = {
  ember: { label: 'Character', bar: 'bg-ember' },
  moss: { label: 'Place', bar: 'bg-moss' },
  tide: { label: 'Other', bar: 'bg-tide' },
  plum: { label: 'Colour you chose', bar: 'bg-plum' },
}
/** Every colour that is drawn in this scene, and no other: a key to what is on the page. */
const legend = computed(() => {
  void ws.indexVersion
  const tones = new Set(ws.sceneId ? ws.index.foundNames(ws.sceneId).map((f) => f.target.tone) : [])
  return Object.entries(KEY).filter(([tone]) => tones.has(tone as never))
})
</script>

<template>
  <div class="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
    <!-- A key to the colours, only while they show: every name is also underlined, never colour alone. -->
    <ul
      v-if="appearance.showNames"
      aria-label="What the colours mean"
      class="m-0 flex list-none flex-wrap items-center gap-3 p-0 text-xs text-ink-2"
    >
      <li v-for="[tone, k] in legend" :key="tone" class="flex items-center gap-1.5">
        <span aria-hidden="true" :class="['h-0.5 w-3.5 rounded-full', k.bar]" />{{ k.label }}
      </li>
      <li class="flex items-center gap-1.5">
        <span aria-hidden="true" class="w-3.5 border-b-2 border-dashed border-ink-3" />Needs your
        answer
      </li>
    </ul>
    <Switch v-model="appearance.showNames" label="Show names" />
  </div>
</template>
