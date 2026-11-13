<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { useAppUpdate } from '@/composables/useAppUpdate'
import { INSECURE_REASON, NO_STORAGE_REASON, insecurePage } from '@/composables/useOpenWorkspace'
import type { useRestore } from '@/composables/useRestore'
import { reasonWords } from '@/backup/layout'
import { agoWords, sizeWords, versionWhen } from '@/backup/words'

const props = defineProps<{ restore: ReturnType<typeof useRestore> }>()
// The dialog's own state lives in the composable the caller made: this is that same object.
const r = props.restore
const { signIn } = useAppUpdate()

// Each step's heading takes focus when the step changes: the button that was pressed is gone.
const body = ref<HTMLElement>()
watch(
  () => r.step,
  async () => {
    await nextTick()
    body.value?.querySelector<HTMLElement>('[data-step-focus]')?.focus()
  },
)
const landing = 'outline-none'

const nowMs = () => Date.now()
const ago = (iso: string) => agoWords(Date.parse(iso), nowMs())
const when = (at: Date) => versionWhen(at, nowMs())

const PROBLEM = {
  missing: 'is missing from your server',
  changed: 'does not match what was backed up',
  unreadable: 'is not text Aurelia can read',
} as const

const DESCRIPTION = {
  workspaces: 'Choose a workspace backed up on your server.',
  versions: 'Choose the newest copy, or an earlier version.',
  destination: 'This always makes a new copy. A workspace that is open is not touched.',
  problems: 'Aurelia checks every file against the backup’s record before anything opens.',
  'sign-in': 'Your server needs you to sign in again.',
} as const

const row =
  'flex w-full flex-col gap-0.5 rounded-control border border-line bg-surface px-3.5 py-2.5 text-left hover:bg-raised pointer-coarse:min-h-11'
</script>

<template>
  <Dialog
    v-model:open="r.open"
    size="md"
    title="Restore from a backup"
    :description="DESCRIPTION[r.step]"
  >
    <div ref="body" class="flex flex-col gap-3">
      <template v-if="r.step === 'workspaces'">
        <h3
          data-step-focus
          tabindex="-1"
          :class="[landing, 'm-0 text-[11px] font-semibold uppercase tracking-[.1em] text-ink-3']"
        >
          Backups on your server
        </h3>
        <p v-if="r.loading" role="status" class="m-0 text-ink-2">Looking on your server…</p>
        <p v-else-if="!r.listings.length && !r.error" class="m-0 text-ink-2">
          There are no backups on your server yet. Turn backup on in a workspace first.
        </p>
        <ul v-else class="m-0 flex list-none flex-col gap-2 p-0">
          <li v-for="l in r.listings" :key="l.folder">
            <button type="button" :class="row" @click="r.pick(l)">
              <span class="text-sm font-semibold text-ink">{{ l.name }}</span>
              <span class="text-[12.5px] text-ink-2">
                Backed up {{ ago(l.lastBackup) }} from {{ l.deviceName }} · {{ l.files }} files ·
                {{ sizeWords(l.size) }}
              </span>
            </button>
          </li>
        </ul>
      </template>

      <template v-else-if="r.step === 'versions'">
        <h3
          data-step-focus
          tabindex="-1"
          :class="[landing, 'm-0 text-[11px] font-semibold uppercase tracking-[.1em] text-ink-3']"
        >
          {{ r.picked?.name }}
        </h3>
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          <li>
            <button type="button" :class="row" @click="r.chooseVersion('current')">
              <span class="text-sm font-semibold text-ink">Latest backup</span>
              <span class="text-[12.5px] text-ink-2">The newest copy of every file.</span>
            </button>
          </li>
          <li v-for="v in r.versions" :key="v.name">
            <button type="button" :class="row" @click="r.chooseVersion(v.name)">
              <span class="text-sm font-semibold text-ink">{{ when(v.at) }}</span>
              <span class="text-[12.5px] text-ink-2"
                >{{ reasonWords(v.reason) }} · {{ sizeWords(v.size) }}</span
              >
            </button>
          </li>
        </ul>
      </template>

      <template v-else-if="r.step === 'destination'">
        <h3 data-step-focus tabindex="-1" :class="[landing, 'm-0 text-sm font-semibold']">
          Where should “{{ r.picked?.name }}” go?
        </h3>
        <!-- Busy is said, not disabled: a disabled button would drop the focus that is on it. -->
        <button
          type="button"
          :class="row"
          :disabled="!r.canKeepInBrowser"
          :aria-busy="r.busy"
          :aria-describedby="r.canKeepInBrowser ? undefined : 'restore-why-not'"
          @click="r.restore('browser')"
        >
          <span class="text-sm font-semibold text-ink">Keep it in this browser</span>
          <span class="text-[12.5px] text-ink-2">Nothing to set up. Works offline.</span>
        </button>
        <p v-if="!r.canKeepInBrowser" id="restore-why-not" class="m-0 text-[12.5px] text-ink-2">
          {{ insecurePage() ? INSECURE_REASON : NO_STORAGE_REASON }}
        </p>
        <button
          type="button"
          :class="row"
          :disabled="!r.canPickFolder"
          :aria-busy="r.busy"
          @click="r.restore('folder')"
        >
          <span class="text-sm font-semibold text-ink">Choose an empty folder</span>
          <span class="text-[12.5px] text-ink-2">{{
            r.canPickFolder ? 'Chrome and Edge.' : 'Needs Chrome or Edge.'
          }}</span>
        </button>
        <p v-if="r.busy" role="status" class="m-0 text-ink-2">Restoring and checking every file…</p>
      </template>

      <template v-else-if="r.step === 'problems'">
        <p data-step-focus tabindex="-1" :class="[landing, 'm-0 font-semibold']">
          The backup did not pass the check, so nothing was opened.
        </p>
        <ul class="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-ink-2">
          <li v-for="p in r.problems" :key="p.path">
            <code class="rounded-[4px] bg-raised px-1 py-px text-ink">{{ p.path }}</code>
            {{ PROBLEM[p.kind] }}
          </li>
        </ul>
        <p class="m-0 text-ink-2">Try an earlier version, or look at the files on your server.</p>
      </template>

      <template v-else>
        <Button data-step-focus variant="primary" @click="signIn()">Sign in again</Button>
      </template>

      <p v-if="r.error" role="alert" class="m-0 text-xs font-medium text-danger">
        {{ r.error }}
      </p>
    </div>
    <template
      v-if="r.step === 'versions' || r.step === 'destination' || r.step === 'problems'"
      #footer
    >
      <Button variant="quiet" :disabled="r.busy" @click="r.back()">Back</Button>
    </template>
  </Dialog>
</template>
