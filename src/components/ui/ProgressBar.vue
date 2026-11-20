<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'

/** How far along: a quiet bar that turns green once the goal is reached. */
const props = defineProps<{ value: number; max: number; label: string }>()
const percent = computed(() => Math.min(100, Math.round((props.value / props.max) * 100)))
</script>

<template>
  <div
    role="progressbar"
    :aria-label="label"
    aria-valuemin="0"
    :aria-valuemax="max"
    :aria-valuenow="Math.min(value, max)"
    class="h-1.5 overflow-hidden rounded-full bg-raised"
  >
    <div
      :class="['h-full rounded-full', value >= max ? 'bg-ok' : 'bg-gold']"
      :style="{ width: `${percent}%` }"
    />
  </div>
</template>
