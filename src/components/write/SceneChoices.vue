<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Button from '@/components/ui/Button.vue'
import { choiceLines } from '@/domain/scene-details'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * The choices of a scene, read under its text (ADR-0004 §5): where each leads. Editing them is in
 * the inspector; the button takes the keyboard there. Only in a branching book, or on a scene that
 * already has choices or is an ending.
 */
const ws = useWorkspaceStore()
const layout = useLayoutStore()
const scene = computed(() => ws.scene?.meta)
const lines = computed(() => (ws.data && ws.sceneId ? choiceLines(ws.data, ws.sceneId) : []))
const shown = computed(
  () => ws.book?.mode === 'branching' || lines.value.length > 0 || scene.value?.ending === true,
)
const canEdit = computed(() => !!ws.view && !ws.view.readOnly)
</script>

<template>
  <section v-if="shown" aria-label="Choices" class="mt-10 border-t border-line pt-5 font-ui">
    <h2 class="m-0 mb-2 text-[11px] font-semibold uppercase tracking-[.12em] text-ink-3">
      Choices
    </h2>
    <p v-if="!lines.length" class="m-0 text-[13px] text-ink-2">
      {{ scene?.ending ? 'This scene is an ending.' : 'No choices yet.' }}
    </p>
    <ul v-else class="m-0 flex list-none flex-col gap-1 p-0 text-[13.5px] text-ink">
      <li v-for="l in lines" :key="l.id">
        {{ l.label }} <span aria-hidden="true" class="text-ink-3">→</span>
        <span class="sr-only">leads to</span>
        <span v-if="l.to" class="text-ink-2"> {{ l.to }}</span>
        <span v-else class="text-danger"> a scene that is not there</span>
      </li>
    </ul>
    <p v-if="lines.length && scene?.ending" class="m-0 mt-1 text-[13px] text-ink-2">
      The story can also finish here.
    </p>
    <div v-if="canEdit" class="mt-3">
      <Button @click="layout.askChoices()">Edit choices</Button>
    </div>
  </section>
</template>
