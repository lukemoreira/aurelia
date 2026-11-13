<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Textarea from '@/components/ui/Textarea.vue'
import { useItemDetails, type DetailsKind } from '@/composables/useItemDetails'

/** The editable details of one scene, chapter, part or book. Saved as the author leaves each field. */
const props = defineProps<{ kind: DetailsKind; id: string | undefined; heading?: string }>()
const d = useItemDetails(props.kind, () => props.id)
</script>

<template>
  <form
    v-if="d.item.value"
    class="flex flex-col gap-3"
    :aria-label="heading ?? 'Details'"
    @submit.prevent
  >
    <h3 v-if="heading" class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3">
      {{ heading }}
    </h3>
    <Field label="Title" :error="d.error.value">
      <Input
        v-model="d.draft.title"
        :disabled="d.readOnly.value"
        autocomplete="off"
        @change="d.saveTitle()"
      />
    </Field>
    <Field label="Status">
      <Select v-model="d.status.value" :options="d.statusOptions" :disabled="d.readOnly.value" />
    </Field>
    <Field v-if="kind === 'scene'" label="Point of view">
      <Select v-model="d.pov.value" :options="d.povOptions.value" :disabled="d.readOnly.value" />
    </Field>
    <Field label="Summary">
      <Textarea
        v-model="d.draft.summary"
        rows="3"
        :disabled="d.readOnly.value"
        @change="d.saveSummary()"
      />
    </Field>
  </form>
</template>
