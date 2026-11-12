<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
export type Severity = 'error' | 'warning' | 'note'

const WORDS: Record<Severity, string> = { error: 'Error', warning: 'Warning', note: 'Note' }
const COLOURS: Record<Severity, string> = {
  error: 'bg-danger-soft text-danger',
  warning: 'bg-warn-soft text-warn',
  note: 'bg-raised text-ink-2',
}

defineProps<{ severity: Severity }>()
</script>

<template>
  <span
    :class="['inline-flex rounded-[5px] px-2 py-0.5 text-[11px] font-semibold', COLOURS[severity]]"
  >
    {{ WORDS[severity] }}
  </span>
</template>
