<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import type { ResizablePanel } from '@/composables/useResizablePanel'

/** Put it inside the panel's landmark (nav, aside): `side` is the side the panel is on. */
defineProps<{ panel: ResizablePanel; label: string; side: 'left' | 'right' }>()
</script>

<template>
  <!-- A thin line that is wider to grab. Arrow keys resize, Home and End jump to the limits. -->
  <div
    role="separator"
    aria-orientation="vertical"
    tabindex="0"
    :aria-label="label"
    :aria-valuenow="panel.width"
    :aria-valuemin="panel.min"
    :aria-valuemax="panel.max"
    :class="[
      'group absolute inset-y-0 z-10 w-[7px] cursor-col-resize touch-none outline-none',
      side === 'left' ? '-right-[3px]' : '-left-[3px]',
      panel.resizing && 'select-none',
    ]"
    @keydown="panel.onKeydown"
    @pointerdown="panel.onPointerDown"
    @pointermove="panel.onPointerMove"
    @pointerup="panel.onPointerUp"
    @pointercancel="panel.onPointerUp"
  >
    <span
      aria-hidden="true"
      :class="[
        'absolute inset-y-0 left-[3px] w-px bg-line transition-colors group-hover:bg-gold group-focus-visible:w-0.5 group-focus-visible:bg-ink',
        panel.resizing && 'bg-gold',
      ]"
    />
  </div>
</template>
