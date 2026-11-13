<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { useTrashList } from '@/composables/useTrashList'
import { describeEntry } from '@/storage/set-aside'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'

const edits = useEditsStore()
const ws = useWorkspaceStore()
const { entries, loading, busy, error, restore } = useTrashList()

/** "12 Nov, 22:31": the day first, never a numeric month (it reads differently in different places). */
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
</script>

<template>
  <Dialog
    v-model:open="edits.trashOpen"
    size="md"
    title="Recently deleted"
    description="Nothing is deleted for good. Put it back and it returns exactly as it was."
  >
    <p v-if="loading" role="status" class="m-0 text-ink-2">Looking…</p>
    <p v-else-if="!entries.length" class="m-0 py-4 text-center text-ink-2">
      Nothing has been deleted.
    </p>
    <ul v-else class="m-0 flex list-none flex-col gap-2 p-0">
      <li
        v-for="e in entries"
        :key="e.stamp"
        class="flex items-center gap-3 rounded-control border border-line p-3"
      >
        <div class="min-w-0 flex-1">
          <p class="m-0 truncate font-medium text-ink">{{ e.label }}</p>
          <p class="m-0 text-xs text-ink-3">{{ describeEntry(e) }} · {{ when(e.deletedAt) }}</p>
        </div>
        <Button
          :disabled="!!busy || !!ws.view?.readOnly"
          :loading="busy === e.stamp"
          :aria-label="`Put back ${e.label}`"
          @click="restore(e.stamp)"
          >Put back</Button
        >
      </li>
    </ul>
    <p v-if="error" role="alert" class="m-0 mt-2 text-xs font-medium text-danger">{{ error }}</p>
  </Dialog>
</template>
