<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import LogoMark from '@/components/shell/LogoMark.vue'
import Icon from '@/components/ui/Icon.vue'
import NewWorkspaceDialog from '@/components/welcome/NewWorkspaceDialog.vue'
import { openedWhen, useOpenWorkspace } from '@/composables/useOpenWorkspace'
import type { IconName } from '@/domain/ui-names'

const open = useOpenWorkspace()

interface Option {
  id: 'folder' | 'browser' | 'sample'
  title: string
  tag: string
  text: string
  /** The one card with the gold border: where a folder can be picked, that; else the browser. */
  recommended: boolean
  /** Not possible in this browser: shown, but pressing it only explains. */
  unavailable?: boolean
  run: () => void
}
const options = computed<Option[]>(() => {
  const folder = open.canPickFolder
  return [
    {
      id: 'folder',
      title: 'Choose a folder',
      tag: folder ? 'Recommended' : 'Needs Chrome or Edge',
      recommended: folder,
      unavailable: !folder,
      text: `Markdown files in a folder you pick. Put it inside Dropbox, OneDrive, iCloud or Syncthing and it syncs — no Aurelia account needed.${folder ? ' Chrome and Edge.' : ''}`,
      run: open.chooseFolder,
    },
    {
      id: 'browser',
      title: 'Keep it in this browser',
      tag: folder ? 'Only in this browser' : 'Recommended',
      recommended: !folder,
      text: 'Nothing to set up, and it works offline. The browser holds the only copy, so download a copy now and then.',
      run: open.keepInBrowser,
    },
    {
      id: 'sample',
      title: 'Open the sample universe',
      tag: 'Not saved',
      recommended: false,
      text: 'Explore Saltmarch — a novel, its sequel and a branching game book — plus a standalone history.',
      run: open.openSample,
    },
  ]
})
const POINTS: { icon: IconName; lead: string; text: string }[] = [
  {
    icon: 'folder',
    lead: 'Your files, on your disk.',
    text: 'Plain Markdown. Works offline. No account.',
  },
  { icon: 'link', lead: 'Everything linked.', text: 'Rename a character and no link breaks.' },
  {
    icon: 'continuity',
    lead: 'Continuity you can see.',
    text: 'Who knows what, who is where, and what never got paid off.',
  },
]
</script>

