<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import { useRenameWorkspace } from '@/composables/useRenameWorkspace'
import { useLayoutStore } from '@/stores/layout'

const layout = useLayoutStore()
const { name, error, failure, ready, busy, save } = useRenameWorkspace()
const form = ref<HTMLFormElement | null>(null)

/** The name is what the author is here to change: focus it with the text selected. */
function focusName(event: Event) {
  event.preventDefault()
  const input = form.value?.querySelector('input')
  input?.focus()
  input?.select()
}
</script>

<template>
  <Dialog
    v-model:open="layout.renameOpen"
    title="Rename workspace"
    description="Only the name changes. Your folder, your files and your links stay as they are."
    @open-auto-focus="focusName"
  >
    <form id="rename-workspace" ref="form" class="flex flex-col gap-3" @submit.prevent="save">
      <Field label="Name" :error="error || failure">
        <Input v-model="name" autocomplete="off" />
      </Field>
    </form>
    <template #footer>
      <Button @click="layout.renameOpen = false">Cancel</Button>
      <Button
        variant="primary"
        type="submit"
        form="rename-workspace"
        :loading="busy"
        :disabled="!ready"
        >Save</Button
      >
    </template>
  </Dialog>
</template>
