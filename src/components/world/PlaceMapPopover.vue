<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { onMounted, ref, useId } from 'vue'
import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { SceneHere } from '@/domain/place-maps'

/** What a pin opens: the place, its map, the scenes set there, and in edit mode taking the pin off. */
defineProps<{
  title: string
  kind?: string
  hasMap: boolean
  scenes: SceneHere[]
  editing: boolean
}>()
const emit = defineEmits<{
  close: []
  place: []
  map: []
  scene: [scene: SceneHere]
  remove: []
}>()
const titleId = useId()
const el = ref<HTMLElement>()
// Focus moves in when it opens (Escape or Close puts it back on the pin).
onMounted(() => el.value?.focus())
</script>

<template>
  <div
    ref="el"
    role="dialog"
    aria-modal="false"
    :aria-labelledby="titleId"
    tabindex="-1"
    class="relative flex max-h-72 flex-col gap-2 overflow-auto rounded-card border border-line bg-surface p-3 text-[13px] text-ink shadow-card outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
    @keydown.esc.stop="emit('close')"
  >
    <div class="flex items-start justify-between gap-2">
      <div>
        <h3 :id="titleId" class="m-0 text-sm font-semibold">{{ title }}</h3>
        <p v-if="kind" class="m-0 text-xs text-ink-2">{{ kind }}</p>
      </div>
      <IconButton icon="close" label="Close" size="sm" :tooltip="false" @click="emit('close')" />
    </div>
    <div class="flex flex-wrap gap-1.5">
      <Button size="sm" @click="emit('place')">Open place</Button>
      <Button v-if="hasMap" size="sm" @click="emit('map')">Open its map</Button>
    </div>
    <div>
      <h4 class="m-0 text-xs font-semibold text-ink-2">Scenes set here ({{ scenes.length }})</h4>
      <p v-if="!scenes.length" class="m-0 mt-1 text-xs text-ink-3">No scene is set here yet.</p>
      <ul v-else class="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
        <li v-for="s in scenes" :key="s.id">
          <button
            type="button"
            class="inline-flex min-h-8 w-full flex-col items-start rounded-control px-1.5 text-left text-ink underline-offset-2 hover:bg-raised hover:underline pointer-coarse:min-h-11"
            @click="emit('scene', s)"
          >
            {{ s.title }}
            <span v-if="s.at" class="text-xs text-ink-3">in {{ s.at.title }}</span>
          </button>
        </li>
      </ul>
    </div>
    <!-- Last, and quiet, away from Close. -->
    <div v-if="editing" class="border-t border-line pt-2">
      <Button size="sm" variant="quiet" class="!text-danger" @click="emit('remove')">
        Remove pin
      </Button>
    </div>
  </div>
</template>
