<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import { useNameDialog } from '@/composables/useNameDialog'

const { ask, open, name, error, failure, ready, busy, save } = useNameDialog()
const form = ref<HTMLFormElement | null>(null)

/** The name is what the author is here to give: focus it, with an old name selected. */
function focusName(event: Event) {
  event.preventDefault()
  const input = form.value?.querySelector('input')
  input?.focus()
  input?.select()
}
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="ask?.title ?? ''"
    :description="ask?.description"
    @open-auto-focus="focusName"
  >
    <form id="name-dialog" ref="form" class="flex flex-col gap-3" @submit.prevent="save">
      <Field label="Name" :error="error || failure">
        <Input v-model="name" autocomplete="off" />
      </Field>
    </form>
    <template #footer>
      <Button @click="open = false">Cancel</Button>
      <Button
        variant="primary"
        type="submit"
        form="name-dialog"
        :loading="busy"
        :disabled="!ready"
        >{{ ask?.confirm ?? 'Save' }}</Button
      >
    </template>
  </Dialog>
</template>
