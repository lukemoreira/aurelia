<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { EditorContent } from '@tiptap/vue-3'
import { computed } from 'vue'
import { useManuscriptEditor } from '@/composables/useManuscriptEditor'
import { useEditorStore } from '@/stores/editor'
import { useLayoutStore } from '@/stores/layout'
import EditorToolbar from './EditorToolbar.vue'

const props = defineProps<{
  body: string
  readonly: boolean
  titleId: string
  /** Where the formatting bar is drawn: a place on the page, outside the text's own column. */
  toolbarTarget: HTMLElement | null
}>()
const emit = defineEmits<{ edit: [body: string]; blur: [] }>()
const layout = useLayoutStore()
const appearance = useEditorStore()

// Named "Scene text" and by the scene's own title (it points at itself for the first part).
const { editor, tick } = useManuscriptEditor({
  body: () => props.body,
  editable: () => !props.readonly,
  onEdit: (body) => emit('edit', body),
  attributes: () => ({
    id: 'scene-text',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': 'Scene text',
    'aria-labelledby': `scene-text ${props.titleId}`,
    ...(props.readonly ? { 'aria-readonly': 'true' } : {}),
    spellcheck: 'true',
  }),
})
editor.on('blur', () => emit('blur'))

const showToolbar = computed(() => !props.readonly && !layout.focus && !!props.toolbarTarget)
</script>

<template>
  <div
    class="manuscript"
    :data-font="appearance.settings.font"
    :data-size="appearance.settings.size"
    :data-leading="appearance.settings.leading"
    :data-paragraphs="appearance.settings.paragraphs"
  >
    <EditorContent :editor="editor" />
  </div>
  <Teleport v-if="showToolbar && toolbarTarget" :to="toolbarTarget">
    <EditorToolbar :editor="editor" :tick="tick" :compact="!layout.wide" />
  </Teleport>
</template>
