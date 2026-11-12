<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import Icon from './Icon.vue'
import type { IconName } from '@/domain/ui-names'

defineProps<{
  /** Names the control for a screen reader, e.g. "View". */
  label: string
  options: { value: string; label: string; icon?: IconName }[]
}>()
const model = defineModel<string>()
</script>

<template>
  <RadioGroupRoot
    v-model="model"
    :aria-label="label"
    orientation="horizontal"
    class="inline-flex gap-0.5 rounded-control bg-raised p-0.5"
  >
    <RadioGroupItem
      v-for="o in options"
      :key="o.value"
      :value="o.value"
      class="inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-ink-2 hover:text-ink data-[state=checked]:bg-surface data-[state=checked]:text-ink data-[state=checked]:shadow-sm pointer-coarse:h-10"
    >
      <Icon v-if="o.icon" :name="o.icon" :size="14" />
      {{ o.label }}
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
