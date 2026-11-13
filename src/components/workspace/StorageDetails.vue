<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Button from '@/components/ui/Button.vue'
import { useDownloadCopy } from '@/composables/useDownloadCopy'
import { useWorkspaceStore } from '@/stores/workspace'

const ws = useWorkspaceStore()
const { download, busy, error } = useDownloadCopy()

// ADR-0009 §1: the browser's answer to "keep this storage", in plain words.
const protection = computed(() => {
  const persisted = ws.view?.persisted
  if (persisted === true) return 'Protected from clean-up'
  if (persisted === false) return 'Not protected — the browser may clear it when the disk runs low'
  return 'Not asked yet — Aurelia asks the browser on your first save'
})
</script>

<template>
  <div v-if="ws.view" class="flex flex-col gap-2">
    <p class="m-0 font-semibold">{{ ws.view.name }}</p>
    <p class="m-0 text-ink-2">Kept in {{ ws.view.label }}.</p>
    <template v-if="ws.view.kind === 'browser'">
      <p class="m-0 text-ink-2">
        <b class="font-semibold text-ink">Only in this browser.</b> The browser holds the only copy,
        and clearing this site’s data would erase it. Download a copy now and then.
      </p>
      <p class="m-0 text-ink-2">{{ protection }}.</p>
    </template>
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
