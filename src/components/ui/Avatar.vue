<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { initialsOf } from './initials'

const SIZES = { 20: 'size-5 text-[9px]', 24: 'size-6 text-[10px]', 36: 'size-9 text-[13px]' }

withDefaults(
  defineProps<{
    name: string
    /** The character's colour, any CSS colour (e.g. `var(--tide)`). Plain when omitted. */
    color?: string
    size?: 20 | 24 | 36
  }>(),
  { color: undefined, size: 24 },
)
</script>

<template>
  <span
    role="img"
    :aria-label="name"
    :style="color ? { background: color } : undefined"
    :class="[
      'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
      SIZES[size],
      color ? 'text-on-accent' : 'bg-raised text-ink-2',
    ]"
  >
    {{ initialsOf(name) }}
  </span>
</template>
