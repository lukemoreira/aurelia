<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import { useSourceText } from '@/composables/useSourceText'

/**
 * The scene's Markdown body as plain text (the details at the top of the file are not in it).
 * What is typed here is what is saved, through the same path as the editor; nothing is written
 * until a key is pressed.
 */
const props = defineProps<{
  body: string
  readonly: boolean
  inputId: string
  /** Words typed in the editor that the workspace had not taken: shown, and sent again. */
  held?: string | null
}>()
const emit = defineEmits<{ edit: [body: string]; blur: [] }>()
const area = ref<HTMLTextAreaElement | null>(null)
const { text, input, pending } = useSourceText(
  () => props.body,
  (body) => emit('edit', body),
  { editable: () => !props.readonly, held: props.held },
)

defineExpose({
  /** Typed here and not yet taken by the workspace. */
  pending,
  /** Where the caret is, as an offset into the file's own text (its lines may end in CRLF). */
  caret: () => {
    const before = text.value.slice(0, area.value?.selectionStart ?? 0)
    return props.body.includes('\r\n') ? before.replace(/\n/g, '\r\n').length : before.length
  },
})
</script>

<template>
  <textarea
    :id="inputId"
    ref="area"
    :value="text"
    :readonly="readonly"
    aria-label="Scene text, Markdown source"
    spellcheck="false"
    autocapitalize="off"
    autocorrect="off"
    autocomplete="off"
    wrap="soft"
    class="block min-h-[40vh] w-full resize-y rounded-card border border-line bg-surface p-4 font-mono text-[13.5px] leading-[1.65] pointer-coarse:text-base text-ink outline-ink [field-sizing:content] [tab-size:4]"
    @input="input(($event.target as HTMLTextAreaElement).value)"
    @blur="emit('blur')"
  />
</template>
