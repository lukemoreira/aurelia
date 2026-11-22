<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import WordDiff from '@/components/history/WordDiff.vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Textarea from '@/components/ui/Textarea.vue'
import { authorChanges, type Proposal } from '@/domain/proposals'
import { diffsOf, outOfDateWords, targetOf } from './proposal-view'

/**
 * One suggestion: what it changes (removed words crossed out, added words underlined), why, and the
 * author's answers. It never changes anything itself: Accept, Dismiss and Ask for changes are emitted
 * (for an edit to a scene also Edit, which lets the author change the suggested text first), and the
 * Review inbox's code does the work, the same wherever the card is shown. While the author has edited
 * text not yet accepted it says so (`dirty`); a suggestion that went meanwhile (`gone`) keeps their text
 * on screen, to copy, until they let it go.
 */
const props = defineProps<{
  proposal: Proposal
  outOfDate: boolean
  /** Another suggestion (or this one) is being worked on. */
  busy: boolean
  /** Shown in the popup on the writing page: no frame of its own, and no height limit. */
  plain?: boolean
  /** The change (its number in the proposal) to scroll to and mark: the paragraph whose button was used. */
  focusChange?: number
  /** What else the author should know before deciding (a delete: where it goes, what links to it). */
  notice?: string
  /** It went (a revision replaced it, it was cleared elsewhere) while the author was editing it. */
  gone?: boolean
}>()
/** `accept` carries the author's own text, one per change, when they edited it first. */
const emit = defineEmits<{
  accept: [edited?: string[]]
  reject: []
  ask: [note: string]
  dirty: [on: boolean]
  discard: []
}>()
const id = useId()
const asking = ref(false)
const note = ref('')
const noteBox = ref<{ $el: HTMLTextAreaElement }>()
const root = ref<HTMLElement>()
const editing = ref(false)
/** The author's text for each change of the proposal, in order (only the changed ones are shown). */
const drafts = ref<string[]>([])
const firstDraft = ref<{ $el: HTMLTextAreaElement }[]>([])

const target = computed(() => targetOf(props.proposal))
const diffs = computed(() => diffsOf(props.proposal))
/** Only a suggested edit to a scene can be changed by the author, and not one that is out of date. */
const isEdit = computed(() => props.proposal.kind === 'edit')
const canEdit = computed(() => isEdit.value && !props.outOfDate)
const changes = computed(() => (props.proposal.kind === 'edit' ? props.proposal.changes : []))
const empty = computed(() => editing.value && authorChanges(changes.value, drafts.value) === null)
/** The author changed the suggested text and has not accepted it: closing would lose it. */
const dirty = computed(
  () => editing.value && drafts.value.some((d, i) => d !== changes.value[i]?.after),
)
watch(dirty, (on) => emit('dirty', on))

async function openEdit() {
  drafts.value = changes.value.map((c) => c.after)
  editing.value = true
  await nextTick()
  firstDraft.value[0]?.$el.focus()
}
const approve = () => emit('accept', editing.value ? [...drafts.value] : undefined)

// In the popup: take the paragraph whose button was used into view.
onMounted(async () => {
  await nextTick()
  root.value?.querySelector('[data-focused]')?.scrollIntoView?.({ block: 'nearest' })
})

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
    ref="root"
    :aria-labelledby="`${id}-title`"
    :data-proposal="proposal.id"
    :class="[
      'relative flex flex-col gap-2 text-ink',
      plain ? '' : 'rounded-lg border bg-surface p-3 shadow-sm',
      plain ? '' : outOfDate ? 'border-warn' : 'border-line',
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
    <p v-if="notice" class="m-0 text-[12.5px] text-ink-2">{{ notice }}</p>
    <div :class="['relative flex flex-col gap-2', plain ? '' : 'max-h-80 overflow-y-auto']">
      <div
        v-for="(d, i) in diffs"
        :key="i"
        :data-focused="focusChange !== undefined && d.change === focusChange ? '' : undefined"
        :class="[
          'flex flex-col gap-0.5',
          focusChange !== undefined && d.change === focusChange
            ? 'rounded-md bg-gold-soft p-2 ring-1 ring-gold-line'
            : '',
        ]"
      >
        <h4 v-if="d.label" class="m-0 text-[11px] font-semibold text-ink-3">{{ d.label }}</h4>
        <template v-if="editing && d.change !== undefined">
          <p v-if="changes[d.change]?.before" class="m-0 text-[12.5px] text-ink-2">
            <span class="font-semibold text-ink-3">Now: </span>{{ changes[d.change]?.before }}
          </p>
          <Field :label="`Your text, paragraph ${i + 1}`">
            <Textarea
              :ref="(el) => (firstDraft[i] = el as never)"
              v-model="drafts[d.change]"
              :readonly="gone"
            />
          </Field>
        </template>
        <WordDiff v-else :parts="d.parts" />
      </div>
    </div>
    <p
      v-if="empty && !gone"
      :id="`${id}-empty`"
      class="m-0 text-[12.5px] font-medium text-warn"
      role="note"
    >
      This can't be empty unless the suggestion deletes the paragraph.
    </p>
    <p v-if="gone" class="m-0 text-[12.5px] font-medium text-warn" role="note">
      This suggestion changed while you were editing it, so it can no longer be accepted. Your text
      is kept above: copy what you need.
    </p>
    <p v-else-if="outOfDate" class="m-0 text-[12.5px] font-medium text-warn" role="note">
      {{ outOfDateWords(proposal) }}
    </p>
    <div v-if="gone" class="flex flex-wrap gap-1.5">
      <Button size="sm" @click="emit('discard')"
        ><Icon name="close" :size="14" />Discard my text</Button
      >
    </div>
    <div v-else role="toolbar" :aria-label="`Suggestion: ${target}`" class="flex flex-wrap gap-1.5">
      <Button
        v-if="!outOfDate"
        size="sm"
        variant="primary"
        :disabled="busy || empty"
        :aria-describedby="empty ? `${id}-empty` : undefined"
        @click="approve"
        ><Icon name="check" :size="14" />{{ editing ? 'Accept my text' : 'Accept' }}</Button
      >
      <template v-if="editing">
        <Button size="sm" variant="quiet" :disabled="busy" @click="editing = false">Cancel</Button>
      </template>
      <template v-else>
        <Button v-if="canEdit" size="sm" :disabled="busy" @click="openEdit"
          ><Icon name="write" :size="14" />Edit</Button
        >
        <Button size="sm" :disabled="busy" @click="emit('reject')"
          ><Icon name="close" :size="14" />Dismiss</Button
        >
        <Button size="sm" variant="quiet" :disabled="busy" :aria-expanded="asking" @click="openAsk"
          ><Icon name="callout" :size="14" />{{
            outOfDate ? 'Ask again' : 'Ask for changes'
          }}</Button
        >
      </template>
    </div>
    <form v-if="asking && !editing && !gone" class="flex flex-col gap-2" @submit.prevent="sendAsk">
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
