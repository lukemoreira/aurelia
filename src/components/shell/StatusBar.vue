<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import Popover from '@/components/ui/Popover.vue'
import StorageDetails from '@/components/workspace/StorageDetails.vue'
import { backupNeedsAttention, backupWords } from '@/backup/words'
import { useOpenDialogFromMenu } from '@/composables/useOpenDialogFromMenu'
import { needsAttention } from '@/storage/status'
import { useBackupStore } from '@/stores/backup'
import { useWorkspaceStore } from '@/stores/workspace'

const ws = useWorkspaceStore()
const backup = useBackupStore()
const detailsOpen = ref(false)
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
// The only copy is in this browser, and a server is there to hold another: say so, in warn (StatusBar board, backup=none).
const nudge = computed(
  () => ws.view?.kind === 'browser' && !backup.view?.enabled && backup.serverState === 'available',
)
// Where the work is kept: the backup's words once there is one, else where the files are.
const kept = computed(
  () =>
    backupWords(backup.view, backup.now) ??
    (nudge.value
      ? 'Only in this browser — turn on backup'
      : ws.view?.kind === 'browser'
        ? 'Only in this browser'
        : 'In a folder'),
)
const keptWarns = computed(() => backupNeedsAttention(backup.view))
// Said aloud: only what the author must act on, saving or backup alike.
const announced = computed(() =>
  [attention.value ? ws.saveLabel : '', keptWarns.value ? kept.value : '']
    .filter(Boolean)
    .join('. '),
)
const detailsTrigger = ref<HTMLElement | null>(null)
const openFromDetails = useOpenDialogFromMenu(detailsOpen, detailsTrigger)
const openRename = () => openFromDetails('renameOpen')
const openBackup = () => openFromDetails('backupOpen')
// While it nudges, the chip goes straight to the Backup screen; otherwise it opens the storage details.
const popoverOpen = computed({
  get: () => detailsOpen.value,
  set: (open) => (nudge.value && open ? openBackup() : (detailsOpen.value = open)),
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
    <span
      ><b class="font-medium text-ink-2">{{ fmt(ws.words.session) }}</b> this session</span
    >
    <span class="flex-1" />
    <span v-if="where">{{ where }}</span>
    <!-- Always in the page, so a change of its text is read out. Only what needs the author's eye is put in it. -->
    <span v-if="ws.view" role="status" class="sr-only">{{ announced }}</span>
    <span v-if="ws.view" :class="['flex items-center gap-1.5', saveClass]">
      <Icon v-if="ws.saveLabel === 'Saved'" name="check" :size="13" class="text-ok" />{{
        ws.saveLabel
      }}
    </span>
    <span v-else>{{ ws.saveState }}</span>
    <Popover v-if="ws.view" v-model:open="popoverOpen">
      <template #trigger>
        <button
          ref="detailsTrigger"
          type="button"
          :class="[
            'flex h-[22px] items-center gap-1.5 rounded-[5px] px-1.5 text-xs hover:bg-raised hover:text-ink pointer-coarse:h-11',
            nudge
              ? 'bg-warn-soft font-semibold text-warn'
              : keptWarns
                ? 'font-semibold text-warn'
                : 'text-ink-3',
          ]"
        >
          <Icon
            :name="ws.view.kind === 'browser' || backup.view?.enabled ? 'cloud' : 'folder'"
            :size="13"
          />{{ kept }}
        </button>
      </template>
      <StorageDetails @backup="openBackup" @rename="openRename" />
    </Popover>
  </footer>
</template>
