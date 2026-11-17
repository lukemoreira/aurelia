<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Field from '@/components/ui/Field.vue'
import { smallCapsHeading } from '@/components/ui/fieldStyles'
import Input from '@/components/ui/Input.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Select from '@/components/ui/Select.vue'
import Switch from '@/components/ui/Switch.vue'
import { useExportDialog } from '@/composables/useExportDialog'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'

const layout = useLayoutStore()
const ws = useWorkspaceStore()
const x = useExportDialog()

const FORMATS = [
  { value: 'docx', label: 'Word' },
  { value: 'epub', label: 'EPUB' },
  { value: 'pdf', label: 'PDF' },
  { value: 'markdown', label: 'Markdown' },
]
const ABOUT: Record<string, string> = {
  docx: 'A Word document (.docx) with real headings and footnotes.',
  epub: 'An e-book (.epub). Footnotes show as notes a reading app can pop up.',
  pdf: 'Opens a print view. Choose “Save as PDF” in your browser’s print window.',
  markdown:
    'A zip with a folder for each chapter and a file for each scene, in reading order. No layout settings: the files are your text as it is.',
}
const profileOptions = computed(() => x.profiles.value.map((p) => ({ value: p.id, label: p.name })))
const pendingName = computed(
  () => x.profiles.value.find((p) => p.id === x.pendingId.value)?.name ?? '',
)
const layoutOn = computed(() => x.draft.format !== 'markdown')
const typeOn = computed(() => x.draft.format === 'docx' || x.draft.format === 'pdf')
const num = (key: 'fontSize' | 'spacing') => ({
  'model-value': String(x.draft[key]),
  'onUpdate:modelValue': (v: string | undefined) => {
    if (v) x.draft[key] = Number(v)
  },
})
const SEPARATORS = [
  { value: 'stars', label: 'Three stars' },
  { value: 'rule', label: 'A line' },
  { value: 'space', label: 'Blank space' },
]
const HEADINGS = [
  { value: 'title', label: 'Its title' },
  { value: 'numbered', label: 'Chapter 1: its title' },
  { value: 'none', label: 'No heading' },
]
const SIZES = [10, 11, 12, 13, 14].map((n) => ({ value: String(n), label: `${n} pt` }))
const SPACINGS = [
  { value: '1', label: 'Single' },
  { value: '1.15', label: '1.15' },
  { value: '1.5', label: '1.5' },
  { value: '2', label: 'Double' },
]

// Focus stays where the author is working: on the name they are typing, then back on the saved settings.
const profileField = ref<HTMLElement | null>(null)
const nameField = ref<HTMLElement | null>(null)
const focusIn = (el: () => HTMLElement | null, selector: string) =>
  nextTick(() => el()?.querySelector<HTMLElement>(selector)?.focus())
async function act(work: () => Promise<void>) {
  await work()
  await focusIn(() => profileField.value, '[role="combobox"]')
}
function toggleNaming() {
  x.naming.value = !x.naming.value
  if (x.naming.value) void focusIn(() => nameField.value, 'input')
}
</script>

