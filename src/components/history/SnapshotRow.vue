<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import { versionWhen } from '@/backup/words'
import { holds, snapshotName } from '@/storage/snapshot-words'
import type { Snapshot } from '@/storage/snapshots'

defineProps<{ snapshot: Snapshot; canRestore: boolean; restoreLabel: string }>()
defineEmits<{ compare: []; restore: [] }>()
</script>

<template>
  <li
    class="flex flex-col gap-1.5 border-t border-line px-3 py-2 first:border-t-0"
    :data-testid="`snapshot-${snapshot.id}`"
  >
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span class="min-w-0 break-words text-[13px] font-medium">{{ snapshotName(snapshot) }}</span>
      <span class="text-xs text-ink-3">{{ versionWhen(new Date(snapshot.at), Date.now()) }}</span>
    </div>
    <span class="text-[12.5px] text-ink-2">{{ holds(snapshot) }}</span>
    <p v-if="!snapshot.complete" class="m-0 text-xs text-ink-3">
      This one is still arriving from another device.
    </p>
    <div class="flex flex-wrap gap-1.5">
      <Button size="sm" variant="quiet" :disabled="!snapshot.complete" @click="$emit('compare')"
        >Compare</Button
      >
      <Button
        size="sm"
        variant="quiet"
        :disabled="!snapshot.complete || !canRestore"
        @click="$emit('restore')"
        >{{ restoreLabel }}</Button
      >
    </div>
  </li>
</template>
