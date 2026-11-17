<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { nextTick } from 'vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import { NEW_CALENDAR, ORDER_OPTIONS, useSceneTime } from '@/composables/useSceneTime'
import TimePicker from './TimePicker.vue'

/** When the scene happens in the story, as exactly as the author knows it, and whether it is told out of order. */
const props = defineProps<{ id: string | undefined }>()
const t = useSceneTime(() => props.id)
const d = t.draft
/** A part of the time was left: the key is made on the next tick, then saved. */
const commit = async () => {
  await nextTick()
  await t.save()
}
</script>

<template>
  <section aria-label="Story time" class="flex flex-col gap-3 border-t border-line pt-3.5">
    <h3 class="text-[11px] font-semibold uppercase tracking-[.06em] text-ink-3">Story time</h3>
    <Field label="Calendar">
      <Select
        :model-value="d.calendar || undefined"
        :options="t.calendarOptions.value"
        :disabled="t.readOnly.value"
        placeholder="Pick a calendar"
        @update:model-value="(v) => t.pick('calendar', v ?? '')"
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
      label="When"
      :description="
        t.ready.value ? t.granularity.value || 'As exact as you know it' : 'Pick a calendar first'
      "
    >
      <TimePicker
        v-model="d.at"
        label="When"
        :months="t.months.value"
        :disabled="t.readOnly.value || !t.ready.value"
        @commit="commit()"
      />
    </Field>
    <Field label="Until (optional)">
      <Input
        v-model="d.until"
        :disabled="t.readOnly.value || !t.ready.value"
        autocomplete="off"
        placeholder="412-03-15"
        @change="t.save()"
      />
    </Field>
    <Field label="Label (optional)">
      <Input
        v-model="d.label"
        :disabled="t.readOnly.value"
        autocomplete="off"
        placeholder="Dusk"
        @change="t.save()"
      />
    </Field>
    <Field label="Told">
      <Select
        :model-value="d.order"
        :options="ORDER_OPTIONS"
        :disabled="t.readOnly.value"
        @update:model-value="(v) => t.pick('order', v ?? 'normal')"
      />
    </Field>
    <p v-if="t.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
      {{ t.error.value }}
    </p>
  </section>
</template>
