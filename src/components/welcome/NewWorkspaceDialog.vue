<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import { checkWorkspaceName } from '@/storage/create'

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

const checked = computed(() => checkWorkspaceName(name.value))
const error = computed(() => checked.value.error)
const submit = () => checked.value.ok && !props.busy && emit('create', checked.value.name)
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
        :disabled="!checked.ok"
        >Create workspace</Button
      >
    </template>
  </Dialog>
</template>
