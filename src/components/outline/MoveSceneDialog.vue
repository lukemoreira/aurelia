<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Field from '@/components/ui/Field.vue'
import Select from '@/components/ui/Select.vue'
import { useMoveScene } from '@/composables/useMoveScene'

const { open, title, choices, target, move } = useMoveScene()
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="title"
    description="It goes to the end of the chapter you pick."
  >
    <form id="move-scene" @submit.prevent="move">
      <Field label="Chapter">
        <Select v-model="target" :options="choices" placeholder="Choose a chapter" />
      </Field>
    </form>
    <template #footer>
      <Button @click="open = false">Cancel</Button>
      <Button variant="primary" type="submit" form="move-scene" :disabled="!target">Move</Button>
    </template>
  </Dialog>
</template>
