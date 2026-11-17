<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Field from '@/components/ui/Field.vue'
import Textarea from '@/components/ui/Textarea.vue'
import type { BasicField } from '@/domain/record-types'
import type { Alias, TextField } from '@/domain/schema/record'
import AliasEditor from './AliasEditor.vue'
import FieldList from './FieldList.vue'
import PlaceContext from './PlaceContext.vue'
import RecordNames from './RecordNames.vue'

/** The Overview of a sheet: the type's basic fields, where a place sits, the other names, and how the name is written in the text. */
defineProps<{ id: string; fields: BasicField[]; disabled: boolean; place: boolean }>()
const summary = defineModel<string>('summary', { required: true })
const draft = defineModel<Partial<Record<TextField, string>>>('draft', { required: true })
const aliases = defineModel<Alias[]>('aliases', { required: true })
defineEmits<{
  saveSummary: []
  saveField: [key: TextField]
  saveAliases: []
  addAlias: []
  removeAlias: [i: number]
}>()
</script>

<template>
  <div class="flex flex-col gap-4">
    <Field label="Summary" description="One line that says who or what this is.">
      <Textarea v-model="summary" rows="2" :disabled="disabled" @change="$emit('saveSummary')" />
    </Field>
    <FieldList
      v-model="draft"
      :fields="fields"
      :disabled="disabled"
      @save="$emit('saveField', $event)"
    />
    <PlaceContext v-if="place" :id="id" />
    <AliasEditor
      v-model="aliases"
      :disabled="disabled"
      @save="$emit('saveAliases')"
      @add="$emit('addAlias')"
      @remove="$emit('removeAlias', $event)"
    />
    <RecordNames :id="id" />
  </div>
</template>
