<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { openedWhen } from '@/composables/useOpenWorkspace'
import type { useDeleteWorkspace } from '@/composables/useDeleteWorkspace'

const props = defineProps<{ del: ReturnType<typeof useDeleteWorkspace> }>()
// The dialog's own state lives in the composable the caller made: this is that same object.
const d = props.del

const name = computed(() => d.target.value?.recent.name ?? '')
const title = computed(() =>
  d.folder.value ? `Remove “${name.value}” from the list?` : `Delete “${name.value}”?`,
)
const plural = (n: number, one: string) => `${n.toLocaleString('en')} ${one}${n === 1 ? '' : 's'}`
const contents = computed(() => {
  const g = d.glance.value
  if (g === undefined) return 'Reading what is in it…'
  const opened = `last opened ${openedWhen(d.target.value?.recent.lastOpened ?? 0)}`
  return g
    ? `${plural(g.books, 'book')} · ${plural(g.words, 'word')} · ${opened}`
    : `Aurelia could not read what is in it, so it cannot show you. It was ${opened}. You can still delete it.`
})
</script>

<template>
  <Dialog v-model:open="d.isOpen.value" :title="title" :locked="d.busy.value">
    <div v-if="d.folder.value" class="flex flex-col gap-3">
      <p class="m-0">
        The folder and the files in it stay on your disk. You can open it again with “Choose a
        folder”.
      </p>
    </div>
    <div v-else class="flex flex-col gap-3">
      <p class="m-0 font-medium">{{ contents }}</p>
      <p class="m-0">
        This removes it from this browser. It cannot be undone, and Aurelia cannot get it back.
      </p>
      <p v-if="d.hasBackup.value" class="m-0 text-ink-2">
        This device backs it up to your server. That copy is kept, and you can bring it back with
        “Restore from a backup” on this screen.
      </p>
      <div class="flex flex-wrap items-center gap-3">
        <Button :loading="d.copying.value" @click="d.download()">Download a copy first</Button>
        <p v-if="d.copied.value" role="status" class="m-0 text-ink-2">
          The copy is in your downloads.
        </p>
      </div>
    </div>
    <p
      v-if="d.failure.value"
      role="alert"
      class="mb-0 mt-3 rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-ink"
    >
      {{ d.failure.value }}
    </p>
    <template #footer>
      <Button :disabled="d.busy.value" @click="d.isOpen.value = false">Cancel</Button>
      <Button
        :variant="d.folder.value ? 'primary' : 'danger'"
        :loading="d.busy.value"
        @click="d.confirm()"
        >{{ d.folder.value ? 'Remove from list' : 'Delete workspace' }}</Button
      >
    </template>
  </Dialog>
</template>
