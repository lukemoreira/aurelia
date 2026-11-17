<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import type { BasicField } from '@/domain/record-types'
import type { TextField } from '@/domain/schema/record'

/** The plain-text fields of one tab of a sheet, with the heading that starts each group. Saved as the author leaves a field. */
defineProps<{ fields: BasicField[]; disabled: boolean }>()
const draft = defineModel<Partial<Record<TextField, string>>>({ required: true })
defineEmits<{ save: [key: TextField] }>()
</script>

<template>
  <div class="flex flex-col gap-4">
    <template v-for="f in fields" :key="f.key">
      <h2
        v-if="f.group"
        class="m-0 mt-2 text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 first:mt-0"
      >
        {{ f.group }}
      </h2>
      <Field :label="f.label" :description="f.hint">
        <Textarea
          v-if="f.long"
          v-model="draft[f.key]"
          rows="2"
          :disabled="disabled"
          @change="$emit('save', f.key)"
        />
        <Input
          v-else
          v-model="draft[f.key]"
          :disabled="disabled"
          autocomplete="off"
          @change="$emit('save', f.key)"
        />
      </Field>
    </template>
  </div>
</template>
