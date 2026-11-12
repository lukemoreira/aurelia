<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui'
import { useId } from 'vue'
import Icon from './Icon.vue'

defineProps<{ label: string; disabled?: boolean }>()
const model = defineModel<boolean>({ default: false })
const id = useId()
</script>

<template>
  <div class="flex min-h-8 items-center gap-2.5 pointer-coarse:min-h-11">
    <CheckboxRoot
      :id="id"
      v-model="model"
      :disabled="disabled"
      class="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-field bg-surface data-[disabled]:border-line-2 data-[disabled]:bg-raised data-[state=checked]:border-gold data-[state=checked]:bg-gold"
    >
      <CheckboxIndicator class="text-on-gold"><Icon name="check" :size="14" /></CheckboxIndicator>
    </CheckboxRoot>
    <label :for="id" class="text-[13px] text-ink">{{ label }}</label>
  </div>
</template>
