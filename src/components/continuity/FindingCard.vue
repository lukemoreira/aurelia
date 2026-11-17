<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import SeverityTag from '@/components/ui/SeverityTag.vue'
import type { Severity } from '@/components/ui/SeverityTag.vue'

/**
 * One finding, as the Continuity list and the story map's problems list both draw it: the severity as
 * a word, what was found, where and why, and the buttons for it (the slot). A list item.
 */
defineProps<{ title: string; body: string; severity: Severity }>()
</script>

<template>
  <li
    tabindex="-1"
    class="flex flex-col gap-1 rounded-[10px] border border-line bg-surface px-3 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
  >
    <span class="flex items-center gap-2">
      <SeverityTag :severity="severity" />
      <span class="text-[13px] font-semibold">{{ title }}</span>
    </span>
    <span class="text-[12.5px] text-ink-2">{{ body }}</span>
    <span v-if="$slots.evidence" class="text-xs text-ink-3"><slot name="evidence" /></span>
    <span v-if="$slots.default" class="mt-1 flex flex-wrap gap-1.5"><slot /></span>
  </li>
</template>
