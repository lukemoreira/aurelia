<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { STATUS_LABELS, type StatusKind } from '@/domain/ui-names'

const COLOURS: Record<StatusKind, string> = {
  idea: 'border-ink-3 bg-transparent',
  outline: 'border-tide bg-tide',
  draft: 'border-warn bg-warn',
  revised: 'border-plum bg-plum',
  final: 'border-ok bg-ok',
}

defineProps<{ status: StatusKind; showLabel?: boolean }>()
</script>

<template>
  <span class="inline-flex items-center gap-1.5">
    <span
      aria-hidden="true"
      :class="['box-border size-2 shrink-0 rounded-full border-[1.5px]', COLOURS[status]]"
    />
    <span :class="showLabel ? undefined : 'sr-only'">{{ STATUS_LABELS[status] }}</span>
  </span>
</template>
