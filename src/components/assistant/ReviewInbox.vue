<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import { useAppUpdate } from '@/composables/useAppUpdate'
import { useProposals } from '@/composables/useProposals'
import ProposalCard from './ProposalCard.vue'

/** Every suggestion waiting for the author, newest first. No "accept all": each is decided alone. */
const p = useProposals()
const { updateReady, reload } = useAppUpdate()
const unreadableWords = (n: number) =>
  n === 1
    ? '1 suggestion could not be read (a newer Aurelia may have written it, or the file is damaged).'
    : `${n} suggestions could not be read (a newer Aurelia may have written them, or the files are damaged).`
</script>

<template>
  <section aria-labelledby="review-inbox" class="flex flex-col gap-2.5">
    <h3
      id="review-inbox"
      class="m-0 text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3"
    >
      Review inbox
      <span v-if="p.all.value.length" class="text-ink-2">· {{ p.all.value.length }}</span>
    </h3>
    <p class="m-0 text-[12.5px] text-ink-2">
      Suggestions wait here until you decide. Nothing changes until you accept; accepting saves a
      snapshot first, so you can go back.
    </p>
    <ProposalCard
      v-for="item in p.all.value"
      :key="item.id"
      :proposal="item"
      :out-of-date="p.outOfDate.value.has(item.id)"
      :notice="p.noticeFor(item)"
      :busy="!!p.working.value"
      @accept="p.accept(item)"
      @reject="p.reject(item)"
      @ask="(note) => p.askChanges(item, note)"
    />
    <!-- Files that do not read (a newer Aurelia's, damaged ones) are left alone; say they are there. -->
    <p v-if="p.unreadable.value" class="m-0 text-[12.5px] text-ink-2">
      {{ unreadableWords(p.unreadable.value) }}
      <Button v-if="updateReady" size="sm" variant="quiet" @click="reload"
        >Update Aurelia to see them</Button
      >
    </p>
    <p v-else-if="!p.all.value.length" class="m-0 text-[12.5px] text-ink-3">
      No suggestions waiting.
    </p>
  </section>
</template>
