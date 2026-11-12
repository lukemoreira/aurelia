<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'

const route = useRoute()
const ws = useWorkspaceStore()

// The World view can be opened on a record (from the palette or the library).
const record = computed(() => {
  const id = route.query.record
  return typeof id === 'string'
    ? ws.entries.find((e) => e.kind === 'record' && e.id === id)
    : undefined
})
const title = computed(() => record.value?.title ?? String(route.meta.title ?? ''))
const detail = computed(() => record.value?.sub.split(' · ').slice(0, 2).join(' · '))
const when = computed(() =>
  record.value ? 'Its sheet arrives in v0.3.' : String(route.meta.blurb ?? ''),
)
</script>

<template>
  <section class="mx-auto flex max-w-[480px] flex-col items-center gap-2 px-6 py-24 text-center">
    <h1 class="m-0 font-prose text-[26px] font-medium leading-[1.2]">{{ title }}</h1>
    <p v-if="detail" class="m-0 text-sm text-ink-2">{{ detail }}</p>
    <p class="m-0 text-[13px] text-ink-2">{{ when }}</p>
  </section>
</template>
