<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'
import { useId } from 'vue'

defineProps<{ label: string; disabled?: boolean }>()
const model = defineModel<boolean>({ default: false })
const id = useId()
</script>

<template>
  <div class="flex min-h-8 items-center gap-2.5 pointer-coarse:min-h-11">
    <SwitchRoot
      :id="id"
      v-model="model"
      :disabled="disabled"
      class="relative h-5 w-9 shrink-0 rounded-full border border-field bg-raised data-[disabled]:border-line-2 data-[state=checked]:border-gold data-[state=checked]:bg-gold"
    >
      <SwitchThumb
        class="block size-3.5 translate-x-[2px] rounded-full bg-ink-2 transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-on-gold motion-reduce:transition-none"
      />
    </SwitchRoot>
    <label :for="id" class="text-[13px] text-ink">{{ label }}</label>
  </div>
</template>
