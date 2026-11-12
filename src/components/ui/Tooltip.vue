<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui'

withDefaults(
  defineProps<{ text: string; side?: 'top' | 'bottom' | 'left' | 'right'; disabled?: boolean }>(),
  {
    side: 'bottom',
  },
)
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <TooltipRoot :disabled="disabled">
      <TooltipTrigger as-child><slot /></TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="side"
          :side-offset="6"
          class="z-50 rounded-md bg-ink px-2 py-1 text-xs font-medium text-canvas shadow-sm"
        >
          {{ text }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
