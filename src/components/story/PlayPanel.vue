<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import type { usePlay } from '@/composables/usePlay'

/** Play mode: the story read as a reader would, one scene at a time, with the choices to click. Read-only. */
const props = defineProps<{ play: ReturnType<typeof usePlay> }>()
const p = props.play
const heading = ref<HTMLElement | null>(null)
// After a choice the reader is at the top of the new scene, and a screen reader hears its title.
watch(
  () => p.path.value.length,
  async () => {
    await nextTick()
    heading.value?.focus()
  },
)
// Escape leaves Play, unless something else (a menu, a dialog) has already used it.
const leave = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && !e.defaultPrevented) p.stop()
}
onMounted(() => document.addEventListener('keydown', leave))
onBeforeUnmount(() => document.removeEventListener('keydown', leave))
</script>

<template>
  <section aria-label="Play" class="flex min-h-0 flex-1 flex-col relative overflow-auto">
    <div class="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-5 py-8">
      <div class="flex flex-wrap items-center gap-2">
        <Button :disabled="p.path.value.length < 2" @click="p.back()"
          ><Icon name="chevron-up" :size="14" class="-rotate-90" />Previous scene</Button
        >
        <Button @click="p.start()"><Icon name="undo" :size="14" />Start again</Button>
        <span class="flex-1" />
        <Button variant="quiet" @click="p.stop()"
          ><Icon name="close" :size="14" />Back to the map</Button
        >
      </div>

      <article v-if="p.scene.value" class="flex flex-col gap-4">
        <p class="m-0 text-[11px] font-semibold uppercase tracking-[.12em] text-gold-ink">
          Scene {{ p.scene.value.ref }}
        </p>
        <h2
          ref="heading"
          tabindex="-1"
          class="m-0 font-prose text-[30px] font-medium leading-[1.15] focus:outline-none"
        >
          {{ p.scene.value.title }}
        </h2>
        <div class="flex flex-col gap-3.5 font-prose text-[17px] leading-[1.7] text-ink">
          <p
            v-for="(para, i) in p.paragraphs.value"
            :key="i"
            :class="['m-0', para === '⁂' && 'text-center text-ink-3']"
          >
            {{ para }}
          </p>
          <p v-if="!p.paragraphs.value.length" class="m-0 italic text-ink-3">
            This scene has no text yet.
          </p>
        </div>

        <div
          v-if="p.ended.value"
          role="status"
          class="rounded-card border border-ok-line bg-ok-soft px-4 py-3 text-[13px] text-ok"
        >
          <span class="font-semibold">The end.</span> You reached an ending after
          {{ p.path.value.length }} {{ p.path.value.length === 1 ? 'scene' : 'scenes' }}.
        </div>
        <div
          v-else-if="p.stuck.value"
          role="status"
          class="rounded-card border border-warn-line bg-warn-soft px-4 py-3 text-[13px] text-warn"
        >
          <span class="font-semibold">The story stops here.</span> This scene has no choices and is
          not marked as an ending.
        </div>
        <ul
          v-if="p.options.value.length"
          aria-label="Choices"
          class="m-0 flex list-none flex-col gap-2 p-0"
        >
          <li v-for="c in p.options.value" :key="c.id">
            <button
              type="button"
              :disabled="!!c.broken"
              class="min-h-11 w-full rounded-card border border-line-2 bg-surface px-4 py-3 text-left text-[15px] text-ink hover:bg-raised disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-surface"
              @click="p.choose(c.id)"
            >
              {{ c.label }}
              <span v-if="c.broken" class="ml-1 text-xs text-danger"
                >(leads to a scene that is not there)</span
              >
            </button>
          </li>
        </ul>
      </article>

      <nav
        v-if="p.steps.value.length > 1"
        aria-label="Path taken"
        class="border-t border-line pt-4"
      >
        <h2 class="m-0 pb-2 text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3">
          Path taken
        </h2>
        <ol class="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-1 p-0 text-[12.5px]">
          <li v-for="s in p.steps.value" :key="s.index" class="flex items-center gap-1">
            <span v-if="s.index" aria-hidden="true" class="text-ink-3">→</span>
            <button
              v-if="s.index < p.steps.value.length - 1"
              type="button"
              class="flex min-h-8 items-center rounded px-1.5 text-ink-2 underline underline-offset-2 hover:bg-raised pointer-coarse:min-h-11"
              :aria-label="`Go back to ${s.title}`"
              @click="p.jump(s.index)"
            >
              {{ s.title }}
            </button>
            <span v-else class="px-1.5 py-0.5 font-semibold text-ink" aria-current="step">{{
              s.title
            }}</span>
          </li>
        </ol>
      </nav>
    </div>
  </section>
</template>
