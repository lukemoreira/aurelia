<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 24 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true" class="shrink-0">
    <path
      d="M3.5 17.5a8.5 8.5 0 0 1 17 0"
      fill="none"
      stroke="var(--gold)"
      stroke-width="1.6"
      stroke-linecap="round"
    />
    <path d="M8 17.5a4 4 0 0 1 8 0z" fill="var(--gold)" />
    <path
      d="M2 20.5h20"
      fill="none"
      stroke="var(--gold)"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  </svg>
</template>