<template>
  <Dialog
    v-model:open="layout.exportOpen"
    size="md"
    title="Export this book"
    :description="`“${ws.book?.title ?? ''}”, in the order of the outline. Your files are not changed.`"
  >
    <form id="export-form" class="flex flex-col gap-4 pb-1" @submit.prevent="x.run()">
      <div class="flex flex-col gap-1.5">
        <span class="text-[13px] font-medium text-ink">Format</span>
        <SegmentedControl v-model="x.draft.format" label="Format" :options="FORMATS" />
        <p class="m-0 text-xs text-ink-3">{{ ABOUT[x.draft.format] }}</p>
        <p v-if="x.unfiled.value" class="m-0 text-xs text-ink-2">
          {{ x.unfiled.value }} unfiled {{ x.unfiled.value === 1 ? 'scene is' : 'scenes are' }} not
          included.
        </p>
      </div>

      <section aria-labelledby="ex-saved" class="flex flex-col gap-2">
        <h3 id="ex-saved" :class="smallCapsHeading">Saved settings</h3>
        <div ref="profileField">
          <Field
            label="Use the settings of"
            description="Settings you can use again, for every book of this workspace."
          >
            <Select
              :model-value="x.selectedId.value"
              :options="profileOptions"
              @update:model-value="(v) => v && x.choose(v)"
            />
          </Field>
        </div>
        <div
          v-if="x.pendingId.value"
          role="alert"
          class="flex flex-col gap-2 rounded-control border border-warn-line bg-warn-soft px-3 py-2.5"
        >
          <span
            >You have changes that are not saved. Switch to “{{ pendingName }}” and drop them?</span
          >
          <span class="flex flex-wrap gap-2">
            <Button size="sm" @click="x.confirmSwitch()">Switch and drop them</Button>
            <Button size="sm" @click="x.keepEditing()">Keep editing</Button>
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            v-if="x.saved.value"
            size="sm"
            :disabled="!x.dirty.value || !x.canSave.value"
            @click="act(x.saveChanges)"
            >Save</Button
          >
          <Button size="sm" :disabled="!x.canSave.value" @click="toggleNaming">Save as new…</Button>
          <Button
            v-if="x.saved.value && !x.confirmingDelete.value"
            size="sm"
            variant="quiet"
            :disabled="!x.canSave.value"
            @click="x.confirmingDelete.value = true"
            >Delete</Button
          >
        </div>
        <div
          v-if="x.confirmingDelete.value"
          role="alert"
          class="flex flex-col gap-2 rounded-control border border-warn-line bg-warn-soft px-3 py-2.5"
        >
          <span>Delete these saved settings? This cannot be undone.</span>
          <span class="flex flex-wrap gap-2">
            <Button size="sm" @click="act(x.remove)">Yes, delete them</Button>
            <Button size="sm" @click="x.confirmingDelete.value = false">No</Button>
          </span>
        </div>
        <p v-if="!x.saved.value && x.dirty.value" class="m-0 text-xs text-ink-3">
          “Standard” is built in. To keep these changes, use “Save as new…”.
        </p>
        <div v-if="x.naming.value" ref="nameField" class="flex items-end gap-2">
          <Field label="Name for these settings" class="flex-1">
            <Input
              v-model="x.newName.value"
              autocomplete="off"
              @keydown.enter.prevent="act(x.saveAs)"
            />
          </Field>
          <Button :disabled="!x.newName.value.trim()" @click="act(x.saveAs)">Save</Button>
        </div>
        <p role="status" aria-live="polite" class="m-0 min-h-4 text-xs font-medium text-ok">
          {{ x.notice.value }}
        </p>
      </section>

      <template v-if="layoutOn">
        <section aria-labelledby="ex-layout" class="flex flex-col gap-3">
          <h3 id="ex-layout" :class="smallCapsHeading">Layout</h3>
          <Switch v-model="x.draft.titlePage" label="A title page" />
          <div v-if="x.draft.titlePage" class="grid gap-3 sm:grid-cols-2">
            <Field label="Subtitle"><Input v-model="x.draft.subtitle" autocomplete="off" /></Field>
            <Field label="Author"><Input v-model="x.draft.author" autocomplete="off" /></Field>
          </div>
          <div class="grid items-start gap-3 sm:grid-cols-2">
            <Field label="Chapter headings">
              <Select v-model="x.draft.chapterTitles" :options="HEADINGS" />
            </Field>
            <Field label="Between scenes">
              <Select v-model="x.draft.separator" :options="SEPARATORS" />
            </Field>
          </div>
          <Switch v-model="x.draft.sceneTitles" label="Show each scene’s title" />
          <Field
            v-if="x.draft.format === 'epub'"
            label="Language"
            :description="
              x.languageError.value
                ? undefined
                : 'The book’s language, for reading apps. A code like en or fr-CA.'
            "
            :error="x.languageError.value"
          >
            <Input v-model="x.draft.language" autocomplete="off" />
          </Field>
        </section>

        <section v-if="typeOn" aria-labelledby="ex-type" class="flex flex-col gap-3">
          <h3 id="ex-type" :class="smallCapsHeading">Page and type</h3>
          <Field label="Page size">
            <Select
              v-model="x.draft.pageSize"
              :options="[
                { value: 'letter', label: 'Letter' },
                { value: 'a4', label: 'A4' },
              ]"
            />
          </Field>
          <Field label="Font">
            <Select
              v-model="x.draft.font"
              :options="[
                { value: 'serif', label: 'Book serif' },
                { value: 'sans', label: 'Sans' },
                { value: 'mono', label: 'Typewriter' },
              ]"
            />
          </Field>
          <div class="grid grid-cols-2 gap-3">
            <Field label="Size"><Select v-bind="num('fontSize')" :options="SIZES" /></Field>
            <Field label="Line spacing"
              ><Select v-bind="num('spacing')" :options="SPACINGS"
            /></Field>
          </div>
        </section>
      </template>

      <p v-if="x.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
        {{ x.error.value }}
      </p>
    </form>
    <template #footer>
      <Button @click="layout.exportOpen = false">Cancel</Button>
      <Button
        variant="primary"
        type="submit"
        form="export-form"
        :loading="x.busy.value"
        :disabled="!!x.languageError.value"
        >{{ x.draft.format === 'pdf' ? 'Open print view' : 'Export' }}</Button
      >
    </template>
  </Dialog>
</template>
