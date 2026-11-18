<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import WordDiff from '@/components/history/WordDiff.vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Textarea from '@/components/ui/Textarea.vue'
import type { Proposal } from '@/domain/proposals'
import { diffsOf, targetOf } from './proposal-view'

/**
 * One suggestion: what it changes (removed words crossed out, added words underlined), why, and the
 * author's three answers. It never changes anything itself: Accept, Reject and Ask for changes are
 * emitted, and the Review inbox's code does the work, the same wherever the card is shown.
 */
const props = defineProps<{
  proposal: Proposal
  outOfDate: boolean
  /** Another suggestion (or this one) is being worked on. */
  busy: boolean
  /** Shown inside the text on the writing page (else in the Review inbox). */
  inText?: boolean
}>()
const emit = defineEmits<{ accept: []; reject: []; ask: [note: string] }>()
const id = useId()
const asking = ref(false)
const note = ref('')
const noteBox = ref<{ $el: HTMLTextAreaElement }>()

const target = computed(() => targetOf(props.proposal))
const diffs = computed(() => diffsOf(props.proposal))

async function openAsk() {
  asking.value = true
  await nextTick()
  noteBox.value?.$el.focus()
}
function sendAsk() {
  emit('ask', note.value)
  asking.value = false
  note.value = ''
}
</script>

<template>
  <article
    :aria-labelledby="`${id}-title`"
    :data-proposal="proposal.id"
    :class="[
      'relative flex flex-col gap-2 rounded-lg border bg-surface p-3 text-ink shadow-sm',
      outOfDate ? 'border-warn' : inText ? 'border-gold' : 'border-line',
    ]"
  >
    <header class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        class="inline-flex items-center gap-1 rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-semibold text-gold-ink"
        ><Icon name="spark" :size="12" />Suggested by the assistant</span
      >
      <h3 :id="`${id}-title`" class="m-0 min-w-0 truncate text-[12.5px] font-semibold">
        {{ target }}
      </h3>
    </header>
    <p v-if="proposal.why" class="m-0 text-[12.5px] text-ink-2">{{ proposal.why }}</p>
    <div class="relative flex max-h-80 flex-col gap-2 overflow-y-auto">
      <div v-for="(d, i) in diffs" :key="i" class="flex flex-col gap-0.5">
        <h4 v-if="d.label" class="m-0 text-[11px] font-semibold text-ink-3">{{ d.label }}</h4>
        <WordDiff :parts="d.parts" />
      </div>
    </div>
    <p v-if="outOfDate" class="m-0 text-[12.5px] font-medium text-warn" role="note">
      Out of date: the text changed after this was suggested. Ask again, or reject it.
    </p>
    <div role="toolbar" :aria-label="`Suggestion: ${target}`" class="flex flex-wrap gap-1.5">
      <Button v-if="!outOfDate" size="sm" variant="primary" :disabled="busy" @click="emit('accept')"
        ><Icon name="check" :size="14" />Accept</Button
      >
      <Button size="sm" :disabled="busy" @click="emit('reject')"
        ><Icon name="close" :size="14" />Reject</Button
      >
      <Button size="sm" variant="quiet" :disabled="busy" :aria-expanded="asking" @click="openAsk"
        ><Icon name="callout" :size="14" />{{ outOfDate ? 'Ask again' : 'Ask for changes' }}</Button
      >
    </div>
    <form v-if="asking" class="flex flex-col gap-2" @submit.prevent="sendAsk">
      <Field label="What should change?">
        <Textarea ref="noteBox" v-model="note" rows="2" @keydown.esc="asking = false" />
      </Field>
      <div class="flex gap-1.5">
        <Button size="sm" variant="primary" type="submit" :disabled="busy">Send</Button>
        <Button size="sm" variant="quiet" @click="asking = false">Cancel</Button>
      </div>
    </form>
  </article>
</template>