<template>
  <div class="flex min-h-dvh flex-wrap bg-canvas text-sm leading-normal text-ink">
    <!-- The brand panel is dark in both themes: it borrows the dark tokens. -->
    <section
      aria-label="About Aurelia"
      data-theme="dark"
      class="box-border flex flex-[1_1_420px] flex-col justify-between gap-3 bg-chrome px-6 py-5 text-ink sm:min-h-[420px] sm:gap-10 sm:px-14 sm:pb-12 sm:pt-14"
    >
      <div class="flex items-center gap-3">
        <LogoMark :size="36" class="max-sm:size-7" />
        <span
          class="font-prose text-[28px] font-medium leading-none tracking-[.01em] max-sm:text-2xl"
          >Aurelia</span
        >
      </div>
      <div class="flex max-w-[460px] flex-col gap-[18px]">
        <p
          class="m-0 font-prose text-lg font-normal italic leading-[1.15] text-gold sm:text-[40px]"
        >
          Write worlds. <br class="max-sm:hidden" />Shape stories.
        </p>
        <p class="m-0 text-[15px] text-ink-2 max-sm:hidden">
          A calm studio for novels, histories and branching stories — with your characters, places
          and lore linked to every scene.
        </p>
      </div>
      <ul class="m-0 flex list-none flex-col gap-3.5 p-0 text-[13.5px] text-ink-2 max-sm:hidden">
        <li v-for="p in POINTS" :key="p.lead" class="flex items-start gap-3">
          <Icon :name="p.icon" :size="18" class="mt-px text-gold" /><span
            ><b class="font-semibold text-ink">{{ p.lead }}</b> {{ p.text }}</span
          >
        </li>
      </ul>
    </section>

    <main
      class="box-border flex flex-[1.25_1_480px] flex-col gap-7 px-6 pb-10 pt-6 sm:px-16 sm:pt-14"
    >
      <div>
        <h1 class="m-0 font-prose text-[32px] font-medium leading-[1.2]">Welcome</h1>
        <p class="mb-0 mt-1.5 text-[15px] text-ink-2">
          Where should your writing live? You can move it later.
        </p>
      </div>

      <ul class="m-0 flex max-w-[640px] list-none flex-col gap-2.5 p-0">
        <li v-for="o in options" :key="o.id">
          <!-- A card that cannot work here says so and is aria-disabled: still focusable, so it can explain. -->
          <button
            type="button"
            :aria-disabled="o.unavailable ? 'true' : undefined"
            :disabled="open.busy.value"
            :class="[
              'flex w-full flex-col gap-[3px] rounded-card px-[18px] py-4 text-left',
              o.recommended && 'border-2 border-gold bg-surface shadow-card',
              !o.recommended && !o.unavailable && 'border border-line bg-surface hover:bg-raised',
              o.unavailable && 'cursor-default border border-dashed border-line bg-transparent',
            ]"
            @click="o.run()"
          >
            <span class="flex flex-wrap items-center gap-2">
              <span :class="['text-[15px] font-semibold', o.unavailable && 'text-ink-2']">{{
                o.title
              }}</span>
              <span
                :class="[
                  'rounded-full px-2 py-px text-[11px] font-semibold',
                  o.recommended ? 'bg-gold-soft text-gold-ink' : 'bg-raised text-ink-2',
                ]"
                >{{ o.tag }}</span
              >
            </span>
            <span class="text-[13.5px] text-ink-2">{{ o.text }}</span>
          </button>
        </li>
      </ul>

      <p
        v-if="open.message.value"
        :role="open.message.value.kind === 'error' ? 'alert' : 'status'"
        :class="[
          'm-0 max-w-[640px] rounded-control border px-3.5 py-2.5 text-[13px] text-ink',
          open.message.value.kind === 'error'
            ? 'border-danger-line bg-danger-soft'
            : 'border-info-line bg-info-soft',
        ]"
      >
        {{ open.message.value.text }}
      </p>

      <section
        v-if="open.rows.value.length"
        aria-labelledby="recent-title"
        class="flex max-w-[640px] flex-col gap-2 border-t border-line pt-5"
      >
        <h2
          id="recent-title"
          class="m-0 mb-1 text-[11px] font-semibold uppercase tracking-[.1em] text-ink-3"
        >
          Recent
        </h2>
        <button
          v-for="row in open.rows.value"
          :key="row.recent.key"
          type="button"
          :disabled="open.busy.value"
          :class="[
            'flex w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left text-ink',
            row.needsAccess
              ? 'border-warn-line bg-warn-soft'
              : 'border-line bg-surface hover:bg-raised',
          ]"
          @click="open.openRecent(row)"
        >
          <span
            aria-hidden="true"
            :class="[
              'flex size-[34px] shrink-0 items-center justify-center rounded-control bg-gold-soft font-prose text-base font-medium text-gold-ink',
              row.needsAccess && '!bg-surface !text-warn',
            ]"
            >{{ row.recent.name.slice(0, 1).toUpperCase() }}</span
          >
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-sm font-semibold">{{ row.recent.name }}</span>
            <span class="text-[12.5px] text-ink-2">
              {{ row.recent.label }} ·
              {{
                row.needsAccess
                  ? 'the browser needs your OK to open this folder again'
                  : `opened ${openedWhen(row.recent.lastOpened)}`
              }}
            </span>
          </span>
          <span class="text-[12.5px] font-medium text-gold-ink">{{
            row.needsAccess ? 'Reconnect folder' : 'Open'
          }}</span>
        </button>
      </section>

      <p class="mt-auto text-xs text-ink-3">
        Free and open source under the AGPL. The license covers the software — everything you write
        is yours.
      </p>
    </main>
    <NewWorkspaceDialog
      :where="open.naming.value"
      :busy="open.busy.value"
      @create="open.createNamed"
      @cancel="open.naming.value = null"
    />
  </div>
</template>
