<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import { useAppUpdate } from '@/composables/useAppUpdate'

const { updateReady, reload, dismiss } = useAppUpdate()
</script>

<template>
  <!-- Never reloads by itself: the author may be in the middle of a sentence. -->
  <div
    v-if="updateReady"
    role="status"
    class="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-[60] flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-3 rounded-card border border-line bg-surface py-2.5 pl-4 pr-2.5 text-[13px] text-ink shadow-card"
  >
    <span class="font-medium">Update available</span>
    <span class="flex gap-2">
      <Button variant="primary" size="sm" @click="reload">Reload</Button>
      <Button variant="quiet" size="sm" @click="dismiss">Later</Button>
    </span>
  </div>
</template>
