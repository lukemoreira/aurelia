<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import Tag from '@/components/ui/Tag.vue'
import { useSharedChangeForm } from '@/composables/useChangeForm'
import { changeLabel, changeText, pickOfKind } from '@/domain/change-kinds'
import { useWorkspaceStore } from '@/stores/workspace'

/** "What changes here": the state changes a scene records, in words, with a board to add, correct or remove them. */
const ws = useWorkspaceStore()
const form = useSharedChangeForm()
const setupText = (id?: string) =>
  ws.data?.scenes
    .flatMap((s) => s.meta.changes ?? [])
    .find((c) => c.kind === 'setup' && c.id === id)?.value ?? ''
const text = (c: (typeof form.changes.value)[number]) => changeText(c, form.nameOf, setupText)
const small =
  'flex size-8 items-center justify-center rounded-control text-ink-2 hover:bg-raised hover:text-ink pointer-coarse:size-11'
</script>

<template>
  <section aria-label="What changes here" class="flex flex-col gap-2 border-t border-line pt-3.5">
    <div class="flex items-center justify-between">
      <h3 class="text-[11px] font-semibold uppercase tracking-[.06em] text-ink-3">
        What changes here
      </h3>
      <button
        v-if="form.canEdit.value"
        type="button"
        class="inline-flex h-8 items-center gap-1 rounded-control px-2 text-xs font-medium text-gold-ink hover:bg-gold-soft pointer-coarse:h-11"
        @click="form.startAdd()"
      >
        <Icon name="plus" :size="13" />Add
      </button>
    </div>
    <p v-if="!form.changes.value.length" class="m-0 text-ink-2">
      Nothing recorded. Add what changes for someone, and Aurelia keeps track from here on.
    </p>
    <ul v-else class="m-0 flex list-none flex-col gap-2 p-0">
      <li
        v-for="(c, i) in form.changes.value"
        :key="`${i}:${c.kind}:${c.value}`"
        class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2.5"
      >
        <span class="justify-self-start"
          ><Tag>{{ changeLabel(c.kind) }}</Tag></span
        >
        <span>{{ text(c) }}</span>
        <span v-if="form.canEdit.value" class="flex -my-1.5">
          <button
            v-if="pickOfKind(c.kind)"
            type="button"
            :class="small"
            :aria-label="`Edit change: ${changeLabel(c.kind)}, ${text(c)}`"
            @click="form.startEdit(i)"
          >
            <Icon name="write" :size="14" />
          </button>
          <button
            type="button"
            :class="small"
            :aria-label="`Remove change: ${changeLabel(c.kind)}, ${text(c)}`"
            @click="form.remove(i)"
          >
            <Icon name="close" :size="14" />
          </button>
        </span>
      </li>
    </ul>
    <p
      v-if="form.error.value && !form.open.value"
      role="alert"
      class="m-0 text-xs font-medium text-danger"
    >
      {{ form.error.value }}
    </p>
  </section>
</template>
