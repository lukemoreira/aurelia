<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Switch from '@/components/ui/Switch.vue'
import type { useBackupScreen } from '@/composables/useBackupScreen'

defineProps<{ screen: ReturnType<typeof useBackupScreen> }>()

const TONE = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  neutral: 'bg-raised text-ink-2',
} as const
</script>

<template>
  <section aria-labelledby="bk-server" class="flex flex-col gap-2">
    <h3 id="bk-server" class="m-0 text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3">
      Copy to your own server
    </h3>
    <div
      :class="[
        'flex flex-col gap-3 rounded-card px-3.5 py-3',
        // Gold is a border and nothing more; a warning box inside it is then the only thing that stands out.
        screen.enabled && screen.view?.status !== 'ask'
          ? 'border-2 border-gold-ink bg-surface'
          : 'border border-line bg-surface',
      ]"
    >
      <div class="flex flex-col gap-0.5">
        <span class="flex items-center gap-2">
          <span class="font-semibold">Your server</span>
          <span
            :class="['rounded-[5px] px-1.5 py-px text-[11px] font-semibold', TONE[screen.tag.tone]]"
            >{{ screen.tag.label }}</span
          >
        </span>
        <span v-if="screen.text" class="text-[12.5px] text-ink-2">{{ screen.text }}</span>
      </div>

      <div
        v-if="screen.view?.status === 'ask' && screen.view.ask"
        class="flex flex-col gap-2 rounded-control border border-warn-line bg-warn-soft px-3 py-2.5"
      >
        <p class="m-0 font-semibold text-ink">Another device backs up this workspace here</p>
        <p class="m-0 text-[12.5px] text-ink-2">
          {{ screen.view.ask.deviceName }} backed it up to this folder. Choose what to do; nothing
          is overwritten either way.
        </p>
        <div class="flex flex-wrap gap-2">
          <Button variant="primary" :loading="screen.busy === 'both'" @click="screen.keepBoth()"
            >Keep both</Button
          >
          <Button :loading="screen.busy === 'use'" @click="screen.useBackupHere()"
            >Use the backup here</Button
          >
        </div>
        <p class="m-0 text-xs text-ink-3">
          <b class="font-semibold text-ink-2">Keep both:</b> this browser backs up to a folder of
          its own. <b class="font-semibold text-ink-2">Use the backup here:</b> your copy is saved
          as a version first, then the backup is restored as a new copy.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Switch
          :model-value="screen.enabled"
          label="Back up to your server"
          :disabled="!screen.canSwitch || screen.busy === 'switch'"
          @update:model-value="screen.setOn($event)"
        />
        <Button
          v-if="screen.enabled && screen.view?.status !== 'ask'"
          :loading="screen.busy === 'now' || screen.view?.status === 'working'"
          @click="screen.backUpNow()"
          >Back up now</Button
        >
        <Button v-if="screen.needsSignIn" variant="primary" @click="screen.signIn()"
          >Sign in again</Button
        >
        <Button
          v-if="screen.view?.status === 'paused' || screen.view?.status === 'failed'"
          @click="screen.tryAgain()"
          >Try again</Button
        >
      </div>
      <p v-if="screen.actionError" role="alert" class="m-0 text-xs font-medium text-danger">
        {{ screen.actionError }}
      </p>
    </div>
    <p class="m-0 text-[12.5px] text-ink-3">
      Google Drive and OneDrive come later. For now a backup goes to your own server only.
    </p>
  </section>
</template>
