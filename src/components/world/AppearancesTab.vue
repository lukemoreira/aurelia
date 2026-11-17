<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useAppearances } from '@/composables/useAppearances'

/** The scenes this record is linked or named in, book by book (a tagged name counts). */
const props = defineProps<{ id: string; name: string }>()
const a = useAppearances(() => props.id)
</script>

<template>
  <section aria-labelledby="appearances-title" class="flex flex-col gap-4">
    <div>
      <h2 id="appearances-title" class="m-0 text-[13px] font-medium text-ink">Appearances</h2>
      <p class="m-0 text-xs text-ink-3">
        Where {{ name }} is named or linked, across every book of the universe.
      </p>
    </div>
    <p v-if="!a.total.value" class="m-0 text-[13px] text-ink-2">
      Not in any scene yet. Write their name, or type [[ to link them, and the scene shows up here.
    </p>
    <section v-for="g in a.groups.value" :key="g.book.id" :aria-label="g.book.title">
      <h3 class="m-0 pb-1 text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3">
        {{ g.book.title }} · {{ g.scenes.length }} {{ g.scenes.length === 1 ? 'scene' : 'scenes' }}
      </h3>
      <ul class="m-0 flex list-none flex-col gap-px p-0">
        <li v-for="s in g.scenes" :key="s.target.id">
          <button
            type="button"
            class="flex min-h-8 w-full items-center gap-2 rounded-control px-2 text-left text-ink-2 hover:bg-raised hover:text-ink pointer-coarse:min-h-11"
            @click="a.open(s.target)"
          >
            <span class="min-w-0 flex-1 truncate">{{ s.target.title }}</span>
            <span class="text-xs text-ink-3">{{ s.count }}<span class="sr-only"> times</span></span>
          </button>
        </li>
      </ul>
    </section>
  </section>
</template>
