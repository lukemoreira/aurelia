<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useId } from 'vue'
import Button from '@/components/ui/Button.vue'
import { useNewNames } from '@/composables/useNewNames'

/**
 * New names in this book (ADR-0010): capitalised words that come back often and are not in the
 * library yet. Nothing is made or hidden until the author clicks, and a hidden word can be given back.
 */
withDefaults(defineProps<{ heading?: 'h2' | 'h3'; compact?: boolean }>(), {
  heading: 'h2',
  compact: false,
})
const n = useNewNames()
const titleId = useId()
</script>

<template>
  <section :aria-labelledby="titleId" class="flex flex-col gap-3">
    <div>
      <component
        :is="heading"
        :id="titleId"
        :class="
          compact
            ? 'm-0 text-[11px] font-semibold uppercase tracking-[.06em] text-ink-3'
            : 'm-0 font-prose text-[22px] font-medium'
        "
      >
        New names in this book
      </component>
      <p class="m-0 text-[13px] text-ink-2">
        Words that look like names and are not in your library yet.
      </p>
    </div>
    <p v-if="!n.names.value.length" role="status" class="m-0 text-[13px] text-ink-2">
      No new names. A word is offered when it is capitalised, appears three times or more in the
      writing, and is not a character or place already.
    </p>
    <ul v-else class="m-0 flex list-none flex-col gap-2 p-0">
      <li
        v-for="f in n.names.value"
        :key="f.word"
        class="flex flex-col gap-2 rounded-control border border-line bg-surface p-2.5"
      >
        <span class="flex flex-wrap items-baseline gap-x-1.5">
          <b class="font-semibold text-ink">{{ f.word }}</b>
          <span class="text-xs text-ink-3"
            >· {{ f.count }} times · first in
            <button
              type="button"
              class="inline-flex min-h-8 items-center font-medium text-ink-2 underline underline-offset-2 hover:text-ink pointer-coarse:min-h-11"
              @click="n.openFirst(f)"
            >
              {{ f.places[0]?.title }}</button><template v-if="f.places.length > 1">
              and {{ f.places.length - 1 }} more</template
            ></span
          >
        </span>
        <span v-if="n.canEdit.value" class="flex flex-wrap gap-1.5">
          <Button :aria-label="`Create character ${f.word}`" @click="n.create(f, 'character')">
            Create character
          </Button>
          <Button :aria-label="`Create place ${f.word}`" @click="n.create(f, 'place')">
            Create place
          </Button>
          <Button
            variant="quiet"
            :aria-label="`Not a name: stop offering ${f.word} in this book`"
            :title="`Stop offering “${f.word}” in this book`"
            @click="n.notAName(f)"
          >
            Not a name
          </Button>
        </span>
      </li>
    </ul>

    <details v-if="n.dismissed.value.length" class="text-[13px]">
      <summary
        class="flex min-h-8 cursor-pointer items-center text-ink-2 hover:text-ink pointer-coarse:min-h-11"
      >
        Words you said are not names ({{ n.dismissed.value.length }})
      </summary>
      <ul class="m-0 mt-1 flex list-none flex-col gap-1 p-0">
        <li
          v-for="w in n.dismissed.value"
          :key="w"
          class="flex items-center justify-between gap-2 rounded-control px-2.5 py-0.5"
        >
          <span class="min-w-0 truncate text-ink">{{ w }}</span>
          <Button
            v-if="n.canEdit.value"
            variant="quiet"
            :aria-label="`Give back ${w}: offer it again`"
            @click="n.giveBack(w)"
          >
            Give back
          </Button>
        </li>
      </ul>
    </details>
  </section>
</template>
