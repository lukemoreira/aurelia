<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { reactive, watch } from 'vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import { parseTimeKey } from '@/domain/story-time'

/**
 * A story time as parts, in the calendar's own words: the year, then the month by name (when the
 * calendar names its months), the day and the time, as far as the author knows. It reads and writes
 * the stored key (412-03-14T18:00); each part left empty makes the key less exact, never wrong.
 */
const props = defineProps<{
  months?: string[]
  disabled?: boolean
  /** Names the group for a screen reader. */
  label: string
}>()
const model = defineModel<string>({ default: '' })
const emit = defineEmits<{ commit: [] }>()
const NONE = '__none'
const pad = (n: number | string) => String(n).padStart(2, '0')

const parts = reactive({ year: '', month: NONE, day: '', time: '' })
function read(key: string) {
  const k = parseTimeKey(key)
  parts.year = k ? String(k.parts[0]) : ''
  parts.month = k?.parts[1] ? String(k.parts[1]) : NONE
  parts.day = k?.parts[2] ? String(k.parts[2]) : ''
  parts.time = k?.parts[3] !== undefined ? `${pad(k.parts[3])}:${pad(k.parts[4] ?? 0)}` : ''
}
read(model.value)

/** The key the parts make: a month needs a year, a day a month, a time a day. */
function compose(): string {
  const year = parts.year.trim().replace(/\D/g, '')
  if (!year) return ''
  if (parts.month === NONE) return year
  const month = `${year}-${pad(parts.month)}`
  const day = parts.day.trim().replace(/\D/g, '')
  if (!day) return month
  const date = `${month}-${pad(day)}`
  return /^\d{1,2}:\d{2}$/.test(parts.time.trim())
    ? `${date}T${pad(parts.time.trim().split(':')[0]!)}:${parts.time.trim().split(':')[1]}`
    : date
}
watch(parts, () => (model.value = compose()))
// The stored time changed outside (another scene, another device): the parts follow, unless they already say it.
watch(model, (key) => key !== compose() && read(key))

const monthOptions = () => [
  { value: NONE, label: 'Month' },
  ...(props.months?.length
    ? props.months
    : Array.from({ length: 12 }, (_, i) => String(i + 1))
  ).map((label, i) => ({ value: String(i + 1), label })),
]
const small = 'min-w-0'
</script>

<template>
  <div role="group" :aria-label="label" class="grid grid-cols-[1fr_1.4fr_0.8fr_1fr] gap-1.5">
    <Input
      v-model="parts.year"
      aria-label="Year"
      placeholder="Year"
      inputmode="numeric"
      autocomplete="off"
      :disabled="disabled"
      :class="small"
      @change="emit('commit')"
    />
    <Select
      v-model="parts.month"
      aria-label="Month"
      :options="monthOptions()"
      :disabled="disabled || !parts.year"
      @update:model-value="emit('commit')"
    />
    <Input
      v-model="parts.day"
      aria-label="Day"
      placeholder="Day"
      inputmode="numeric"
      autocomplete="off"
      :disabled="disabled || parts.month === NONE"
      :class="small"
      @change="emit('commit')"
    />
    <Input
      v-model="parts.time"
      aria-label="Time"
      placeholder="18:00"
      autocomplete="off"
      :disabled="disabled || !parts.day"
      :class="small"
      @change="emit('commit')"
    />
  </div>
</template>
