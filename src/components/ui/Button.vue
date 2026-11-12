<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import {
  buttonBase,
  sizeClass,
  variantClass,
  type ButtonSize,
  type ButtonVariant,
} from './buttonStyles'

withDefaults(
  defineProps<{
    variant?: ButtonVariant
    size?: ButtonSize
    loading?: boolean
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' },
)
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    :class="[buttonBase, variantClass[variant], sizeClass[size]]"
  >
    <svg
      v-if="loading"
      class="size-4 animate-spin motion-reduce:animate-none"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.2-8.55" />
    </svg>
    <slot />
  </button>
</template>
