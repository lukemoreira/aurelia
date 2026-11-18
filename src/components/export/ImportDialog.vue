<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import { useImportDialog, type ImportInto } from '@/composables/useImportDialog'
import { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, mb } from '@/import/limits'
import type { ImportPlan } from '@/import/plan'
import ImportReport from './ImportReport.vue'

const props = defineProps<{
  /** A new book in the open workspace, or (the Welcome screen) a new workspace that holds it. */
  into: 'workspace' | 'new'
  make?: (plan: ImportPlan, title: string) => Promise<void>
}>()
const open = defineModel<boolean>('open', { default: false })
const target = (): ImportInto =>
  props.into === 'new' && props.make ? { kind: 'new', make: props.make } : { kind: 'workspace' }
const x = useImportDialog(open, target)

const files = ref<HTMLInputElement | null>(null)
const folder = ref<HTMLInputElement | null>(null)
const body = ref<HTMLElement | null>(null)
/** A phone's file picker has no folders: there the button is not offered. */
const canFolder =
  'webkitdirectory' in document.createElement('input') &&
  !window.matchMedia?.('(pointer: coarse)').matches
/** Chosen files, then the input is emptied, so the same files can be chosen again. */
function chosen(event: Event, from: 'files' | 'folder') {
  const input = event.target as HTMLInputElement
  const list = Array.from(input.files ?? [])
  input.value = ''
  void x.pick(list, from)
}

// Focus follows the step: the name when there is something to look at, the first button when starting over.
watch(
  () => x.step.value,
  async (step, before) => {
    await nextTick()
    if (step === 'preview') body.value?.querySelector('input')?.focus()
    else if (step === 'pick' && before === 'preview')
      body.value?.querySelector<HTMLElement>('button')?.focus()
  },
)

const LIMITS = `Up to ${MAX_FILES.toLocaleString('en')} files, ${mb(MAX_TOTAL_BYTES)} in all, ${mb(MAX_FILE_BYTES)} each.`
const making = computed(() => x.step.value === 'making')
const description = computed(() =>
  props.into === 'new'
    ? 'This makes a new workspace in this browser, with the book in it. Nothing you have is changed.'
    : `This makes a new book${x.where.value}. Nothing you have is changed.`,
)
</script>

<template>
  <Dialog
    v-model:open="open"
    size="md"
    title="Import a book"
    :description="description"
    :locked="making"
  >
    <div ref="body">
      <div v-if="x.step.value === 'pick' || x.step.value === 'reading'" class="flex flex-col gap-3">
        <p class="m-0">
          Aurelia reads Markdown files or a zip of them, and a Twine story: a Twee file, or the HTML
          Twine publishes. Each folder becomes a chapter and each file a scene. Word files are not
          read yet.
        </p>
        <div class="flex flex-wrap gap-2">
          <Button
            :loading="x.step.value === 'reading' && x.via.value === 'files'"
            :disabled="x.step.value === 'reading'"
            @click="files?.click()"
            >Choose files…</Button
          >
          <Button
            v-if="canFolder"
            :loading="x.step.value === 'reading' && x.via.value === 'folder'"
            :disabled="x.step.value === 'reading'"
            @click="folder?.click()"
            >Choose a folder…</Button
          >
        </div>
        <!-- Hidden, driven by the buttons: the browser's own pickers. No `accept` filter: a picker can grey
             out a file it should offer (a zip, on the owner's Mac), and the import names any file it cannot read. -->
        <input ref="files" type="file" multiple class="hidden" @change="chosen($event, 'files')" />
        <input
          v-if="canFolder"
          ref="folder"
          type="file"
          webkitdirectory
          class="hidden"
          @change="chosen($event, 'folder')"
        />
        <p class="m-0 text-xs text-ink-3">{{ LIMITS }}</p>
      </div>

      <div v-else-if="x.plan.value && x.stats.value" class="flex flex-col gap-4">
        <Field
          :label="into === 'new' ? 'Name of the book and workspace' : 'Name of the book'"
          :error="x.nameCheck.value.error"
        >
          <Input v-model="x.title.value" autocomplete="off" :disabled="making" />
        </Field>
        <ImportReport :plan="x.plan.value" :stats="x.stats.value" />
      </div>
    </div>

    <p v-if="x.error.value" role="alert" class="m-0 mt-3 text-xs font-medium text-danger">
      {{ x.error.value }}
    </p>

    <template #footer>
      <Button v-if="x.step.value === 'preview' || making" :disabled="making" @click="x.back()"
        >Back</Button
      >
      <Button :disabled="making" @click="open = false">Cancel</Button>
      <Button
        v-if="x.step.value === 'preview' || making"
        variant="primary"
        :loading="making"
        :disabled="!x.nameCheck.value.ok"
        @click="x.make()"
        >{{ into === 'new' ? 'Make the workspace' : 'Make the book' }}</Button
      >
    </template>
  </Dialog>
</template>
