<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { useHeldDrafts } from '@/composables/useHeldDrafts'
import { useProposals } from '@/composables/useProposals'
import type { SuggestionTarget } from '@/editor/suggestions'
import ProposalCard from './ProposalCard.vue'
import { targetOf } from './proposal-view'

/**
 * The suggestions of one button on the writing page, in a popup: each the Review inbox's card, with the
 * inbox's actions, scrolled to the paragraph whose button was used; one above the other when several
 * suggestions change the paragraph. Accepting or dismissing one leaves the others; the popup closes when
 * none is left. Text the author edited is never lost silently: closing asks first, and a suggestion that
 * goes meanwhile stays on screen with their text until they let it go.
 */
const props = defineProps<{ target: SuggestionTarget | null }>()
const emit = defineEmits<{ close: []; refocus: [target: SuggestionTarget] }>()
const p = useProposals()
const drafts = useHeldDrafts(p.all)
/** Ones the author asked the assistant to revise: done with here, though the proposal may still be listed. */
const asked = reactive(new Set<string>())
/** The cards that hold the author's unsaved text. */
const dirty = reactive(new Set<string>())
const cards = computed(() =>
  (props.target?.hits ?? []).flatMap((hit, i) => {
    const proposal =
      p.all.value.find((x) => x.id === hit.id) ?? drafts.held.value.find((x) => x.id === hit.id)
    return proposal && !asked.has(hit.id) ? [{ hit, proposal, n: i + 1 }] : []
  }),
)
/** Edited text on a card still shown (an accepted one's is no longer at risk). */
const unsaved = computed(() => cards.value.some((c) => dirty.has(c.proposal.id)))
const confirming = ref(false)
const keep = ref<InstanceType<typeof Button>>()
/** The target last shown: focus goes back to its paragraph once the popup is closed. */
let last: SuggestionTarget | null = null
watch(
  () => props.target,
  (t) => {
    if (t) last = t
    confirming.value = false
    dirty.clear()
    asked.clear()
  },
  { immediate: true },
)

const open = computed({
  get: () => !!cards.value.length,
  set: async (v) => {
    if (v) return
    if (!unsaved.value) return emit('close')
    confirming.value = true
    await nextTick()
    keep.value?.$el.focus()
  },
})
// Accepted, dismissed or replaced meanwhile, with no edited text to keep: nothing left to show.
watch(
  () => cards.value.length,
  (n) => !n && props.target && emit('close'),
)

function setDirty(id: string, on: boolean) {
  if (on) dirty.add(id)
  else dirty.delete(id)
  drafts.setDirty(id, on)
}
function discardAll() {
  for (const id of [...dirty]) setDirty(id, false)
  emit('close')
}
function ask(proposal: Parameters<typeof p.askChanges>[0], note: string) {
  void p.askChanges(proposal, note)
  asked.add(proposal.id)
  setDirty(proposal.id, false)
}
const heading = (n: number) => `Suggestion ${n} of ${props.target?.hits.length}`
</script>

<template>
  <Dialog
    v-model:open="open"
    size="lg"
    :title="
      props.target && props.target.hits.length > 1
        ? `Suggestions for this ${props.target.pos === null ? 'scene' : 'paragraph'}`
        : cards[0]
          ? `Suggestion for “${targetOf(cards[0].proposal)}”`
          : 'Suggestion'
    "
    :locked="!!p.working.value"
    :fallback-focus="() => last && emit('refocus', last)"
  >
    <section
      v-for="(c, i) in cards"
      :key="c.proposal.id"
      :class="['pb-2 font-sans', i ? 'border-t border-line pt-3' : '']"
    >
      <h3
        v-if="(target?.hits.length ?? 0) > 1"
        class="m-0 mb-1 text-[12px] font-semibold text-ink-3"
      >
        {{ heading(c.n) }}
      </h3>
      <ProposalCard
        plain
        :proposal="c.proposal"
        :out-of-date="p.outOfDate.value.has(c.proposal.id)"
        :busy="!!p.working.value"
        :gone="drafts.isGone(c.proposal.id)"
        :focus-change="c.hit.change"
        @dirty="(on) => setDirty(c.proposal.id, on)"
        @discard="setDirty(c.proposal.id, false)"
        @accept="(edited) => drafts.decide(c.proposal.id, () => p.accept(c.proposal, edited))"
        @reject="drafts.decide(c.proposal.id, () => p.reject(c.proposal))"
        @ask="(note) => ask(c.proposal, note)"
      />
    </section>
    <div
      v-if="confirming"
      role="alert"
      class="flex flex-wrap items-center gap-2 border-t border-line pb-2 pt-3 font-sans"
    >
      <p class="m-0 mr-auto text-[13px] font-medium text-ink">Discard your edited text?</p>
      <Button size="sm" @click="discardAll">Discard</Button>
      <Button ref="keep" size="sm" variant="primary" @click="confirming = false"
        >Keep editing</Button
      >
    </div>
  </Dialog>
</template>
