<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { splitDocument } from '@/storage/frontmatter'
import type { ConflictView } from '@/storage/session'

const props = defineProps<{
  conflict: ConflictView | undefined
  busy: boolean
  disabled?: boolean
  /** The other text came from another device (sync), not from another app. */
  sync?: boolean
  error: string
}>()
defineEmits<{ choose: [choice: 'theirs' | 'mine'] }>()
const open = defineModel<boolean>('open', { default: false })

// Show the writing, not the file: the details at the top are only mentioned when they differ.
const bodyOf = (text: string) => splitDocument(text)?.body ?? text
const headOf = (text: string) => splitDocument(text)?.head
const mine = computed(() => bodyOf(props.conflict?.mine ?? ''))
const theirs = computed(() => bodyOf(props.conflict?.theirs ?? ''))
const detailsDiffer = computed(
  () =>
    props.conflict?.theirs != null && headOf(props.conflict.mine) !== headOf(props.conflict.theirs),
)
const pane =
  'min-h-32 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-control border border-line bg-canvas p-3 font-prose text-[17px] leading-[1.6] text-ink'
</script>

<template>
  <Dialog
    v-model:open="open"
    size="lg"
    :title="`“${conflict?.title ?? ''}” has two versions`"
    :description="`${sync ? 'Another device changed this scene' : 'The file changed outside Aurelia'} while you were writing. Nothing was overwritten. Pick the one to use; the other is saved as a copy next to it.`"
  >
    <div v-if="conflict" class="flex flex-col gap-3">
      <div class="grid gap-3 md:grid-cols-2">
        <section aria-labelledby="mine-title" class="flex flex-col gap-1.5">
          <h3
            id="mine-title"
            class="m-0 text-xs font-semibold uppercase tracking-[.08em] text-ink-3"
          >
            Your version
          </h3>
          <pre :class="pane" tabindex="0" aria-label="Your version, text">{{
            mine || '(empty)'
          }}</pre>
        </section>
        <section aria-labelledby="theirs-title" class="flex flex-col gap-1.5">
          <h3
            id="theirs-title"
            class="m-0 text-xs font-semibold uppercase tracking-[.08em] text-ink-3"
          >
            {{ sync ? 'The other device’s version' : 'The file’s version' }}
          </h3>
          <pre
            :class="pane"
            tabindex="0"
            :aria-label="`${sync ? 'The other device’s version' : 'The file’s version'}, text`"
            >{{ conflict.theirs === null ? '(the file was removed)' : theirs || '(empty)' }}</pre>
        </section>
      </div>
      <p v-if="detailsDiffer" class="m-0 text-xs text-ink-3">
        The details at the top of the scene differ too; they come with the version you choose.
      </p>
      <p v-if="error" role="alert" class="m-0 text-xs font-medium text-danger">{{ error }}</p>
    </div>
    <template #footer>
      <Button
        v-if="conflict?.theirs !== null"
        :disabled="busy || disabled"
        @click="$emit('choose', 'theirs')"
        >{{ sync ? 'Use the other device’s version' : 'Use the file’s version' }}</Button
      >
      <Button
        variant="primary"
        :loading="busy"
        :disabled="disabled"
        @click="$emit('choose', 'mine')"
        >{{ conflict?.theirs === null ? 'Save my version again' : 'Keep mine' }}</Button
      >
    </template>
  </Dialog>
</template>
