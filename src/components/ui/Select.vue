<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'
import { useFieldContext } from '@/composables/useFieldContext'
import { fieldControlClass } from './fieldStyles'
import Icon from './Icon.vue'

defineOptions({ inheritAttrs: false })
defineProps<{
  options: { value: string; label: string; disabled?: boolean }[]
  placeholder?: string
}>()
const model = defineModel<string>()
const field = useFieldContext()
</script>

<template>
  <SelectRoot v-model="model">
    <SelectTrigger
      :id="field?.id"
      :aria-describedby="field?.describedby"
      :aria-invalid="field?.invalid || undefined"
      v-bind="$attrs"
      :class="[fieldControlClass, 'flex items-center justify-between gap-2 text-left']"
    >
      <SelectValue :placeholder="placeholder" class="truncate data-[placeholder]:text-ink-3" />
      <Icon name="chevron-down" :size="14" class="text-ink-3" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="4"
        class="z-50 min-w-[var(--reka-select-trigger-width)] rounded-card border border-line bg-surface p-1 shadow-card"
      >
        <SelectViewport>
          <SelectItem
            v-for="o in options"
            :key="o.value"
            :value="o.value"
            :disabled="o.disabled"
            class="flex h-8 cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 text-[13px] text-ink outline-none data-[disabled]:text-ink-3 data-[highlighted]:bg-raised pointer-coarse:h-11"
          >
            <SelectItemText>{{ o.label }}</SelectItemText>
            <SelectItemIndicator><Icon name="check" :size="14" /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
