<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import { reasonWords } from '@/backup/layout'
import { sizeWords, versionWhen } from '@/backup/words'
import type { useBackupScreen } from '@/composables/useBackupScreen'
import { useBackupStore } from '@/stores/backup'

defineProps<{ screen: ReturnType<typeof useBackupScreen> }>()
const backup = useBackupStore()
</script>

<template>
  <section aria-labelledby="bk-versions" class="flex flex-col gap-2">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3">
      <h3
        id="bk-versions"
        class="m-0 text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3"
      >
        Versions
      </h3>
      <span class="text-xs text-ink-3"
        >Hourly for 2 days · daily for 30 days · weekly for 6 months · then monthly<template
          v-if="backup.space !== null"
        >
          · {{ sizeWords(backup.space) }} used</template
        ></span
      >
    </div>
    <p
      v-if="!screen.view?.folder"
      class="m-0 rounded-card border border-line px-3.5 py-3 text-ink-2"
    >
      Turn backup on and versions appear here: a copy of the whole workspace every hour you write,
      and before a big change.
    </p>
    <ol v-else class="m-0 list-none overflow-hidden rounded-card border border-line p-0">
      <li class="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-1.5">
        <span class="w-36 font-medium">Latest backup</span>
        <span class="min-w-40 flex-1 text-[12.5px] text-ink-2">The newest copy of every file</span>
        <Button size="sm" variant="quiet" @click="screen.restoreVersion()"
          >Restore this version</Button
        >
      </li>
      <li
        v-for="v in backup.versions"
        :key="v.name"
        class="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3.5 py-1.5"
      >
        <span class="w-36 font-medium">{{ versionWhen(v.at, backup.now) }}</span>
        <span class="min-w-40 flex-1 text-[12.5px] text-ink-2"
          >{{ reasonWords(v.reason) }} · {{ sizeWords(v.size) }}</span
        >
        <Button size="sm" variant="quiet" @click="screen.restoreVersion(v)"
          >Restore this version</Button
        >
        <Button
          size="sm"
          variant="quiet"
          :loading="screen.busy === `dl:${v.name}`"
          @click="screen.download(v)"
          >Download</Button
        >
      </li>
    </ol>
    <p v-if="backup.error" role="alert" class="m-0 text-xs font-medium text-danger">
      {{ backup.error }}
    </p>
    <span class="text-xs text-ink-3"
      >Restoring never deletes: it makes a new copy and leaves what you have open as it is.</span
    >
  </section>
</template>
