<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { useHeldDrafts } from '@/composables/useHeldDrafts'
import { useProposals } from '@/composables/useProposals'
import ProposalCard from './ProposalCard.vue'
import { targetOf } from './proposal-view'

/**
 * A suggestion in a popup, opened from the button on its framed paragraph on the writing page: the
 * Review inbox's card, with the inbox's actions, scrolled to the paragraph whose button was used. Text
 * the author edited is never lost silently: closing asks first, and a suggestion that goes meanwhile
 * stays on screen with their text until they let it go.
 */
type Target = { id: string; change: number; pos: number | null }
const props = defineProps<{ target: Target | null }>()
const emit = defineEmits<{ close: []; refocus: [target: Target] }>()
const p = useProposals()
const drafts = useHeldDrafts(p.all)
const proposal = computed(
  () =>
    p.all.value.find((x) => x.id === props.target?.id) ??
    drafts.held.value.find((x) => x.id === props.target?.id),
)
const gone = computed(() => !!proposal.value && drafts.isGone(proposal.value.id))
const dirty = ref(false)
const confirming = ref(false)
const keep = ref<InstanceType<typeof Button>>()
/** The target last shown: focus goes back to its paragraph once the popup is closed. */
let last: Target | null = null
watch(
  () => props.target,
  (t) => {
    if (t) last = t
    confirming.value = false
    dirty.value = false
  },
  { immediate: true },
)

const open = computed({
  get: () => !!proposal.value,
  set: async (v) => {
    if (v) return
    if (!dirty.value) return emit('close')
    confirming.value = true
    await nextTick()
    keep.value?.$el.focus()
  },
})
// Accepted, dismissed or replaced meanwhile, with no edited text to keep: nothing left to show.
watch(proposal, (now) => !now && props.target && emit('close'))

function setDirty(on: boolean) {
  dirty.value = on
  if (proposal.value) drafts.setDirty(proposal.value.id, on)
}
function discard() {
  setDirty(false)
  emit('close')
}
</script>

<template>
  <Dialog
    v-model:open="open"
    size="lg"
    :title="proposal ? `Suggestion for “${targetOf(proposal)}”` : 'Suggestion'"
    :locked="!!p.working.value"
    :fallback-focus="() => last && emit('refocus', last)"
  >
    <ProposalCard
      v-if="proposal"
      plain
      class="pb-2 font-sans"
      :proposal="proposal"
      :out-of-date="p.outOfDate.value.has(proposal.id)"
      :busy="!!p.working.value"
      :gone="gone"
      :focus-change="target?.change"
      @dirty="setDirty"
      @discard="discard"
      @accept="(edited) => drafts.decide(proposal!.id, () => p.accept(proposal!, edited))"
      @reject="drafts.decide(proposal.id, () => p.reject(proposal!))"
      @ask="
        (note) => {
          void p.askChanges(proposal!, note)
          emit('close')
        }
      "
    />
    <div
      v-if="confirming"
      role="alert"
      class="flex flex-wrap items-center gap-2 border-t border-line pb-2 pt-3 font-sans"
    >
      <p class="m-0 mr-auto text-[13px] font-medium text-ink">Discard your edited text?</p>
      <Button size="sm" @click="discard">Discard</Button>
      <Button ref="keep" size="sm" variant="primary" @click="confirming = false"
        >Keep editing</Button
      >
    </div>
  </Dialog>
</template>
