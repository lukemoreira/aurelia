<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useId } from 'vue'

defineProps<{ title: string }>()
const id = useId()
</script>

<template>
  <section
    :aria-labelledby="id"
    class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
  >
    <h2 :id="id" class="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
      {{ title }}
    </h2>
    <slot />
  </section>
</template>
