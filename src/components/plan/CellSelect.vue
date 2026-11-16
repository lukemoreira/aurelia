<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'

/**
 * A select that sits in a table cell: bare until hovered or focused, so a column of them reads as
 * text. Where nothing can be changed (the sample, a second tab) it is only the text.
 */
const props = defineProps<{
  label: string
  options: { value: string; label: string; aria?: string }[]
  disabled?: boolean
}>()
const model = defineModel<string>()
const shown = computed(() => props.options.find((o) => o.value === model.value)?.label)
</script>

<template>
  <span v-if="disabled" class="block truncate px-1 text-[12.5px] text-ink-2">
    <span class="sr-only">{{ label }}: </span>{{ shown ?? '—' }}
  </span>
  <select
    v-else
    v-model="model"
    :aria-label="label"
    class="h-8 w-full min-w-0 cursor-pointer truncate rounded-control border border-transparent bg-transparent px-1 text-[12.5px] text-ink-2 hover:border-line-2 hover:bg-surface focus:border-field pointer-coarse:h-11"
  >
    <option v-for="o in options" :key="o.value" :value="o.value" :aria-label="o.aria">
      {{ o.label }}
    </option>
  </select>
</template>
