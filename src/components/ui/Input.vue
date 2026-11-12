<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useFieldContext } from '@/composables/useFieldContext'
import { fieldControlClass } from './fieldStyles'

const model = defineModel<string>({ default: '' })
const field = useFieldContext()
</script>

<template>
  <input
    :id="field?.id"
    v-model="model"
    :aria-describedby="field?.describedby"
    :aria-invalid="field?.invalid || undefined"
    :class="fieldControlClass"
  />
</template>
