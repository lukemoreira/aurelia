<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { useId } from 'vue'

defineProps<{
  /** Names the group for a screen reader, e.g. "Point of view". */
  label: string
  options: { value: string; label: string; description?: string; disabled?: boolean }[]
}>()
const model = defineModel<string>()
const uid = useId()
</script>

<template>
  <RadioGroupRoot v-model="model" :aria-label="label" class="flex flex-col gap-1">
    <div
      v-for="o in options"
      :key="o.value"
      class="flex min-h-8 items-start gap-2.5 py-1 pointer-coarse:min-h-11"
    >
      <RadioGroupItem
        :id="`${uid}-${o.value}`"
        :value="o.value"
        :disabled="o.disabled"
        :aria-describedby="o.description ? `${uid}-${o.value}-d` : undefined"
        class="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full border border-field bg-surface data-[disabled]:border-line-2 data-[disabled]:bg-raised data-[state=checked]:border-gold-ink"
      >
        <RadioGroupIndicator class="size-2 rounded-full bg-gold-ink" />
      </RadioGroupItem>
      <div class="flex flex-col">
        <label :for="`${uid}-${o.value}`" class="text-[13px] text-ink">{{ o.label }}</label>
        <span v-if="o.description" :id="`${uid}-${o.value}-d`" class="text-xs text-ink-3">
          {{ o.description }}
        </span>
      </div>
    </div>
  </RadioGroupRoot>
</template>
