<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Button from '@/components/ui/Button.vue'
import { useDownloadCopy } from '@/composables/useDownloadCopy'
import { backupWords, persistedWords } from '@/backup/words'
import { useBackupStore } from '@/stores/backup'
import { useWorkspaceStore } from '@/stores/workspace'

const ws = useWorkspaceStore()
const backup = useBackupStore()
defineEmits<{ backup: [] }>()
const { download, busy, error } = useDownloadCopy()

// A copy on the server changes what "only in this browser" means.
const backedUp = computed(() => backup.view?.enabled && backup.view.lastBackup !== null)
const backupLine = computed(() => backupWords(backup.view, backup.now))

const protection = computed(() => persistedWords(ws.view?.persisted))
</script>

<template>
  <div v-if="ws.view" class="flex flex-col gap-2">
    <p class="m-0 font-semibold">{{ ws.view.name }}</p>
    <p class="m-0 text-ink-2">Kept in {{ ws.view.label }}.</p>
    <p v-if="backupLine" class="m-0 text-ink-2">
      <b class="font-semibold text-ink">{{ backupLine }}.</b>
      {{ backedUp ? 'A copy is on your server.' : '' }}
    </p>
    <template v-if="ws.view.kind === 'browser'">
      <p v-if="!backedUp" class="m-0 text-ink-2">
        <b class="font-semibold text-ink">Only in this browser.</b> The browser holds the only copy,
        and clearing this site’s data would erase it. Back it up to your server, or download a copy
        now and then.
      </p>
      <p class="m-0 text-ink-2">
        <b class="font-semibold text-ink">{{ protection.title }}.</b> {{ protection.text }}
      </p>
    </template>
    <Button variant="primary" @click="$emit('backup')">Backup and versions…</Button>
    <Button :loading="busy" @click="download">Download a copy (.zip)</Button>
    <p v-if="error" role="alert" class="m-0 text-xs font-medium text-danger">{{ error }}</p>
  </div>
  <div v-else class="flex flex-col gap-1">
    <p class="m-0 font-semibold">Sample workspace</p>
    <p class="m-0 text-ink-2">
      This copy lives in memory while the page is open and is not saved. To keep your own writing,
      go back to Welcome and choose a folder or browser storage.
    </p>
  </div>
</template>
