<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { useNewScene } from '@/composables/useNewScene'
import { sceneEyebrow } from '@/domain/outline'
import { proseBlocks } from '@/domain/prose'
import { sceneDetails } from '@/domain/scene-details'
import { useWorkspaceStore } from '@/stores/workspace'
import SceneEditor from './SceneEditor.vue'

const ws = useWorkspaceStore()
const ctx = computed(() => ws.context)
const newScene = useNewScene()
// A real workspace is edited in place; the sample is a read-only tour that is never saved.
const editable = computed(() => !!ws.view)
// Only the read-only tour is shown as paragraphs; an editable scene is a textarea.
const blocks = computed(() => (editable.value ? [] : proseBlocks(ctx.value?.scene.body ?? '')))
const meta = computed(() => {
  const d = ws.data && ws.sceneId ? sceneDetails(ws.data, ws.sceneId) : undefined
  return [d?.pov?.name, ctx.value?.book.title, d?.storyTime].filter(Boolean).join(' · ')
})
</script>

<template>
  <article
    v-if="ctx"
    class="mx-auto w-full max-w-[660px] px-[22px] pb-16 pt-8 font-prose text-[18px] leading-[1.7] text-ink lg:px-6 lg:pt-10 lg:text-[19px] lg:leading-[1.75]"
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
    <SceneEditor
      v-if="editable"
      :body="ctx.scene.body"
      title-id="scene-title"
      :readonly="ws.view?.readOnly ?? true"
      @edit="ws.editScene(ctx.scene.meta.id, $event)"
      @blur="ws.flush()"
    />
    <template v-for="(b, i) in blocks" :key="i">
      <div
        v-if="b.kind === 'break'"
        role="separator"
        aria-label="Scene break"
        class="my-[22px] text-center text-base tracking-[.6em] text-gold-ink"
      >
        * * *
      </div>
      <p v-else :class="['m-0', b.indent && 'indent-[1.6em]']">
        <template v-if="b.lead"
          ><span class="tracking-[.03em] [font-variant:small-caps]">{{ b.lead }}</span
          >{{ b.rest }}</template
        >
        <template v-else>{{ b.text }}</template>
      </p>
    </template>
    <div v-if="editable && !ws.view?.readOnly" class="mt-10 font-ui">
      <Button variant="quiet" @click="newScene"
        ><Icon name="plus" />New scene in this chapter</Button
      >
    </div>
  </article>
  <!-- A scene another app deleted while it was open: say so, rather than show an empty page. -->
  <p v-else-if="ws.view" role="status" class="m-0 px-6 py-10 text-center text-ink-2">
    This scene is no longer in the workspace. Pick another in the navigator.
  </p>
</template>
