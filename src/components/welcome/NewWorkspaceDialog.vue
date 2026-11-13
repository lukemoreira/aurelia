<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import { MAX_NAME } from '@/storage/create'

const props = defineProps<{ where: 'folder' | 'browser' | null; busy: boolean }>()
const emit = defineEmits<{ create: [name: string]; cancel: [] }>()
const name = ref('')
const form = ref<HTMLFormElement | null>(null)
const open = computed({
  get: () => props.where !== null,
  set: (v) => !v && emit('cancel'),
})
watch(open, (isOpen) => isOpen && (name.value = ''))
/** The name is what the author is here to type: focus it, not the first control Reka finds. */
function focusName(event: Event) {
  event.preventDefault()
  form.value?.querySelector('input')?.focus()
}

const trimmed = computed(() => name.value.trim())
const error = computed(() =>
  trimmed.value.length > MAX_NAME ? `Keep the name under ${MAX_NAME} letters.` : '',
)
const ready = computed(() => trimmed.value.length > 0 && !error.value)
const submit = () => ready.value && !props.busy && emit('create', trimmed.value)
</script>

<template>
  <Dialog
    v-model:open="open"
    title="Name your workspace"
    :description="
      where === 'folder'
        ? 'Aurelia will start it in the empty folder you chose: one book, one chapter and one empty scene.'
        : 'Aurelia will keep it in this browser: one book, one chapter and one empty scene.'
    "
    @open-auto-focus="focusName"
  >
    <form id="new-workspace" ref="form" class="flex flex-col gap-3" @submit.prevent="submit">
      <Field label="Workspace name" :error="error">
        <Input v-model="name" placeholder="My writing" autocomplete="off" />
      </Field>
    </form>
    <template #footer>
      <Button @click="emit('cancel')">Cancel</Button>
      <Button
        variant="primary"
        type="submit"
        form="new-workspace"
        :loading="busy"
        :disabled="!ready"
        >Create workspace</Button
      >
    </template>
  </Dialog>
</template>
