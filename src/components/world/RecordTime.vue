<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { nextTick } from 'vue'
import TimePicker from '@/components/shell/TimePicker.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import { useRecordTime } from '@/composables/useRecordTime'
import { NEW_CALENDAR } from '@/composables/useSceneTime'

/**
 * A date on a sheet, in a calendar of the universe: when an event happens, or when a character was born
 * (the Age and dates check reads it). As exact as the author knows it; a year before the calendar starts is "BCE".
 */
const props = defineProps<{
  id: string
  field: 'time' | 'born'
  label: string
  hint: string
}>()
const t = useRecordTime(() => props.id, props.field)
const d = t.draft
/** A part of the date was left: the key is made on the next tick, then saved. */
const commit = async () => {
  await nextTick()
  await t.save()
}
</script>

<template>
  <fieldset class="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
    <legend class="mb-1 p-0 text-[13px] font-medium text-ink">{{ label }}</legend>
    <p class="m-0 text-xs text-ink-3">{{ hint }}</p>
    <Field label="Calendar">
      <Select
        :model-value="d.calendar || undefined"
        :options="t.calendarOptions.value"
        :disabled="t.readOnly.value"
        placeholder="Pick a calendar"
        @update:model-value="(v) => t.pick(v ?? '')"
      />
    </Field>
    <template v-if="d.calendar === NEW_CALENDAR">
      <Field label="Name of the calendar">
        <Input v-model="d.name" autocomplete="off" placeholder="Tidal Reckoning" />
      </Field>
      <Field label="Era (optional)" description="Written after the year: 412 TR.">
        <Input v-model="d.era" autocomplete="off" placeholder="TR" />
      </Field>
    </template>
    <Field
      label="Date"
      :description="
        t.ready.value ? t.granularity.value || 'As exact as you know it' : 'Pick a calendar first'
      "
    >
      <TimePicker
        v-model="d.at"
        label="Date"
        :months="t.months.value"
        :era="t.era.value"
        :disabled="t.readOnly.value || !t.ready.value"
        @commit="commit()"
      />
    </Field>
    <Field v-if="field === 'time'" label="Label (optional)">
      <Input
        v-model="d.label"
        :disabled="t.readOnly.value"
        autocomplete="off"
        placeholder="The spring tide"
        @change="t.save()"
      />
    </Field>
    <p v-if="t.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
      {{ t.error.value }}
    </p>
  </fieldset>
</template>
