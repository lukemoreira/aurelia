<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { snapshotRef } from '@/storage/snapshot-words'
import type { Snapshot } from '@/storage/snapshots'

defineProps<{ snapshot: Snapshot | undefined; kind: 'scene' | 'book'; busy: boolean }>()
const open = defineModel<boolean>('open', { default: false })
defineEmits<{ confirm: [] }>()
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="kind === 'scene' ? 'Restore this scene?' : 'Restore this book?'"
    :description="snapshot ? `From ${snapshotRef(snapshot)}.` : undefined"
  >
    <ul class="m-0 flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
      <li>
        {{
          kind === 'scene'
            ? 'The words of this scene go back to how they were. Its details stay as they are.'
            : 'The words of every scene go back to how they were.'
        }}
      </li>
      <li>
        What you have now is saved first, as a snapshot called “Before restore”. You can come back
        to it.
      </li>
      <li v-if="kind === 'book'">
        Scenes you wrote since stay. Scenes you deleted since come back.
      </li>
    </ul>
    <template #footer>
      <Button variant="quiet" @click="open = false">Cancel</Button>
      <Button variant="primary" :loading="busy" @click="$emit('confirm')">Restore</Button>
    </template>
  </Dialog>
</template>
