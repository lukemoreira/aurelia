<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { useKeyboardInset } from '@/composables/useKeyboardInset'
import { useNewScene } from '@/composables/useNewScene'
import { sceneEyebrow } from '@/domain/outline'
import { sceneDetails } from '@/domain/scene-details'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import SceneEditor from './SceneEditor.vue'

const ws = useWorkspaceStore()
const layout = useLayoutStore()
const ctx = computed(() => ws.context)
const newScene = useNewScene()
// A real workspace is edited in place; the sample is a read-only tour that is never saved.
const canEdit = computed(() => !!ws.view && !ws.view.readOnly)
const meta = computed(() => {
  const d = ws.data && ws.sceneId ? sceneDetails(ws.data, ws.sceneId) : undefined
  return [d?.pov?.name, ctx.value?.book.title, d?.storyTime].filter(Boolean).join(' · ')
})

// Where the editor draws its formatting bar: above the text on a wide screen, and along the
// bottom edge on a phone, where the thumb is.
const topBar = ref<HTMLElement | null>(null)
const bottomBar = ref<HTMLElement | null>(null)
const bar = computed(() => (layout.wide ? topBar.value : bottomBar.value))
// On a phone the bar rides above the on-screen keyboard.
const keyboard = useKeyboardInset()
</script>

<template>
  <div v-if="ctx" class="flex min-h-full flex-col">
    <div v-if="layout.wide" ref="topBar" class="sticky top-3 z-10 mt-5 flex justify-center px-6" />
    <article
      class="mx-auto w-full max-w-[660px] px-[22px] pb-16 pt-8 font-prose text-ink lg:px-6 lg:pt-10"
    >
      <p
        class="m-0 mb-1.5 font-ui text-[11px] font-semibold uppercase tracking-[.14em] text-gold-ink"
      >
        {{ sceneEyebrow(ctx.chapter.number, ctx.index) }}
      </p>
      <h1
        id="scene-title"
        class="m-0 text-[26px] font-medium leading-[1.2] tracking-[-.01em] lg:text-[32px]"
      >
        {{ ctx.scene.meta.title }}
      </h1>
      <p class="mb-[30px] mt-2 font-ui text-[13px] leading-normal text-ink-3">{{ meta }}</p>
      <!-- One editor per scene: switching scenes starts a fresh one on the new text. -->
      <SceneEditor
        :key="ctx.scene.meta.id"
        :body="ctx.scene.body"
        title-id="scene-title"
        :readonly="!canEdit"
        :toolbar-target="bar"
        @edit="ws.editScene(ctx.scene.meta.id, $event)"
        @blur="ws.flush()"
      />
      <div v-if="canEdit" class="mt-10 font-ui">
        <Button variant="quiet" @click="newScene"
          ><Icon name="plus" />New scene in this chapter</Button
        >
      </div>
    </article>
    <div
      v-if="!layout.wide"
      ref="bottomBar"
      class="sticky bottom-0 z-10 mt-auto"
      :style="{ bottom: `${keyboard}px` }"
    />
  </div>
  <!-- A scene another app deleted while it was open: say so, rather than show an empty page. -->
  <p v-else-if="ws.view" role="status" class="m-0 px-6 py-10 text-center text-ink-2">
    This scene is no longer in the workspace. Pick another in the navigator.
  </p>
</template>
