<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import PlayPanel from '@/components/story/PlayPanel.vue'
import StoryDetails from '@/components/story/StoryDetails.vue'
import StoryMapCanvas from '@/components/story/StoryMapCanvas.vue'
import StoryProblems from '@/components/story/StoryProblems.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { useStoryMap } from '@/composables/useStoryMap'
import { useWorkspaceStore } from '@/stores/workspace'

/** The story map: a branching book's scenes and choices as a graph, with its checks, and Play from the start. */
const ws = useWorkspaceStore()
const m = useStoryMap()
</script>

<template>
  <div class="flex min-h-full flex-col lg:h-full lg:min-h-0">
    <div class="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-line px-5 py-3.5">
      <div class="min-w-[240px] flex-1">
        <h1 class="m-0 font-prose text-[26px] font-medium leading-[1.2]">Story map</h1>
        <p v-if="m.branching.value && m.summary.value" class="m-0 mt-0.5 text-[12.5px] text-ink-3">
          {{ ws.book?.title }} · {{ m.summary.value.scenes }} scenes · {{ m.summary.value.choices }}
          {{ m.summary.value.choices === 1 ? 'choice' : 'choices' }} · {{ m.summary.value.endings }}
          {{ m.summary.value.endings === 1 ? 'ending' : 'endings' }}
        </p>
      </div>
      <template v-if="m.branching.value">
        <div
          v-if="!m.play.active.value"
          role="group"
          aria-label="Zoom"
          class="flex items-center overflow-hidden rounded-control border border-line-2"
        >
          <button
            type="button"
            aria-label="Zoom out"
            class="h-8 w-8 bg-surface pointer-coarse:h-11 pointer-coarse:w-11 text-[15px] font-medium text-ink-2 hover:bg-raised"
            @click="m.zoomBy(-1)"
          >
            −
          </button>
          <span class="w-[52px] text-center text-xs tabular-nums text-ink-2" role="status"
            >{{ Math.round(m.zoom.value * 100) }}%</span
          >
          <button
            type="button"
            aria-label="Zoom in"
            class="h-8 w-8 bg-surface pointer-coarse:h-11 pointer-coarse:w-11 text-[15px] font-medium text-ink-2 hover:bg-raised"
            @click="m.zoomBy(1)"
          >
            +
          </button>
        </div>
        <Button
          v-if="!m.play.active.value"
          variant="primary"
          :disabled="!m.graph.value?.start"
          @click="m.play.start()"
        >
          <Icon name="play" :size="13" />Play from start
        </Button>
      </template>
    </div>

    <div
      v-if="!m.branching.value"
      class="mx-auto flex max-w-[480px] flex-col items-center gap-2 px-6 py-24 text-center"
    >
      <h2 class="m-0 font-prose text-[22px] font-medium">This book is a straight story</h2>
      <p class="m-0 text-[13px] text-ink-2">
        The story map shows scenes that lead to other scenes by the reader’s choices.
        <template v-if="m.canEdit.value"
          >Make this book branching to give its scenes choices.</template
        >
      </p>
      <Button v-if="m.canEdit.value" variant="primary" @click="m.makeBranching()"
        >Make it a branching story</Button
      >
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div class="flex min-h-[70dvh] min-w-0 flex-1 flex-col lg:min-h-0">
        <PlayPanel v-if="m.play.active.value" :play="m.play" />
        <template v-else>
          <p class="m-0 border-b border-line px-5 py-1.5 text-xs text-ink-3">
            Arrow keys move between scenes · Home goes to the start · Enter opens the scene
          </p>
          <StoryMapCanvas :map="m" />
        </template>
      </div>
      <aside
        aria-label="Story map details"
        class="flex shrink-0 flex-col gap-5 border-l border-line bg-chrome p-4 lg:w-80 relative lg:overflow-y-auto"
      >
        <StoryProblems :map="m" />
        <StoryDetails v-if="!m.play.active.value" :map="m" class="border-t border-line pt-4" />
      </aside>
    </div>
  </div>
</template>
