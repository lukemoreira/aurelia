<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import { useAutosize } from '@/composables/useAutosize'

// Plain Markdown for now; the real editor arrives in M4. Same type and column as the reading view.
const props = defineProps<{ body: string; readonly: boolean; titleId: string }>()
const emit = defineEmits<{ edit: [body: string]; blur: [] }>()
const area = ref<HTMLTextAreaElement | null>(null)
useAutosize(area, () => props.body)
</script>

<template>
  <!-- Named "Scene text" and by the scene's own title (it points at itself for the first part). -->
  <textarea
    id="scene-text"
    ref="area"
    :value="body"
    :readonly="readonly"
    aria-label="Scene text"
    :aria-labelledby="`scene-text ${titleId}`"
    placeholder="Start writing…"
    spellcheck="true"
    class="m-0 box-border block min-h-[40vh] w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-prose text-[18px] leading-[1.7] text-ink caret-gold-ink outline-none! [field-sizing:content] placeholder:text-ink-3 lg:text-[19px] lg:leading-[1.75]"
    @input="emit('edit', ($event.target as HTMLTextAreaElement).value)"
    @blur="emit('blur')"
  />
</template>
