<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, useId } from 'vue'
import { provideFieldContext } from '@/composables/useFieldContext'

const props = defineProps<{ label: string; description?: string; error?: string }>()

const id = useId()
const describedby = computed(() => {
  const ids = [props.description && `${id}-desc`, props.error && `${id}-err`].filter(Boolean)
  return ids.length ? ids.join(' ') : undefined
})
provideFieldContext(() => ({ id, describedby: describedby.value, invalid: !!props.error }))
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="text-[13px] font-medium text-ink">{{ label }}</label>
    <slot />
    <p v-if="description" :id="`${id}-desc`" class="text-xs text-ink-3">{{ description }}</p>
    <p v-if="error" :id="`${id}-err`" role="alert" class="text-xs font-medium text-danger">
      {{ error }}
    </p>
  </div>
</template>
