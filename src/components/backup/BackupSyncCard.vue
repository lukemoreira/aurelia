<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Switch from '@/components/ui/Switch.vue'
import { twoVersionsSentence } from '@/backup/words'
import type { useBackupScreen } from '@/composables/useBackupScreen'
import { TONE } from './tone'

defineProps<{ screen: ReturnType<typeof useBackupScreen> }>()
</script>

<template>
  <section aria-labelledby="bk-sync" class="flex flex-col gap-2">
    <h3 id="bk-sync" class="m-0 text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3">
      Keep in sync across devices
    </h3>
    <div
      :class="[
        'flex flex-col gap-3 rounded-card px-3.5 py-3',
        // Gold is a border and nothing more, as on the server card.
        screen.syncing && screen.view?.status !== 'ask'
          ? 'border-2 border-gold-ink bg-surface'
          : 'border border-line bg-surface',
      ]"
    >
      <div class="flex flex-col gap-0.5">
        <span class="flex items-center gap-2">
          <span class="font-semibold">Sync through your server</span>
          <span
            :class="[
              'rounded-[5px] px-1.5 py-px text-[11px] font-semibold',
              TONE[screen.syncTag.tone],
            ]"
            >{{ screen.syncTag.label }}</span
          >
        </span>
        <span v-if="screen.syncText" class="text-[12.5px] text-ink-2">{{ screen.syncText }}</span>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Switch
          :model-value="screen.syncing"
          label="Keep this workspace in sync on this device"
          :disabled="!screen.canSync || screen.busy === 'sync'"
          @update:model-value="screen.setSync($event)"
        />
        <Button
          v-if="screen.syncing && screen.view?.status !== 'ask'"
          :loading="screen.busy === 'now' || screen.view?.status === 'working'"
          @click="screen.backUpNow()"
          >Sync now</Button
        >
      </div>

      <div
        v-if="screen.syncing && screen.twoVersions"
        class="flex flex-wrap items-center justify-between gap-2 rounded-control border border-warn-line bg-warn-soft px-3 py-2.5"
      >
        <span class="flex flex-col">
          <span class="font-semibold text-ink">{{ twoVersionsSentence(screen.twoVersions) }}</span>
          <span class="text-[12.5px] text-ink-2"
            >Two devices changed the same file. Both versions are kept.</span
          >
        </span>
        <Button @click="screen.reviewVersions()">Review</Button>
      </div>

      <div v-if="screen.syncing && screen.devices.length" class="flex flex-col gap-1">
        <h4 class="m-0 text-xs font-semibold text-ink-2">Devices that sync this workspace</h4>
        <ul class="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-ink-2">
          <li v-for="d in screen.devices" :key="d.id">
            <b class="font-semibold text-ink">{{ d.name }}</b><template v-if="d.self">
              (this device)</template
            >
            · last synced {{ d.when }}
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
