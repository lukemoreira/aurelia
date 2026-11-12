<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import LogoMark from '@/components/shell/LogoMark.vue'
import Icon from '@/components/ui/Icon.vue'
import type { IconName } from '@/domain/ui-names'
import { useWorkspaceStore } from '@/stores/workspace'

const router = useRouter()
const ws = useWorkspaceStore()
const note = ref('')

interface Option {
  id: 'folder' | 'browser' | 'sample'
  title: string
  tag: string
  text: string
  /** Not built yet: shown, but not offered as an action. */
  soon?: boolean
}
const OPTIONS: Option[] = [
  {
    id: 'folder',
    title: 'Choose a folder',
    tag: 'Coming soon',
    soon: true,
    text: 'Markdown files in a folder you pick. Put it inside Dropbox, OneDrive, iCloud or Syncthing and it syncs — no Aurelia account needed. Chrome and Edge.',
  },
  {
    id: 'browser',
    title: 'Keep it in this browser',
    tag: 'Coming soon',
    soon: true,
    text: 'Nothing to set up. Best for Safari and Firefox. Aurelia copies it to your Google Drive, OneDrive or Nextcloud, with versions, so the browser is never the only copy.',
  },
  {
    id: 'sample',
    title: 'Open the sample universe',
    tag: 'Not saved',
    text: 'Explore Saltmarch — a novel, its sequel and a branching game book — plus a standalone history.',
  },
]
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

function choose(option: Option) {
  if (option.soon) {
    note.value = 'Saving is not built yet. For now, open the sample universe to look around.'
    return
  }
  ws.loadSample()
  void router.push(ws.startPath())
}
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
        <li v-for="o in OPTIONS" :key="o.id">
          <!-- A card that is not built yet says so and is aria-disabled: still focusable, so it can explain. -->
          <button
            type="button"
            :aria-disabled="o.soon ? 'true' : undefined"
            :class="[
              'flex w-full flex-col gap-[3px] rounded-card px-[18px] py-4 text-left',
              o.soon
                ? 'cursor-default border border-dashed border-line bg-transparent'
                : 'border-2 border-gold bg-surface shadow-sm hover:border-gold',
            ]"
            @click="choose(o)"
          >
            <span class="flex flex-wrap items-center gap-2">
              <span :class="['text-[15px] font-semibold', o.soon && 'text-ink-2']">{{
                o.title
              }}</span>
              <span
                :class="[
                  'rounded-full px-2 py-px text-[11px] font-semibold',
                  o.soon ? 'bg-raised text-ink-2' : 'bg-gold-soft text-gold-ink',
                ]"
                >{{ o.tag }}</span
              >
            </span>
            <span class="text-[13.5px] text-ink-2">{{ o.text }}</span>
          </button>
        </li>
      </ul>

      <p
        v-if="note"
        role="status"
        class="m-0 max-w-[640px] rounded-control border border-info-line bg-info-soft px-3.5 py-2.5 text-[13px] text-ink"
      >
        {{ note }}
      </p>

      <p class="mt-auto text-xs text-ink-3">
        Free and open source under the AGPL. The license covers the software — everything you write
        is yours.
      </p>
    </main>
  </div>
</template>
