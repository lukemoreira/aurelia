<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { EditorContent } from '@tiptap/vue-3'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SuggestionDialog from '@/components/assistant/SuggestionDialog.vue'
import { useLinkEnv } from '@/composables/useLinkEnv'
import { useManuscriptEditor } from '@/composables/useManuscriptEditor'
import { useProposals } from '@/composables/useProposals'
import { useReadAloud } from '@/composables/useReadAloud'
import { isNoOp } from '@/domain/proposals'
import { createLinks, focusFound, focusName, refreshLinks } from '@/editor/links'
import {
  caretNear,
  createSuggestions,
  findChip,
  setSuggestions,
  type SuggestionTarget,
} from '@/editor/suggestions'
import { useEditorStore } from '@/stores/editor'
import { useLayoutStore } from '@/stores/layout'
import { useReviewStore } from '@/stores/review'
import { useWorkspaceStore } from '@/stores/workspace'
import EditorToolbar from './EditorToolbar.vue'
import LinkCard from './LinkCard.vue'
import LinkPicker from './LinkPicker.vue'
import ReadAloudBar from './ReadAloudBar.vue'

const props = withDefaults(
  defineProps<{
    body: string
    readonly: boolean
    titleId: string
    /** Where the formatting bar is drawn: a place on the page, outside the text's own column. */
    toolbarTarget: HTMLElement | null
    /** The scene or record this text belongs to: with it, links and names work. */
    docId?: string
    /** Names found in the text (scenes). Off for a record's notes, where only links count. */
    names?: boolean
    /** What a screen reader calls the text. */
    label?: string
    inputId?: string
    /** `notes`: a record's notes, drawn as notes and not as the page of a book. */
    variant?: 'scene' | 'notes'
    /** Words typed in the source mode that the workspace had not taken: shown, and sent again. */
    held?: string | null
    /** Where the caret starts (coming back from the source mode). */
    place?: { block: number; offset: number } | null
  }>(),
  {
    docId: undefined,
    names: true,
    label: 'Scene text',
    inputId: 'scene-text',
    variant: 'scene',
    held: null,
    place: null,
  },
)
const emit = defineEmits<{ edit: [body: string]; blur: [] }>()
const layout = useLayoutStore()
const appearance = useEditorStore()
const ws = useWorkspaceStore()

const link = useLinkEnv(() => props.docId, { names: props.names })
const card = ref<InstanceType<typeof LinkCard> | null>(null)
link.onCardFocus(() => card.value?.focus() ?? false)

// The assistant's suggestions for this scene: a frame and a button on each paragraph they change, opening
// the suggestion in a popup (a scene only, not a record's notes).
const suggestion = ref<SuggestionTarget | null>(null)
const inScene = props.docId && props.variant === 'scene'

// Named "Scene text" and by the scene's own title (it points at itself for the first part).
const { editor, tick, pending } = useManuscriptEditor({
  held: props.held,
  place: props.place,
  body: () => props.body,
  editable: () => !props.readonly,
  onEdit: (body) => emit('edit', body),
  extensions: [
    ...(props.docId ? [createLinks(link.env)] : []),
    ...(inScene ? [createSuggestions((hits, pos) => (suggestion.value = { hits, pos }))] : []),
  ],
  attributes: () => ({
    id: props.inputId,
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': props.label,
    'aria-labelledby': `${props.inputId} ${props.titleId}`,
    ...(props.readonly ? { 'aria-readonly': 'true' } : {}),
    spellcheck: 'true',
  }),
})
editor.on('blur', () => emit('blur'))

// The scene on screen is the one the palette and the shortcut read aloud; leaving it stops the reading.
const { attach, detach } = useReadAloud()
if (inScene) {
  attach(editor)
  onBeforeUnmount(() => detach(editor))
}

if (inScene) {
  const proposals = useProposals()
  // Compared as text: a keystroke re-reads the list, and only a real change may reach the editor.
  watch(
    () =>
      JSON.stringify(
        proposals.forScene(props.docId!).map((p) => ({
          id: p.id,
          outOfDate: proposals.outOfDate.value.has(p.id),
          // Only the paragraphs it really changes get a frame.
          anchors:
            p.kind === 'edit'
              ? p.changes.flatMap((c, change) =>
                  c.block === 'end' || isNoOp(c)
                    ? []
                    : [{ change, before: c.before, occurrence: c.occurrence, copies: c.copies }],
                )
              : [],
        })),
      ),
    (items) => setSuggestions(editor.view, JSON.parse(items)),
    { immediate: true },
  )
}

/**
 * The popup closed and the button that opened it is gone (accepted, dismissed): its paragraph's button
 * again when it was only drawn anew (or still stands for another suggestion), else the text, at the
 * paragraph that was changed.
 */
function refocus(at: SuggestionTarget) {
  const again = findChip(editor.view.dom, at)
  if (again) return again.focus()
  const sel = caretNear(editor.state.doc, at.pos)
  editor.chain().setTextSelection({ from: sel.from, to: sel.to }).focus().run()
}

// A name, a title or an answer changed outside the editor: draw the text again.
watch(
  () => ws.structureVersion,
  () => props.docId && refreshLinks(editor.view),
)

// "Review" in the Names tab: take the caret to the first place a name is asked about.
const review = useReviewStore()
watch(
  () => review.name,
  (name) => {
    if (!name || !props.docId) return
    focusName(editor.view, name)
    review.name = null
  },
)

// A search result opened at its words: select them once this file's text is on screen.
function showFound(tries = 0) {
  const found = review.found
  if (!found || found.id !== props.docId) return
  // Kept until the editor is in the page and has found the words: a scene opened just now may not be on
  // screen yet, so a few more looks (a frame apart) before it is let go.
  if (editor.view.dom.isConnected && focusFound(editor.view, found.term)) review.found = null
  else if (tries < 20) setTimeout(() => showFound(tries + 1), 50)
  else review.found = null
}
watch(
  () => review.found,
  () => showFound(),
)
// A scene opened at its words (a search result, a finding): once the editor is in the page.
onMounted(() => showFound())

/** Give the text the keyboard where its caret is, without moving the page (the source mode hands it back here). */
defineExpose({
  focus: () => editor.commands.focus(null, { scrollIntoView: false }),
  /** Typed here and not yet taken by the workspace. */
  pending,
})

const showToolbar = computed(() => !props.readonly && !layout.focus && !!props.toolbarTarget)
</script>

<template>
  <div
    class="manuscript"
    :data-font="appearance.settings.font"
    :data-size="appearance.settings.size"
    :data-leading="appearance.settings.leading"
    :data-paragraphs="appearance.settings.paragraphs"
    :data-variant="variant"
    :data-names="appearance.showNames ? 'on' : 'off'"
  >
    <EditorContent :editor="editor" />
  </div>
  <ReadAloudBar :editor="editor" />
  <Teleport v-if="showToolbar && toolbarTarget" :to="toolbarTarget">
    <EditorToolbar :editor="editor" :tick="tick" :compact="!layout.wide" />
  </Teleport>
  <LinkCard
    v-if="link.card.value"
    ref="card"
    :card="link.card.value"
    @hold="link.holdCard()"
    @leave="link.leaveCard()"
    @close="link.closeCard()"
  />
  <LinkPicker v-if="link.picker.value" :picker="link.picker.value" />
  <SuggestionDialog
    v-if="inScene"
    :target="suggestion"
    @close="suggestion = null"
    @refocus="refocus"
  />
  <span role="status" class="sr-only">{{ link.announcement.value }}</span>
</template>
