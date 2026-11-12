<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { buttonBase } from '@/components/ui/buttonStyles'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'

const ws = useWorkspaceStore()
const layout = useLayoutStore()
const route = useRoute()
const title = computed(() =>
  route.name === 'write'
    ? (ws.scene?.meta.title ?? ws.book?.title ?? '')
    : String(route.meta.title ?? ''),
)
const button = [buttonBase, 'size-11 rounded-[10px] text-ink-2 hover:bg-raised']
</script>

<template>
  <!-- The phone header: 44 px targets, the title and the save state between them. -->
  <header
    class="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-0.5 border-b border-line bg-chrome pb-0 pl-[max(0.375rem,env(safe-area-inset-left))] pr-[max(0.375rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)]"
  >
    <button
      type="button"
      aria-label="Open the navigator"
      :class="button"
      @click="layout.navSheet = true"
    >
      <Icon name="menu" :size="20" />
    </button>
    <div class="flex min-w-0 flex-1 flex-col leading-tight">
      <span class="truncate text-[15px] font-semibold">{{ title }}</span>
      <span v-if="route.name === 'write'" class="truncate text-xs text-ink-3">{{
        ws.saveState
      }}</span>
    </div>
    <button
      type="button"
      aria-label="Scene details"
      :class="button"
      @click="layout.inspectorSheet = true"
    >
      <Icon name="panel-right" :size="20" />
    </button>
    <button
      type="button"
      aria-label="Search or run a command"
      :class="button"
      @click="layout.paletteOpen = true"
    >
      <Icon name="search" :size="20" />
    </button>
  </header>
</template>
