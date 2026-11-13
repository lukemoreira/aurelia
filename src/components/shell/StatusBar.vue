<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import Popover from '@/components/ui/Popover.vue'
import StorageDetails from '@/components/workspace/StorageDetails.vue'
import { needsAttention } from '@/storage/status'
import { useWorkspaceStore } from '@/stores/workspace'

const ws = useWorkspaceStore()
const fmt = (n: number) => n.toLocaleString('en-US')
const where = computed(() => {
  const ctx = ws.context
  return ctx ? `Ch. ${ctx.chapter.number} · Scene ${ctx.index} of ${ctx.chapter.scenes.length}` : ''
})
// Routine progress is silent; anything the author should act on is announced.
const attention = computed(() => !!ws.view && needsAttention(ws.view))
const saveClass = computed(() => {
  if (ws.view?.save.kind === 'failed') return 'font-semibold text-danger'
  return attention.value ? 'font-semibold text-warn' : ''
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
    <!-- Always in the page, so a change of its text is read out. Only what needs the author's eye is put in it. -->
    <span v-if="ws.view" role="status" class="sr-only">{{ attention ? ws.saveLabel : '' }}</span>
    <span v-if="ws.view" :class="['flex items-center gap-1.5', saveClass]">
      <Icon v-if="ws.saveLabel === 'Saved'" name="check" :size="13" class="text-ok" />{{
        ws.saveLabel
      }}
    </span>
    <span v-else>{{ ws.saveState }}</span>
    <Popover v-if="ws.view">
      <template #trigger>
        <button
          type="button"
          class="flex h-[22px] items-center gap-1.5 rounded-[5px] px-1.5 text-xs text-ink-3 hover:bg-raised hover:text-ink pointer-coarse:h-11"
        >
          <Icon :name="ws.view.kind === 'browser' ? 'cloud' : 'folder'" :size="13" />{{
            ws.view.kind === 'browser' ? 'Only in this browser' : 'In a folder'
          }}
        </button>
      </template>
      <StorageDetails />
    </Popover>
  </footer>
</template>
