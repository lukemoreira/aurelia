<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'

const ws = useWorkspaceStore()
const fmt = (n: number) => n.toLocaleString('en-US')
const where = computed(() => {
  const ctx = ws.context
  return ctx ? `Ch. ${ctx.chapter.number} · Scene ${ctx.index} of ${ctx.chapter.scenes.length}` : ''
})
</script>

<template>
  <footer
    class="flex min-h-8 shrink-0 flex-wrap items-center gap-x-[18px] gap-y-1 border-t border-line bg-chrome px-3.5 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 text-xs tabular-nums text-ink-3"
  >
    <span
      ><b class="font-medium text-ink-2">{{ fmt(ws.words.scene) }}</b> scene</span
    >
    <span
      ><b class="font-medium text-ink-2">{{ fmt(ws.words.chapter) }}</b> chapter</span
    >
    <span
      ><b class="font-medium text-ink-2">{{ fmt(ws.words.book) }}</b> book</span
    >
    <span class="flex-1" />
    <span v-if="where">{{ where }}</span>
    <span>{{ ws.saveState }}</span>
  </footer>
</template>
