<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import { useProposals } from '@/composables/useProposals'
import ProposalCard from './ProposalCard.vue'

/** A suggestion's card inside the text on the writing page: the inbox's card, the inbox's actions. */
const props = defineProps<{ id: string }>()
const p = useProposals()
const proposal = computed(() => p.all.value.find((x) => x.id === props.id))
</script>

<template>
  <ProposalCard
    v-if="proposal"
    in-text
    class="my-3 font-sans"
    :proposal="proposal"
    :out-of-date="p.outOfDate.value.has(proposal.id)"
    :busy="!!p.working.value"
    @accept="p.accept(proposal)"
    @reject="p.reject(proposal)"
    @ask="(note) => p.askChanges(proposal!, note)"
  />
</template>
