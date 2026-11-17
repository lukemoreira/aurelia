<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Menu from '@/components/ui/Menu.vue'
import MediaGallery from '@/components/media/MediaGallery.vue'
import NewNames from '@/components/world/NewNames.vue'
import PlaceTree from '@/components/world/PlaceTree.vue'
import RecordSheet from '@/components/world/RecordSheet.vue'
import { useMedia } from '@/composables/useMedia'
import { useNewNames } from '@/composables/useNewNames'
import { useOutlineEdits } from '@/composables/useOutlineEdits'
import { useWorld } from '@/composables/useWorld'
import { useWorkspaceStore } from '@/stores/workspace'

const ws = useWorkspaceStore()
const edit = useOutlineEdits()
const w = useWorld()
const found = useNewNames()
const media = useMedia()
/** The wide pane has something in it: a record, or the gallery, or the new names. */
const tools = computed(() => [
  {
    panel: 'media' as const,
    label: 'Media',
    icon: 'image' as const,
    count: media.items.value.length,
  },
  {
    panel: 'names' as const,
    label: 'New names',
    icon: 'search' as const,
    count: found.names.value.length,
  },
])
const showing = computed(() => !!w.selected.value || !!w.panel.value)
</script>

<template>
  <div
    class="mx-auto grid w-full max-w-[1120px] gap-8 px-4 pb-16 pt-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-7"
  >
    <section
      aria-labelledby="world-title"
      :class="['flex min-w-0 flex-col gap-3', showing && 'hidden lg:flex']"
    >
      <div class="flex items-center justify-between gap-2">
        <h1 id="world-title" class="m-0 font-prose text-[26px] font-medium leading-[1.2]">World</h1>
        <Menu
          v-if="edit.canEdit.value"
          align="end"
          :items="w.newItems.value"
          @select="w.create($event)"
        >
          <template #trigger>
            <Button variant="primary"><Icon name="plus" :size="14" />New</Button>
          </template>
        </Menu>
      </div>
      <label
        class="flex h-8 items-center gap-[7px] rounded-control border border-field bg-surface px-2 text-ink-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink pointer-coarse:h-11"
      >
        <Icon name="filter" :size="14" />
        <span class="sr-only">Find a record by name</span>
        <input
          v-model="w.filter.value"
          type="search"
          placeholder="Find by name"
          class="h-full min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-ink placeholder:text-ink-3"
        />
      </label>
      <section aria-label="Library tools">
        <ul class="m-0 flex list-none flex-col gap-px p-0">
          <li v-for="t in tools" :key="t.panel">
            <button
              type="button"
              :aria-current="w.panel.value === t.panel ? 'true' : undefined"
              class="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] text-ink-2 hover:bg-raised aria-[current=true]:bg-gold-soft aria-[current=true]:font-semibold aria-[current=true]:text-gold-ink pointer-coarse:h-11"
              @click="w.openPanel(t.panel)"
            >
              <Icon :name="t.icon" :size="15" />
              <span class="min-w-0 flex-1 truncate">{{ t.label }}</span>
              <span v-if="t.count" class="text-[11.5px] tabular-nums text-ink-3">{{
                t.count
              }}</span>
            </button>
          </li>
        </ul>
      </section>
      <p v-if="!w.total.value" class="m-0 text-[13px] text-ink-2">
        No characters or places yet.
        <template v-if="edit.canEdit.value">Use New to add the first.</template>
      </p>
      <p v-else-if="!w.groups.value.length" role="status" class="m-0 text-[13px] text-ink-2">
        Nothing is called “{{ w.filter.value }}”.
      </p>
      <section v-for="g in w.groups.value" :key="g.id" :aria-label="g.label">
        <h2
          class="m-0 px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-3"
        >
          {{ g.label }} · {{ g.items.length }}
        </h2>
        <PlaceTree
          v-if="g.id === 'places' && !w.filter.value"
          :selected="w.selectedId.value"
          @open="w.open"
        />
        <ul v-else class="m-0 flex list-none flex-col gap-px p-0">
          <li v-for="r in g.items" :key="r.meta.id">
            <button
              type="button"
              :aria-current="w.selectedId.value === r.meta.id ? 'true' : undefined"
              class="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] text-ink-2 hover:bg-raised aria-[current=true]:bg-gold-soft aria-[current=true]:font-semibold aria-[current=true]:text-gold-ink pointer-coarse:h-11"
              @click="w.open(r.meta.id)"
            >
              <Icon :name="g.icon" :size="15" />
              <span class="min-w-0 flex-1 truncate">{{ r.meta.title }}</span>
              <span v-if="r.meta.scope !== 'universe'" class="text-[11px] text-ink-3"
                >this book</span
              >
            </button>
          </li>
        </ul>
      </section>
    </section>

    <section aria-label="Record" :class="['min-w-0', !showing && 'hidden lg:block']">
      <Button v-if="showing" class="mb-4 lg:hidden" variant="quiet" @click="w.close()"
        >← All records</Button
      >
      <MediaGallery v-if="w.panel.value === 'media'" />
      <NewNames v-else-if="w.panel.value === 'names'" />
      <RecordSheet v-else-if="w.selected.value" :id="w.selected.value.meta.id" />
      <div v-else class="flex flex-col items-start gap-1 py-10 text-ink-2">
        <p class="m-0 font-semibold text-ink">Pick a record</p>
        <p class="m-0 text-[13px]">
          Its sheet opens here:
          <template v-if="ws.view"> names, notes and the details of what it is.</template>
          <template v-else> the sample is a read-only tour.</template>
        </p>
      </div>
    </section>
  </div>
</template>
