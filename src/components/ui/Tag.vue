<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'chip' | 'pill' }>(), { variant: 'chip' })
</script>

<template>
  <span
    :class="[
      'inline-flex items-center',
      variant === 'chip'
        ? 'rounded-[5px] bg-raised px-1.5 py-px text-[11.5px] font-medium text-ink-2'
        : 'h-6 gap-1.5 rounded-full border border-line-2 bg-surface px-2.5 text-xs text-ink',
    ]"
  >
    <slot />
  </span>
</template>
