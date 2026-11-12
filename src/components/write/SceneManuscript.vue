<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import { sceneEyebrow } from '@/domain/outline'
import { proseBlocks } from '@/domain/prose'
import { sceneDetails } from '@/domain/scene-details'
import { useWorkspaceStore } from '@/stores/workspace'

const ws = useWorkspaceStore()
const ctx = computed(() => ws.context)
const blocks = computed(() => proseBlocks(ctx.value?.scene.body ?? ''))
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
    <h1 class="m-0 text-[26px] font-medium leading-[1.2] tracking-[-.01em] lg:text-[32px]">
      {{ ctx.scene.meta.title }}
    </h1>
    <p class="mb-[30px] mt-2 font-ui text-[13px] leading-normal text-ink-3">{{ meta }}</p>
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
  </article>
</template>
