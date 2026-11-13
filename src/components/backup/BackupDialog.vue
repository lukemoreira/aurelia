<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Icon from '@/components/ui/Icon.vue'
import { useBackupScreen } from '@/composables/useBackupScreen'
import { useInstallHint } from '@/composables/useInstallHint'
import { backupWords, persistedWords } from '@/backup/words'
import { useBackupStore } from '@/stores/backup'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import BackupServerCard from './BackupServerCard.vue'
import BackupSyncCard from './BackupSyncCard.vue'
import BackupVersions from './BackupVersions.vue'
import RestoreDialog from './RestoreDialog.vue'

const layout = useLayoutStore()
const ws = useWorkspaceStore()
const backup = useBackupStore()
const install = useInstallHint()
const screen = useBackupScreen()

const pill = computed(() => backupWords(backup.view, backup.now))
const inBrowser = computed(() => ws.view?.kind === 'browser')
const kept = computed(() => persistedWords(ws.view?.persisted))
</script>

<template>
  <Dialog
    v-model:open="layout.backupOpen"
    size="lg"
    title="Backup and versions"
    :description="
      inBrowser
        ? 'Your book lives in this browser. A copy on your own server keeps it safe if the browser clears its storage.'
        : `Your book lives in ${ws.view?.label ?? 'a folder'}. A copy on your own server keeps it safe, and versions let you go back.`
    "
  >
    <div v-if="ws.view" class="flex flex-col gap-[18px] pb-1">
      <div v-if="pill" class="flex">
        <span
          :class="[
            'inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold',
            ['paused', 'failed', 'ask', 'offline'].includes(backup.view?.status ?? '')
              ? 'bg-warn-soft text-warn'
              : 'bg-ok-soft text-ok',
          ]"
          ><Icon v-if="backup.view?.status === 'idle'" name="check" :size="13" />{{ pill }}</span
        >
      </div>

      <section aria-labelledby="bk-here" class="flex flex-col gap-2">
        <h3
          id="bk-here"
          class="m-0 text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3"
        >
          {{ inBrowser ? 'In this browser' : 'In a folder' }}
        </h3>
        <div class="flex flex-col gap-3 rounded-card border border-line px-3.5 py-3">
          <template v-if="inBrowser">
            <div class="flex items-start justify-between gap-3">
              <span class="flex flex-col">
                <span class="font-semibold">{{ kept.title }}</span>
                <span class="text-[12.5px] text-ink-2">{{ kept.text }}</span>
              </span>
              <span
                :class="[
                  'shrink-0 rounded-[5px] px-2 py-px text-[11.5px] font-semibold',
                  kept.yes ? 'bg-ok-soft text-ok' : 'bg-raised text-ink-2',
                ]"
                >{{ kept.yes ? 'Yes' : 'No' }}</span
              >
            </div>
            <div
              v-if="install.wanted.value"
              class="flex flex-wrap items-center justify-between gap-3"
            >
              <span class="flex flex-col">
                <span class="font-semibold">Installed as an app</span>
                <span class="text-[12.5px] text-ink-2"
                  >An installed app is cleaned up less often. In Safari: File → Add to Dock.</span
                >
              </span>
              <Button v-if="install.canInstall.value" @click="install.install()">Install</Button>
            </div>
          </template>
          <p v-else class="m-0 text-[12.5px] text-ink-2">
            Your files are in {{ ws.view.label }}, as plain Markdown. A backup copy keeps them safe
            if the folder is lost.
          </p>
        </div>
      </section>

      <BackupServerCard :screen="screen" />
      <BackupSyncCard :screen="screen" />
      <BackupVersions :screen="screen" />
    </div>
    <p v-else class="m-0 text-ink-2">
      Backup works on a workspace of your own. Open or create one first.
    </p>

    <template #footer>
      <Button
        variant="quiet"
        class="mr-auto"
        :loading="screen.copy.busy"
        :disabled="!ws.view"
        @click="screen.copy.download()"
        >Download a backup (.zip)</Button
      >
      <Button @click="layout.backupOpen = false">Close</Button>
    </template>
    <RestoreDialog :restore="screen.restore" />
  </Dialog>
</template>
