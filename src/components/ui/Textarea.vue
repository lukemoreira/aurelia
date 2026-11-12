<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useFieldContext } from '@/composables/useFieldContext'
import { fieldControlClass } from './fieldStyles'

const model = defineModel<string>({ default: '' })
const field = useFieldContext()
</script>

<template>
  <textarea
    :id="field?.id"
    v-model="model"
    :aria-describedby="field?.describedby"
    :aria-invalid="field?.invalid || undefined"
    rows="4"
    :class="[fieldControlClass, 'h-auto min-h-20 py-2 pointer-coarse:h-auto']"
  />
</template>
