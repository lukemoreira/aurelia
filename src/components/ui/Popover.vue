<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child><slot name="trigger" /></PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        :side-offset="6"
        class="z-50 w-72 rounded-card border border-line bg-surface p-3 text-[13px] text-ink shadow-card"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
