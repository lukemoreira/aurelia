<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import ArcPicker from '@/components/plan/ArcPicker.vue'
import ChoiceEditor from '@/components/story/ChoiceEditor.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Switch from '@/components/ui/Switch.vue'
import Textarea from '@/components/ui/Textarea.vue'
import { DETAIL_FIELDS, useItemDetails, type DetailsKind } from '@/composables/useItemDetails'
import { useWorkspaceStore } from '@/stores/workspace'

/** The editable details of one scene, chapter, part or book. Saved as the author leaves each field. */
const props = defineProps<{ kind: DetailsKind; id: string | undefined; heading?: string }>()
const d = useItemDetails(props.kind, () => props.id)
const ws = useWorkspaceStore()
const has = (field: string) => DETAIL_FIELDS[props.kind].includes(field)
// Choices belong to a branching book, and to any scene that already has them (ADR-0004: any scene may).
const showChoices = computed(
  () =>
    props.kind === 'scene' &&
    (ws.book?.mode === 'branching' ||
      !!d.item.value?.choices?.length ||
      d.item.value?.ending === true),
)
const text = [
  ['objective', 'Objective'],
  ['conflict', 'Conflict'],
  ['outcome', 'Outcome'],
] as const
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
    <Field label="Title">
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
    <Field v-if="has('pov')" label="Point of view">
      <Select v-model="d.pov.value" :options="d.povOptions.value" :disabled="d.readOnly.value" />
    </Field>
    <Field v-if="has('location')" label="Location">
      <Select
        v-model="d.location.value"
        :options="d.locationOptions.value"
        :disabled="d.readOnly.value"
      />
    </Field>
    <Field label="Summary">
      <Textarea
        v-model="d.draft.summary"
        rows="3"
        :disabled="d.readOnly.value"
        @change="d.saveText('summary')"
      />
    </Field>
    <template v-for="[key, label] in text" :key="key">
      <Field v-if="has(key)" :label="label">
        <Textarea
          v-model="d.draft[key]"
          rows="2"
          :disabled="d.readOnly.value"
          @change="d.saveText(key)"
        />
      </Field>
    </template>
    <Field v-if="has('target')" label="Word target">
      <Input
        v-model="d.draft.target"
        inputmode="numeric"
        :disabled="d.readOnly.value"
        autocomplete="off"
        @change="d.saveTarget()"
      />
    </Field>
    <Field v-if="has('arcs')" :label="kind === 'scene' ? 'Arcs advanced' : 'Arcs'">
      <ArcPicker
        v-model="d.arcs.value"
        field
        :options="d.arcOptions.value"
        :label="`Arcs of ${d.item.value.title}`"
        :disabled="d.readOnly.value"
      />
    </Field>
    <Switch
      v-if="kind === 'book'"
      v-model="d.branching.value"
      label="A branching story (choices and a story map)"
      :disabled="d.readOnly.value"
    />
    <p v-if="d.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
      {{ d.error.value }}
    </p>
    <ChoiceEditor v-if="showChoices" :id="id" askable class="border-t border-line pt-3" />
  </form>
</template>
