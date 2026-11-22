<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, watch } from 'vue'
import Dialog from '@/components/ui/Dialog.vue'
import { useProposals } from '@/composables/useProposals'
import ProposalCard from './ProposalCard.vue'
import { targetOf } from './proposal-view'

/**
 * A suggestion in a popup, opened from the button on its framed paragraph on the writing page: the
 * Review inbox's card, with the inbox's actions, scrolled to the paragraph whose button was used.
 */
const props = defineProps<{ target: { id: string; change: number } | null }>()
const emit = defineEmits<{ close: [] }>()
const p = useProposals()
const proposal = computed(() => p.all.value.find((x) => x.id === props.target?.id))
const open = computed({
  get: () => !!proposal.value,
  set: (v) => !v && emit('close'),
})
// Accepted, dismissed or replaced meanwhile: nothing left to show.
watch(proposal, (now) => !now && props.target && emit('close'))
</script>

<template>
  <Dialog
    v-model:open="open"
    size="lg"
    :title="proposal ? `Suggestion for “${targetOf(proposal)}”` : 'Suggestion'"
    :locked="!!p.working.value"
  >
    <ProposalCard
      v-if="proposal"
      plain
      class="pb-2 font-sans"
      :proposal="proposal"
      :out-of-date="p.outOfDate.value.has(proposal.id)"
      :busy="!!p.working.value"
      :focus-change="target?.change"
      @accept="(edited) => p.accept(proposal!, edited)"
      @reject="p.reject(proposal)"
      @ask="
        (note) => {
          void p.askChanges(proposal!, note)
          emit('close')
        }
      "
    />
  </Dialog>
</template>
