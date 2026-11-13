<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useWorkspaceNotices } from '@/composables/useWorkspaceNotices'
import { useWorkspaceStore } from '@/stores/workspace'
import ConflictDialog from '@/components/workspace/ConflictDialog.vue'
import FilesDialog from '@/components/workspace/FilesDialog.vue'
import Banner from './Banner.vue'

const ws = useWorkspaceStore()
const {
  banners,
  comparing,
  conflict,
  filesOpen,
  busy,
  error,
  synced,
  resolve,
  reconcile,
  keepFile,
} = useWorkspaceNotices()
</script>

<template>
  <!-- One live region that is always there, so a banner that appears is read out. -->
  <div aria-live="polite" :class="['flex flex-col gap-2 px-3.5', banners.length && 'pb-1 pt-3']">
    <Banner
      v-for="b in banners"
      :key="b.id"
      :kind="b.kind"
      :title="b.title"
      :text="b.text"
      :tag="b.tag"
      :action="b.action"
      :dismiss="b.dismiss"
      @action="b.run?.()"
      @dismiss="b.onDismiss?.()"
    />
  </div>
  <ConflictDialog
    :conflict="conflict"
    :busy="busy === 'resolve'"
    :disabled="!!ws.view?.readOnly"
    :error="error"
    :sync="synced"
    :open="!!comparing"
    @update:open="comparing = undefined"
    @choose="resolve"
  />
  <FilesDialog
    v-model:open="filesOpen"
    :view="ws.view"
    :busy="busy"
    :error="error"
    :sync="synced"
    @reconcile="reconcile"
    @keep="keepFile"
  />
</template>
